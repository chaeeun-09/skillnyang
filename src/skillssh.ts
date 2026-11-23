/**
 * skills.sh (Vercel 의 오픈 스킬 레지스트리) 설치 수 조회.
 *
 * - 공개 검색: GET https://skills.sh/api/search?q=..&owner=..  (인증 불필요, `npx skills find` 가 쓰는 엔드포인트)
 *   응답 { skills: [{ id, name, installs, source }] }
 * - 공식 v1 API(/api/v1/skills)는 Vercel OIDC 토큰이 필요해서, SKILLS_SH_TOKEN 이 있을 때만 리더보드를 추가로 사용.
 * 어떤 이유로든 실패하면 조용히 빈 결과를 돌려주고, 랭킹은 GitHub 신호만으로 계속 동작한다.
 */
import { config } from "./config.js";

export interface SkillsShHit {
  id: string;
  name: string;
  source: string;
  installs: number;
}

const BASE = () => config.skillsShBaseUrl.replace(/\/$/, "");
let disabledUntil = 0;
let consecutiveFailures = 0;

/** 연속 실패 시 30분간 호출 중단 (skills.sh 장애·차단 시 크롤링이 느려지지 않게) */
function fail() {
  if (++consecutiveFailures >= 3) {
    disabledUntil = Date.now() + 30 * 60_000;
    consecutiveFailures = 0;
    console.warn("[skills.sh] 연속 실패 → 30분간 설치 수 조회 중단");
  }
}

async function get<T>(url: string, auth = false): Promise<T | null> {
  if (Date.now() < disabledUntil) return null;
  const headers: Record<string, string> = { "User-Agent": "skillnyang-bot" };
  if (auth && config.skillsShToken) headers.Authorization = `Bearer ${config.skillsShToken}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? "60");
      disabledUntil = Date.now() + Math.min(retry, 600) * 1000;
      return null;
    }
    if (!res.ok) {
      if (res.status >= 500) fail();
      return null;
    }
    consecutiveFailures = 0;
    return (await res.json()) as T;
  } catch {
    fail();
    return null;
  }
}

export async function searchSkillsSh(q: string, owner?: string): Promise<SkillsShHit[]> {
  if (q.trim().length < 2) return [];
  const p = new URLSearchParams({ q });
  if (owner) p.set("owner", owner.toLowerCase());
  const data = await get<{ skills?: SkillsShHit[] }>(`${BASE()}/api/search?${p}`);
  return (data?.skills ?? []).filter((s) => typeof s.installs === "number" && typeof s.source === "string");
}

/** v1 리더보드 (토큰 있을 때만). view: all-time | trending | hot */
export async function leaderboard(view: "all-time" | "trending" | "hot", pages = 2): Promise<SkillsShHit[]> {
  if (!config.skillsShToken) return [];
  const out: SkillsShHit[] = [];
  for (let page = 0; page < pages; page++) {
    const data = await get<{ data?: SkillsShHit[]; pagination?: { hasMore?: boolean } }>(
      `${BASE()}/api/v1/skills?view=${view}&per_page=500&page=${page}`,
      true,
    );
    if (!data?.data?.length) break;
    out.push(...data.data);
    if (!data.pagination?.hasMore) break;
  }
  return out;
}

/** source(owner/repo) + 스킬 이름 → installs 조회용 키 */
export const hitKey = (source: string, name: string) => `${source.toLowerCase()}::${name.toLowerCase()}`;

/** 테스트용 */
export function _resetSkillsSh() {
  disabledUntil = 0;
  consecutiveFailures = 0;
}
