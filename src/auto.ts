/**
 * 자동 추천 로직 (디스코드와 무관한 순수 함수들):
 *  - 오늘의 스킬 선정 / 발송 시각 판정
 *  - 급상승 감지
 *  - 대화에서 "이런 스킬 없을까?" 의도 감지
 */
import type { GuildData } from "./community.js";
import { config } from "./config.js";
import { CATEGORIES, searchScored } from "./ranking.js";
import type { Entry, Index } from "./types.js";

const DAY = 86_400_000;
const KST = 9 * 3_600_000;

/** 같은 레포에 급상승 알림을 다시 보내기까지의 쿨다운 */
export const ALERT_COOLDOWN = 7 * DAY;
/** 자동 제안으로 인정할 최소 검색 매칭 점수 (이름/아이템명 일치 ≈4~5, 설명 일치 ≈2) */
export const MIN_MATCH = 6;

export const kstDate = (now = new Date()) => new Date(now.getTime() + KST).toISOString().slice(0, 10);
const kstHour = (now = new Date()) => new Date(now.getTime() + KST).getUTCHours();

/* ───────────── 오늘의 스킬 ───────────── */

export function isDailyTime(g: GuildData, now = new Date()): boolean {
  if (!g.autoChannelId) return false;
  const hour = g.dailyHour ?? config.dailyHour;
  return kstHour(now) >= hour && g.lastDailyDate !== kstDate(now);
}

export interface DailyPick {
  picks: Entry[];
  nextCursor: number;
  /** 소개 기록을 모두 소진해서 초기화했는지 */
  reset: boolean;
}

/**
 * ranked: 이미 (서버 가산점 포함) 점수순으로 정렬된 목록.
 * 카테고리를 돌아가며 1개 + 전체 상위에서 나머지를 채운다. 이미 소개한 레포·1년 넘게 푸시 없는 레포는 제외.
 */
export function pickDaily(ranked: Entry[], g: GuildData, count = config.dailyCount, now = Date.now()): DailyPick {
  const alive = ranked.filter((e) => now - Date.parse(e.pushedAt) < 365 * DAY);
  const shown = new Set(g.shown ?? []);
  let pool = alive.filter((e) => !shown.has(e.repo.toLowerCase()));
  let reset = false;
  if (pool.length < count) {
    reset = true;
    pool = alive;
  }

  const picks: Entry[] = [];
  const cursor = (g.categoryCursor ?? 0) % CATEGORIES.length;
  let nextCursor = cursor;
  for (let i = 0; i < CATEGORIES.length && !picks.length; i++) {
    const cat = CATEGORIES[(cursor + i) % CATEGORIES.length];
    const hit = pool.find((e) => e.categories.includes(cat));
    if (hit) {
      picks.push(hit);
      nextCursor = (cursor + i + 1) % CATEGORIES.length;
    }
  }
  for (const e of pool) {
    if (picks.length >= count) break;
    if (!picks.includes(e)) picks.push(e);
  }
  return { picks: picks.slice(0, count), nextCursor, reset };
}

/* ───────────── 급상승 ───────────── */

export interface Surge {
  entry: Entry;
  starDelta: number;
  installDelta: number;
}

/**
 * 오늘 이전의 가장 최근 일별 스냅샷(최대 4일 전까지)과 현재를 비교.
 * 스타 +SURGE_MIN_STARS, 또는 (스타 +100 이상이면서 15% 이상 성장), 또는 설치 +SURGE_MIN_INSTALLS.
 */
export function surges(idx: Index, now = Date.now()): Surge[] {
  const today = new Date(now).toISOString().slice(0, 10);
  const base = Object.keys(idx.history)
    .filter((d) => d < today)
    .sort()
    .pop();
  if (!base || now - Date.parse(`${base}T00:00:00Z`) > 4 * DAY) return [];
  const snap = idx.history[base];
  return idx.entries
    .map((entry): Surge | null => {
      const old = snap[entry.repo.toLowerCase()];
      if (!old) return null;
      const starDelta = entry.stars - old[0];
      const installDelta = entry.installs - old[1];
      const hot =
        starDelta >= config.surgeMinStars ||
        (starDelta >= 100 && old[0] > 0 && starDelta / old[0] >= 0.15) ||
        installDelta >= config.surgeMinInstalls;
      return hot ? { entry, starDelta, installDelta } : null;
    })
    .filter((x): x is Surge => !!x)
    .sort((a, b) => b.starDelta + b.installDelta / 5 - (a.starDelta + a.installDelta / 5));
}

