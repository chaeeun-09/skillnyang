import type { Entry } from "./types.js";

export interface ScoreInput {
  stars: number;
  official: boolean;
  curatedCount: number;
  hasMarketplace: boolean;
}

/** 가중치 — 필요하면 여기만 고치면 됨 */
export const WEIGHTS = {
  /** log10(stars+1) 당 점수. 1k★≈60, 10k★≈80, 100k★≈100 */
  stars: 20,
  official: 25,
  perCuratedList: 5,
  maxCuratedLists: 3,
  /** /plugin 으로 한 번에 설치 가능하면 소폭 가산 */
  marketplace: 3,
};

export function score(i: ScoreInput): number {
  const s =
    Math.log10(Math.max(0, i.stars) + 1) * WEIGHTS.stars +
    (i.official ? WEIGHTS.official : 0) +
    Math.min(i.curatedCount, WEIGHTS.maxCuratedLists) * WEIGHTS.perCuratedList +
    (i.hasMarketplace ? WEIGHTS.marketplace : 0);
  return Math.round(s * 10) / 10;
}

export function scoreBreakdown(e: Entry): string {
  const parts = [`★ ${Math.round(Math.log10(e.stars + 1) * WEIGHTS.stars)}`];
  if (e.official) parts.push(`공식 +${WEIGHTS.official}`);
  const c = Math.min(e.curatedBy.length, WEIGHTS.maxCuratedLists);
  if (c) parts.push(`큐레이션 +${c * WEIGHTS.perCuratedList}`);
  if (e.marketplaceName) parts.push(`마켓플레이스 +${WEIGHTS.marketplace}`);
  return parts.join(" · ");
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  dev: ["tdd", "test", "refactor", "code review", "debug", "git", "commit", "pr ", "pull request", "lint", "typescript", "python", "engineering"],
  devops: ["devops", "kubernetes", "k8s", "terraform", "docker", "aws", "gcp", "azure", "ci/cd", "github actions", "infra", "deploy", "helm", "observability"],
  security: ["security", "audit", "vulnerab", "pentest", "semgrep", "codeql", "secure", "threat"],
  docs: ["docx", "pdf", "pptx", "xlsx", "document", "writing", "markdown", "slides", "spreadsheet"],
  design: ["design", "ui", "ux", "frontend", "css", "figma", "tailwind", "canvas"],
  data: ["data", "sql", "analytics", "pandas", "notebook", "ml ", "machine learning", "database"],
  productivity: ["workflow", "productivity", "planning", "memory", "context", "token", "brainstorm", "notes"],
};

export const CATEGORIES = Object.keys(CATEGORY_KEYWORDS);

export function categorize(text: string, topics: string[]): string[] {
  const hay = ` ${text.toLowerCase()} ${topics.join(" ").toLowerCase()} `;
  return CATEGORIES.filter((c) => CATEGORY_KEYWORDS[c].some((k) => hay.includes(k)));
}

/** 간단한 키워드 검색: 이름/아이템명 일치에 높은 가중치, 마지막에 랭킹 점수로 타이브레이크 */
export function search(entries: Entry[], query: string, limit = 10): Entry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return entries.slice(0, limit);
  const scored = entries
    .map((e) => {
      const name = e.repo.toLowerCase();
      const items = e.items.map((i) => i.name.toLowerCase()).join(" ");
      const itemDesc = e.items.map((i) => i.description.toLowerCase()).join(" ");
      const desc = e.description.toLowerCase();
      const topics = e.topics.join(" ").toLowerCase();
      let m = 0;
      for (const t of terms) {
        if (name.includes(t)) m += 5;
        if (items.includes(t)) m += 4;
        if (topics.includes(t)) m += 2;
        if (desc.includes(t)) m += 2;
        if (itemDesc.includes(t)) m += 1;
      }
      return { e, m };
    })
    .filter((x) => x.m > 0)
    .sort((a, b) => b.m - a.m || b.e.score - a.e.score);
  return scored.slice(0, limit).map((x) => x.e);
}
