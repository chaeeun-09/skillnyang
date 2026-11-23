import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepoLinks, installsFor, matchInstalls, parseFrontmatter } from "../src/crawler.js";
import { _resetSkillsSh } from "../src/skillssh.js";
import { installFor, renderInstall } from "../src/install.js";
import { communityBonus, score, search } from "../src/ranking.js";
import { _reset, rankForGuild, recordClick, signals, toggleVote } from "../src/community.js";
import { isDigestTime, newcomers, rising } from "../src/digest.js";
import { sanitizeSummary } from "../src/summary.js";
import type { Entry } from "../src/types.js";
import { chunkMessage } from "../src/views.js";

const base: Entry = {
  repo: "acme/skills",
  url: "https://github.com/acme/skills",
  description: "Terraform and Kubernetes helpers",
  stars: 1000,
  pushedAt: "2026-11-01T00:00:00Z",
  topics: ["claude-skills"],
  license: "MIT",
  marketplaceName: null,
  items: [{ kind: "skill", name: "tf-plan", description: "Review terraform plans", path: "skills/tf-plan" }],
  official: false,
  curatedBy: [],
  categories: [],
  score: 0,
  installs: 0,
  firstSeen: "1970-01-01T00:00:00.000Z",
};

const S = (o: Partial<Parameters<typeof score>[0]>) =>
  score({ stars: 0, installs: 0, official: false, curatedCount: 0, hasMarketplace: false, ...o });

test("score: 스타·설치 로그 스케일 + 공식/큐레이션 가산", () => {
  const plain = S({ stars: 1000 });
  assert.equal(plain, 45);
  assert.equal(S({ stars: 1000, installs: 1000 }) - plain, 45, "설치 1k = +45");
  assert.equal(S({ stars: 1000, official: true }) - plain, 20);
  assert.equal(S({ stars: 1000, curatedCount: 10 }) - plain, 12, "큐레이션은 최대 3개까지만 반영");
  // 스타는 적어도 실제 설치가 많으면 역전
  assert.ok(S({ stars: 500, installs: 50_000 }) > S({ stars: 20_000 }));
});

test("communityBonus: 투표는 로그로 체감", () => {
  assert.equal(communityBonus(0, 0), 0);
  assert.equal(communityBonus(1, 0), 8);
  assert.equal(communityBonus(3, 0), 16);
  assert.equal(communityBonus(0, 1), 3);
});

test("install: 마켓플레이스 플러그인", () => {
  const e = { ...base, marketplaceName: "acme-mkt", items: [{ kind: "plugin" as const, name: "tf", description: "" }] };
  const ins = installFor(e, e.items[0])!;
  assert.deepEqual(ins.inSession, ["/plugin marketplace add acme/skills", "/plugin install tf@acme-mkt"]);
  assert.match(ins.shell[0], /^claude plugin marketplace add acme\/skills && claude plugin install tf@acme-mkt$/);
});

test("install: 공식 마켓플레이스는 add 생략", () => {
  const e = {
    ...base,
    repo: "anthropics/claude-plugins-official",
    marketplaceName: "claude-plugins-official",
    items: [{ kind: "plugin" as const, name: "github", description: "" }],
  };
  assert.deepEqual(installFor(e, e.items[0])!.inSession, ["/plugin install github@claude-plugins-official"]);
});

test("install: 단일 스킬은 npx + git 수동 설치", () => {
  const ins = installFor(base, base.items[0])!;
  assert.equal(ins.shell[0], "npx skills add acme/skills --skill tf-plan --agent claude-code -g");
  assert.match(ins.shell[1], /cp -R "\$tmp\/skills\/tf-plan" ~\/\.claude\/skills\/tf-plan/);
});

test("install: 위험한 이름/경로는 명령 생성 거부", () => {
  const bad = (name: string, path = "x") => installFor(base, { kind: "skill", name, description: "", path });
  assert.equal(bad("a; rm -rf ~"), null);
  assert.equal(bad("$(whoami)"), null);
  assert.equal(bad("ok", "../../etc"), null);
  assert.equal(bad("ok", "a b"), null);
  assert.equal(installFor({ ...base, repo: "evil/repo`id`" }, base.items[0]), null);
  assert.match(renderInstall(base, [{ kind: "skill", name: "x|y", description: "" }]), /생략: x\|y/);
});

test("frontmatter 파싱 (블록 스칼라 포함)", () => {
  const md = `---\nname: pdf\ndescription: >\n  Read and\n  write PDFs\n---\n# body`;
  assert.deepEqual(parseFrontmatter(md), { name: "pdf", description: "Read and write PDFs" });
  assert.deepEqual(parseFrontmatter(`---\nname: "q"\n---`), { name: "q" });
  assert.deepEqual(parseFrontmatter("# no fm"), {});
});

test("awesome README 링크 추출", () => {
  const md = "- [a](https://github.com/Foo/Bar) and https://github.com/x/y.git, https://github.com/foo/bar/tree/main";
  assert.deepEqual(extractRepoLinks(md).sort(), ["foo/bar", "x/y"]);
});

