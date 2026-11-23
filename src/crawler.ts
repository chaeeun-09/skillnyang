import { config } from "./config.js";
import { getRaw, getRepo, getTree, pool, searchRepos, type RepoMeta } from "./github.js";
import { isSafeName, isSafePath, isSafeRepo } from "./install.js";
import { categorize, score } from "./ranking.js";
import { hitKey, leaderboard, searchSkillsSh, type SkillsShHit } from "./skillssh.js";
import type { Entry, Index, Item } from "./types.js";

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** SKILL.md 앞부분 YAML frontmatter 에서 name / description 만 뽑는다 (의존성 없이) */
export function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val === "|" || val === ">" || val === ">-" || val === "|-") {
      const buf: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) buf.push(lines[++i].trim());
      val = buf.join(" ");
    }
    out[kv[1]] = val.replace(/^["']|["']$/g, "");
  }
  return out;
}

/** awesome 리스트 README 에서 github.com/owner/repo 링크 추출 */
export function extractRepoLinks(md: string): string[] {
  const set = new Set<string>();
  for (const m of md.matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g)) {
    const repo = `${m[1]}/${m[2].replace(/\.git$/, "")}`.replace(/[.]+$/, "");
    if (isSafeRepo(repo)) set.add(repo.toLowerCase());
  }
  return [...set];
}

async function curatedMap(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const list of config.curatedLists) {
    // raw 는 API 한도를 안 쓰므로 흔한 브랜치명을 먼저 시도하고, 실패할 때만 메타 조회
    let readme: string | null = null;
    for (const b of ["main", "master"]) readme ??= await getRaw(list, b, "README.md");
    if (!readme) {
      const meta = await getRepo(list).catch(() => null);
      if (meta) readme = await getRaw(list, meta.default_branch, "README.md");
    }
    if (!readme) continue;
    for (const repo of extractRepoLinks(readme)) {
      if (repo === list.toLowerCase()) continue;
      map.set(repo, [...(map.get(repo) ?? []), list]);
    }
  }
  return map;
}