/* ───────────── 대화 감지 ───────────── */

/** 한국어/영어 주제어 → 검색어. 앞에 있을수록 먼저 나열 */
const TOPICS: [RegExp, string][] = [
  [/테라폼|terraform/i, "terraform"],
  [/도커|docker/i, "docker"],
  [/쿠버|kubernetes|\bk8s\b/i, "kubernetes"],
  [/\baws\b|아마존/i, "aws"],
  [/깃허브\s*액션|github\s*actions?|\bci\s*\/?\s*cd\b/i, "github actions"],
  [/\bpdf\b|피디에프/i, "pdf"],
  [/엑셀|excel|xlsx|스프레드시트/i, "xlsx excel spreadsheet"],
  [/워드|docx/i, "docx word"],
  [/파워포인트|\bppt\b|pptx|슬라이드/i, "pptx slides"],
  [/테스트|\btests?\b|\btdd\b/i, "test tdd"],
  [/리팩|refactor/i, "refactor"],
  [/리뷰|review/i, "review"],
  [/보안|security|취약/i, "security"],
  [/디자인|\bui\b|\bux\b|유아이|프론트/i, "design frontend"],
  [/커밋|\bgit\b|\bcommit\b/i, "git commit"],
  [/디버|debug|버그/i, "debug"],
  [/문서|\bdocs?\b|readme/i, "docs documentation"],
  [/노션|notion/i, "notion"],
  [/슬랙|slack/i, "slack"],
  [/피그마|figma/i, "figma"],
  [/데이터|\bsql\b|\bdb\b|database/i, "data sql"],
  [/배포|deploy/i, "deploy"],
  [/번역|translat/i, "translate"],
  [/마케팅|\bseo\b/i, "marketing seo"],
  [/기획|\bprd\b|스펙/i, "spec prd planning"],
];

const CONTEXT = /claude|클로드|클코|\bskills?\b|스킬|\bplugins?\b|플러그인|\bmcp\b/i;
const ASK = /추천|뭐|뭘|무엇|없을까|있을까|있나|좋은|괜찮은|찾|알려|어떤|어떻게|recommend|suggest|\bany\b|\bbest\b|[?？]/i;

export function topicTerms(text: string): string[] {
  return [...new Set(TOPICS.filter(([re]) => re.test(text)).map(([, t]) => t))];
}

/**
 * 관찰 채널의 일반 대화용: "Claude/스킬 맥락 + 질문/추천 요청 + 알려진 주제어" 가 모두 있을 때만 검색어를 돌려준다.
 * (조용한 편이 낫다 — 애매하면 null)
 */
export function detectIntent(text: string): string | null {
  if (text.length < 6 || text.length > 400) return null;
  if (!CONTEXT.test(text) || !ASK.test(text)) return null;
  const terms = topicTerms(text);
  return terms.length ? terms.join(" ") : null;
}

/** 봇을 멘션해서 직접 물어본 경우: 주제어 → 영어 단어 → 전체 상위 순으로 폴백 */
export function recommendFromText(entries: Entry[], text: string, limit = 3): { list: Entry[]; matched: boolean } {
  const english = (text.match(/[A-Za-z][A-Za-z0-9+#.-]{2,}/g) ?? []).slice(0, 6).join(" ");
  const query = topicTerms(text).join(" ") || english;
  const hits = query ? searchScored(entries, query, limit).filter((x) => x.m >= MIN_MATCH) : [];
  return hits.length ? { list: hits.map((h) => h.e), matched: true } : { list: entries.slice(0, limit), matched: false };
}
