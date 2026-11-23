import { EmbedBuilder } from "discord.js";
import { config } from "./config.js";
import { signals } from "./community.js";
import { summarize } from "./summary.js";
import type { Entry, Index } from "./types.js";

const DAY = 86_400_000;

export interface Rising {
  entry: Entry;
  starDelta: number;
  installDelta: number;
}

/** days 일 전(이전 중 가장 가까운) 스냅샷과 비교해 스타/설치 증가량 계산 */
export function rising(idx: Index, days = 7, limit = 5, now = Date.now()): Rising[] {
  const target = new Date(now - days * DAY).toISOString().slice(0, 10);
  const dates = Object.keys(idx.history).sort();
  // target 이전 중 가장 최근, 없으면 3일 이상 지난 가장 오래된 스냅샷
  const minAge = new Date(now - 3 * DAY).toISOString().slice(0, 10);
  const base = [...dates].reverse().find((d) => d <= target) ?? dates.find((d) => d <= minAge);
  if (!base) return [];
  const snap = idx.history[base];
  return idx.entries
    .map((entry) => {
      const old = snap[entry.repo.toLowerCase()];
      if (!old) return null;
      return { entry, starDelta: entry.stars - old[0], installDelta: entry.installs - old[1] };
    })
    .filter((r): r is Rising => !!r && (r.starDelta > 0 || r.installDelta > 0))
    // 스타 증가율 위주, 설치 증가는 보조 (로그로 스케일 맞춤)
    .sort(
      (a, b) =>
        Math.log10(b.starDelta + 1) * 2 + Math.log10(b.installDelta + 1) -
        (Math.log10(a.starDelta + 1) * 2 + Math.log10(a.installDelta + 1)),
    )
    .slice(0, limit);
}

export function newcomers(idx: Index, sinceMs: number, limit = 5): Entry[] {
  return idx.entries.filter((e) => new Date(e.firstSeen).getTime() >= sinceMs).slice(0, limit);
}

export function serverFavorites(idx: Index, guildId: string, sinceMs: number, limit = 5) {
  return idx.entries
    .map((e) => ({ e, ...signals(guildId, e.repo, sinceMs) }))
    .filter((x) => x.votes || x.clicks)
    .sort((a, b) => b.votes * 3 + b.clicks - (a.votes * 3 + a.clicks))
    .slice(0, limit);
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const link = (e: Entry) => `[${e.repo}](${e.url})`;

export async function buildDigest(idx: Index, guildId: string, sinceMs: number): Promise<EmbedBuilder> {
  const fresh = newcomers(idx, sinceMs);
  const rise = rising(idx);
  const favs = serverFavorites(idx, guildId, sinceMs);

  const freshLines = await Promise.all(
    fresh.map(async (e) => {
      const ko = await summarize(e);
      return `• ${link(e)} ⭐${fmt(e.stars)}\n  ${ko ?? e.description.slice(0, 120)}`;
    }),
  );

  const embed = new EmbedBuilder()
    .setTitle("🐱 스킬냥 주간 다이제스트")
    .setColor(0xf6a5c0)
    .setDescription("이번 주 Claude Code 스킬 소식이다냥! `/skills info` 로 바로 설치 명령을 받을 수 있어요.")
    .setFooter({ text: "🐾 스킬냥 · 매주 자동 발송" })
    .setTimestamp(new Date());

  embed.addFields({ name: "🆕 새로 등장", value: freshLines.join("\n").slice(0, 1024) || "이번 주엔 없어요." });
  embed.addFields({
    name: "📈 급상승",
    value:
      rise
        .map(
          (r) =>
            `• ${link(r.entry)} ⭐ +${fmt(r.starDelta)}` + (r.installDelta > 0 ? ` · 설치 +${fmt(r.installDelta)}` : ""),
        )
        .join("\n")
        .slice(0, 1024) || "비교할 기록이 아직 부족해요 (일주일 정도 쌓이면 보여요).",
  });
  embed.addFields({
    name: "💗 우리 서버 인기",
    value:
      favs
        .map((f) => `• ${link(f.e)} 👍 ${f.votes} · 설치 조회 ${f.clicks}`)
        .join("\n")
        .slice(0, 1024) || "아직 투표가 없어요. `/skills info` 에서 👍 눌러주세요!",
  });
  return embed;
}

/** 지금이 (서울 기준) 다이제스트 발송 시점인지 */
export function isDigestTime(lastSentIso: string | undefined, now = new Date()): boolean {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  if (kst.getUTCDay() !== config.digestDay || kst.getUTCHours() < config.digestHour) return false;
  if (!lastSentIso) return true;
  return now.getTime() - new Date(lastSentIso).getTime() > 6 * DAY;
}
