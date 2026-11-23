/**
 * 서버(길드)별 커뮤니티 신호: 👍 투표, 설치 명령 조회 수, 다이제스트 채널 설정.
 * data/community.json 하나에 저장 (서버 몇 개 규모면 충분).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { communityBonus } from "./ranking.js";
import type { Entry } from "./types.js";

export interface GuildData {
  /** repo(lowercase) → 투표한 userId 목록 */
  votes: Record<string, string[]>;
  /** repo(lowercase) → 설치 명령 조회 이벤트 시각(ms) 목록. 최근 90일만 유지 */
  clicks: Record<string, number[]>;
  digestChannelId?: string;
  lastDigestAt?: string;
  /** '오늘의 스킬' + 급상승 알림 채널 */
  autoChannelId?: string;
  /** 발송 시각(서울, 0~23). 없으면 config.dailyHour */
  dailyHour?: number;
  /** 급상승 즉시 알림 (undefined = 켜짐) */
  alertsOn?: boolean;
  /** 마지막 '오늘의 스킬' 발송 날짜 (서울 기준 YYYY-MM-DD) */
  lastDailyDate?: string;
  /** 이미 소개한 레포(lowercase), 최근 것만 */
  shown?: string[];
  /** 다음에 우선할 카테고리 순번 */
  categoryCursor?: number;
  /** repo(lowercase) → 급상승 알림을 보낸 시각(ms) */
  alerted?: Record<string, number>;
  /** 대화 감지 추천을 켠 채널 */
  watchChannelIds?: string[];
}

interface CommunityFile {
  guilds: Record<string, GuildData>;
}

const file = () => join(config.dataDir, "community.json");
let data: CommunityFile = { guilds: {} };
let saveTimer: NodeJS.Timeout | null = null;

const CLICK_TTL = 90 * 86_400_000;

export async function loadCommunity() {
  try {
    data = JSON.parse(await readFile(file(), "utf8")) as CommunityFile;
    data.guilds ??= {};
  } catch {
    // 첫 실행
  }
}

async function flush() {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = file() + ".tmp";
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file());
}

/** 잦은 쓰기를 묶어서 저장 */
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush().catch((e) => console.error("[community] save failed", e));
  }, 2000);
  saveTimer.unref();
}

export async function flushCommunity() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  await flush();
}

export function guild(id: string): GuildData {
  return (data.guilds[id] ??= { votes: {}, clicks: {} });
}

export function allGuilds(): [string, GuildData][] {
  return Object.entries(data.guilds);
}

/** 투표 토글. 반환: 투표 후 상태(true=투표함)와 현재 표 수 */
export function toggleVote(guildId: string, repo: string, userId: string): { voted: boolean; count: number } {
  const g = guild(guildId);
  const k = repo.toLowerCase();
  const list = (g.votes[k] ??= []);
  const i = list.indexOf(userId);
  if (i >= 0) list.splice(i, 1);
  else list.push(userId);
  if (!list.length) delete g.votes[k];
  scheduleSave();
  return { voted: i < 0, count: g.votes[k]?.length ?? 0 };
}

export function recordClick(guildId: string, repo: string, now = Date.now()) {
  const g = guild(guildId);
  const k = repo.toLowerCase();
  g.clicks[k] = [...(g.clicks[k] ?? []).filter((t) => now - t < CLICK_TTL), now];
  scheduleSave();
}

export function signals(guildId: string | null, repo: string, sinceMs = 0): { votes: number; clicks: number } {
  if (!guildId) return { votes: 0, clicks: 0 };
  const g = data.guilds[guildId];
  if (!g) return { votes: 0, clicks: 0 };
  const k = repo.toLowerCase();
  const now = Date.now();
  return {
    votes: g.votes[k]?.length ?? 0,
    clicks: (g.clicks[k] ?? []).filter((t) => now - t < CLICK_TTL && t >= sinceMs).length,
  };
}

export function setDigest(guildId: string, channelId: string | undefined) {
  const g = guild(guildId);
  if (channelId) g.digestChannelId = channelId;
  else delete g.digestChannelId;
  scheduleSave();
}

export function markDigestSent(guildId: string, at = new Date()) {
  guild(guildId).lastDigestAt = at.toISOString();
  scheduleSave();
}

export function setAuto(guildId: string, o: { channelId?: string; hour?: number; alerts?: boolean }) {
  const g = guild(guildId);
  if (o.channelId) {
    g.autoChannelId = o.channelId;
    if (o.hour !== undefined) g.dailyHour = o.hour;
    if (o.alerts !== undefined) g.alertsOn = o.alerts;
  } else {
    delete g.autoChannelId;
  }
  scheduleSave();
}

export function setWatch(guildId: string, channelId: string, on: boolean) {
  const g = guild(guildId);
  const set = new Set(g.watchChannelIds ?? []);
  if (on) set.add(channelId);
  else set.delete(channelId);
  g.watchChannelIds = [...set];
  scheduleSave();
}

export function markDaily(guildId: string, o: { date: string; picks: string[]; cursor: number; reset: boolean }) {
  const g = guild(guildId);
  g.lastDailyDate = o.date;
  g.categoryCursor = o.cursor;
  g.shown = [...(o.reset ? [] : g.shown ?? []), ...o.picks.map((r) => r.toLowerCase())].slice(-200);
  scheduleSave();
}

export function markAlerted(guildId: string, repo: string, now = Date.now()) {
  const g = guild(guildId);
  const k = repo.toLowerCase();
  const alerted: Record<string, number> = {};
  // 30일 지난 기록은 정리
  for (const [r, t] of Object.entries(g.alerted ?? {})) if (now - t < 30 * 86_400_000) alerted[r] = t;
  alerted[k] = now;
  g.alerted = alerted;
  scheduleSave();
}

/** 테스트용 */
export function _reset() {
  data = { guilds: {} };
}

/** 전역 점수 + 이 서버의 커뮤니티 가산점으로 정렬 */
export function rankForGuild(entries: Entry[], guildId: string | null): Entry[] {
  if (!guildId || !data.guilds[guildId]) return entries;
  const total = (e: Entry) => {
    const s = signals(guildId, e.repo);
    return e.score + communityBonus(s.votes, s.clicks);
  };
  return [...entries].sort((a, b) => total(b) - total(a));
}