async function itemsFor(meta: RepoMeta): Promise<{ marketplaceName: string | null; items: Item[] }> {
  const repo = meta.full_name;
  const branch = meta.default_branch;

  // 1) 플러그인 마켓플레이스?
  const mktRaw = await getRaw(repo, branch, ".claude-plugin/marketplace.json");
  if (mktRaw) {
    try {
      const mkt = JSON.parse(mktRaw) as { name?: string; plugins?: { name?: string; description?: string }[] };
      if (mkt.name && isSafeName(mkt.name) && Array.isArray(mkt.plugins)) {
        const items: Item[] = mkt.plugins
          .filter((p) => typeof p.name === "string" && isSafeName(p.name))
          .slice(0, 100)
          .map((p) => ({ kind: "plugin", name: p.name!, description: clip(String(p.description ?? ""), 300) }));
        if (items.length) return { marketplaceName: mkt.name, items };
      }
    } catch {
      // 잘못된 JSON → 스킬 탐색으로 폴백
    }
  }

  // 2) 단일 스킬 폴더(SKILL.md) 탐색
  const paths = (await getTree(repo, branch))
    .filter((p) => /(^|\/)SKILL\.md$/.test(p))
    .filter((p) => !p.includes("node_modules/") && !/(^|\/)(test|tests|examples?|fixtures)\//i.test(p))
    .slice(0, config.maxSkillsPerRepo);

  const items = await pool(paths, 6, async (p): Promise<Item | null> => {
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (!isSafePath(dir)) return null;
    const md = await getRaw(repo, branch, p);
    const fm = md ? parseFrontmatter(md) : {};
    const fallback = dir ? dir.split("/").pop()! : meta.full_name.split("/")[1];
    const name = fm.name && isSafeName(fm.name) ? fm.name : fallback;
    if (!isSafeName(name)) return null;
    return { kind: "skill", name, description: clip(fm.description ?? "", 300), path: dir };
  });
  return { marketplaceName: null, items: items.filter((x): x is Item => !!x) };
}

/** skills.sh 에서 이 레포의 스킬 설치 수를 모은다 (id → hit) */
export async function installsFor(repo: string, items: Item[], board: Map<string, SkillsShHit[]>): Promise<Map<string, SkillsShHit>> {
  const [owner, name] = repo.split("/");
  const hits = new Map<string, SkillsShHit>();
  const add = (list: SkillsShHit[]) => {
    for (const h of list) if (h.source.toLowerCase() === repo.toLowerCase()) hits.set(h.id ?? hitKey(h.source, h.name), h);
  };
  add(board.get(repo.toLowerCase()) ?? []);
  const queries = [name, ...items.map((i) => i.name)].filter((q, i, a) => a.indexOf(q) === i);
  for (const q of queries.slice(0, config.skillsShQueriesPerRepo)) add(await searchSkillsSh(q, owner));
  return hits;
}

export function matchInstalls(item: Item, hits: Map<string, SkillsShHit>): number | undefined {
  const n = item.name.toLowerCase();
  for (const h of hits.values()) {
    if (h.name.toLowerCase() === n || (h.id ?? "").toLowerCase().endsWith(`/${n}`)) return h.installs;
  }
  return undefined;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function crawl(prev?: Index, log: (s: string) => void = console.log): Promise<Index> {
  const t0 = Date.now();
  const metas = new Map<string, RepoMeta>();

  for (const q of config.searchQueries) {
    try {
      for (const r of await searchRepos(q)) metas.set(r.full_name.toLowerCase(), r);
    } catch (e) {
      log(`[crawl] search failed "${q}": ${(e as Error).message}`);
    }
  }
  log(`[crawl] github search → ${metas.size} repos`);

  // (선택) skills.sh 리더보드 — 토큰이 있으면 설치 수 기준 상위 레포도 후보로 편입
  const board = new Map<string, SkillsShHit[]>();
  for (const h of await leaderboard("all-time")) {
    if (h.source && isSafeRepo(h.source)) {
      const k = h.source.toLowerCase();
      board.set(k, [...(board.get(k) ?? []), h]);
    }
  }
  if (board.size) log(`[crawl] skills.sh leaderboard → ${board.size} repos`);

  const curated = await curatedMap();
  log(`[crawl] curated lists → ${curated.size} linked repos`);

  // 시드 + 리더보드 + 큐레이션 링크 중 아직 메타가 없는 것 보충
  // awesome 리스트는 링크가 수천 개일 수 있어서, 여러 리스트에 겹친 레포부터 MAX_CURATED_FETCH 개까지만
  const curatedByOverlap = [...curated.entries()].sort((a, b) => b[1].length - a[1].length).map(([r]) => r);
  const extra = [
    ...config.seedRepos.map((s) => s.toLowerCase()),
    ...[...board.keys()].slice(0, config.maxCuratedFetch),
    ...curatedByOverlap.filter((r) => !metas.has(r)).slice(0, config.maxCuratedFetch),
  ].filter((r, i, arr) => !metas.has(r) && arr.indexOf(r) === i);
  const fetched = await pool(extra, 8, (r) => getRepo(r).catch(() => null));
  for (const m of fetched) if (m) metas.set(m.full_name.toLowerCase(), m);

  const seeds = new Set(config.seedRepos.map((s) => s.toLowerCase()));
  const candidates = [...metas.values()]
    .filter((m) => !m.archived && !m.fork)
    .filter((m) => m.stargazers_count >= config.minStars || seeds.has(m.full_name.toLowerCase()))
    // 시드(공식 등)는 MAX_REPOS 컷에 걸리지 않도록 맨 앞에
    .sort(
      (a, b) =>
        Number(seeds.has(b.full_name.toLowerCase())) - Number(seeds.has(a.full_name.toLowerCase())) ||
        b.stargazers_count - a.stargazers_count,
    )
    .slice(0, config.maxRepos);
  log(`[crawl] inspecting ${candidates.length} candidates`);

  const prevSeen = new Map((prev?.entries ?? []).map((e) => [e.repo.toLowerCase(), e.firstSeen]));
  const now = new Date().toISOString();

  const entries = (
    await pool(candidates, 6, async (m): Promise<Entry | null> => {
      try {
        const { marketplaceName, items } = await itemsFor(m);
        if (!items.length) return null; // awesome 리스트 등 설치할 게 없는 레포
        const key = m.full_name.toLowerCase();
        const hits = await installsFor(m.full_name, items, board);
        for (const it of items) {
          const n = matchInstalls(it, hits);
          if (n !== undefined) it.installs = n;
        }
        const installs = [...hits.values()].reduce((s, h) => s + h.installs, 0);
        const official = config.officialOwners.includes(m.full_name.split("/")[0].toLowerCase());
        const curatedBy = curated.get(key) ?? [];
        const description = clip(m.description ?? "", 300);
        const text = [description, ...items.map((i) => `${i.name} ${i.description}`)].join(" ");
        return {
          repo: m.full_name,
          url: m.html_url,
          description,
          stars: m.stargazers_count,
          pushedAt: m.pushed_at,
          topics: m.topics ?? [],
          license: m.license?.spdx_id ?? null,
          marketplaceName,
          // 설치 수 많은 아이템이 먼저 보이도록
          items: items.sort((a, b) => (b.installs ?? -1) - (a.installs ?? -1)),
          installs,
          official,
          curatedBy,
          categories: categorize(text, m.topics ?? []),
          score: score({
            stars: m.stargazers_count,
            installs,
            official,
            curatedCount: curatedBy.length,
            hasMarketplace: !!marketplaceName,
          }),
          // 첫 크롤링에서는 전부 "신규"가 되지 않도록 epoch 로 둔다
          firstSeen: prevSeen.get(key) ?? (prev?.entries.length ? now : new Date(0).toISOString()),
        };
      } catch (e) {
        log(`[crawl] skip ${m.full_name}: ${(e as Error).message}`);
        return null;
      }
    })
  )
    .filter((e): e is Entry => !!e)
    .sort((a, b) => b.score - a.score);

  // 일별 스냅샷 (급상승 계산용)
  const history = { ...(prev?.history ?? {}) };
  history[today()] = Object.fromEntries(entries.map((e) => [e.repo.toLowerCase(), [e.stars, e.installs]]));
  const cutoff = new Date(Date.now() - config.historyDays * 86_400_000).toISOString().slice(0, 10);
  for (const d of Object.keys(history)) if (d < cutoff) delete history[d];

  const withInstalls = entries.filter((e) => e.installs > 0).length;
  log(`[crawl] done: ${entries.length} entries (${withInstalls} with skills.sh installs) in ${Math.round((Date.now() - t0) / 1000)}s`);
  return { updatedAt: now, entries, history };
}