test("search: 아이템명 매칭", () => {
  const other = { ...base, repo: "z/other", description: "pdf", items: [], score: 99 };
  assert.equal(search([other, base], "tf-plan")[0].repo, "acme/skills");
});

test("chunkMessage: 코드블록 유지", () => {
  const text = "```bash\n" + Array.from({ length: 200 }, (_, i) => `echo ${i} ${"x".repeat(20)}`).join("\n") + "\n```";
  const chunks = chunkMessage(text, 500);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= 520);
    assert.equal((c.match(/```/g) ?? []).length % 2, 0, "각 청크의 펜스 짝이 맞아야 함");
  }
});

test("community: 투표 토글 + 서버별 랭킹 반영", () => {
  _reset();
  const a = { ...base, repo: "a/a", score: 50 };
  const b = { ...base, repo: "b/b", score: 45 };
  assert.deepEqual(rankForGuild([a, b], "g1").map((e) => e.repo), ["a/a", "b/b"]);
  assert.deepEqual(toggleVote("g1", "B/B", "u1"), { voted: true, count: 1 });
  toggleVote("g1", "b/b", "u2");
  assert.deepEqual(rankForGuild([a, b], "g1").map((e) => e.repo), ["b/b", "a/a"], "2표(+12.7)면 역전");
  assert.deepEqual(rankForGuild([a, b], "g2").map((e) => e.repo), ["a/a", "b/b"], "다른 서버엔 영향 없음");
  assert.deepEqual(toggleVote("g1", "b/b", "u1"), { voted: false, count: 1 });
  recordClick("g1", "a/a");
  assert.deepEqual(signals("g1", "a/a"), { votes: 0, clicks: 1 });
  assert.deepEqual(signals(null, "a/a"), { votes: 0, clicks: 0 });
});

test("digest: 급상승은 7일 전 스냅샷과 비교", () => {
  const now = Date.parse("2026-11-23T03:00:00Z");
  const idx = {
    updatedAt: "",
    entries: [
      { ...base, repo: "x/x", stars: 1500, installs: 100 },
      { ...base, repo: "y/y", stars: 5000, installs: 0 },
      { ...base, repo: "z/z", stars: 10, installs: 0, firstSeen: "2026-11-22T00:00:00Z" },
    ],
    history: {
      "2026-11-10": { "x/x": [1000, 0] as [number, number], "y/y": [4990, 0] as [number, number] },
      "2026-11-16": { "x/x": [1400, 50] as [number, number], "y/y": [4900, 0] as [number, number] },
    },
  };
  const r = rising(idx, 7, 5, now);
  assert.equal(r.length, 2, "z/z 는 과거 스냅샷이 없어 제외");
  assert.equal(r[0].entry.repo, "x/x", "스타 증가가 같으면 설치 증가가 있는 쪽이 위");
  assert.equal(r.find((x) => x.entry.repo === "x/x")!.installDelta, 50);
  assert.equal(r.find((x) => x.entry.repo === "y/y")!.starDelta, 100);
  assert.deepEqual(newcomers(idx, Date.parse("2026-11-16T00:00:00Z")).map((e) => e.repo), ["z/z"]);
});

test("digest: 발송 시각 판정 (서울 월요일 10시 이후, 주 1회)", () => {
  const mon11kst = new Date("2026-11-23T02:00:00Z"); // 월 11:00 KST
  const mon09kst = new Date("2026-11-23T00:00:00Z"); // 월 09:00 KST
  const tue = new Date("2026-11-24T02:00:00Z");
  assert.equal(isDigestTime(undefined, mon11kst), true);
  assert.equal(isDigestTime(undefined, mon09kst), false);
  assert.equal(isDigestTime(undefined, tue), false);
  assert.equal(isDigestTime("2026-11-23T01:05:00Z", mon11kst), false, "이미 보냄");
  assert.equal(isDigestTime("2026-11-16T01:05:00Z", mon11kst), true);
});

test("summary: 멘션/링크 제거", () => {
  assert.equal(
    sanitizeSummary("@everyone 안녕 <@123> [여기](https://evil.com) https://x.y 끝"),
    "＠everyone 안녕 여기 끝",
  );
});

test("skills.sh: 같은 레포 결과만 모아 아이템 설치 수 매칭, 장애 시 빈 결과", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        skills: [
          { id: "acme/skills/tf-plan", name: "tf-plan", source: "acme/skills", installs: 1234 },
          { id: "acme/other/tf-plan", name: "tf-plan", source: "acme/other", installs: 99999 },
          { id: "acme/skills/helper", name: "helper", source: "acme/skills", installs: 6 },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    _resetSkillsSh();
    const hits = await installsFor("acme/skills", base.items, new Map());
    assert.equal(hits.size, 2, "다른 레포(acme/other) 결과는 제외, id 로 중복 제거");
    assert.equal(matchInstalls(base.items[0], hits), 1234);
    assert.ok(calls.every((u) => u.includes("/api/search?") && u.includes("owner=acme")));

    globalThis.fetch = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    _resetSkillsSh();
    const none = await installsFor("acme/skills", base.items, new Map());
    assert.equal(none.size, 0);
  } finally {
    globalThis.fetch = realFetch;
    _resetSkillsSh();
  }
});
