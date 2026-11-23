import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type APIEmbedField,
} from "discord.js";
import { scoreBreakdown } from "./ranking.js";
import type { Entry } from "./types.js";

export const COLOR = 0xf6a5c0;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
export const fmtNum = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

export interface Signals {
  votes: number;
  clicks: number;
}

export function badges(e: Entry, s?: Signals): string {
  const b: string[] = [];
  if (e.official) b.push("🏛️ 공식");
  if (e.curatedBy.length) b.push(`📚 큐레이션 ${e.curatedBy.length}`);
  b.push(e.marketplaceName ? `🧩 플러그인 ${e.items.length}` : `📄 스킬 ${e.items.length}`);
  if (s?.votes) b.push(`👍 ${s.votes}`);
  return b.join(" · ");
}

function stats(e: Entry) {
  return `⭐ ${fmtNum(e.stars)}` + (e.installs ? ` · 📥 ${fmtNum(e.installs)}` : "");
}

export function listEmbed(
  title: string,
  entries: Entry[],
  updatedAt: string,
  sig: (e: Entry) => Signals | undefined = () => undefined,
  summaryOf: (e: Entry) => string | null = () => null,
): EmbedBuilder {
  const lines = entries.map(
    (e, i) =>
      `**${i + 1}. [${e.repo}](${e.url})** — ${stats(e)}\n` +
      `${badges(e, sig(e))}\n${clip(summaryOf(e) ?? (e.description || e.items[0]?.description || ""), 140)}`,
  );
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(COLOR)
    .setDescription(clip(lines.join("\n\n"), 4000) || "결과가 없다냥… 🙀")
    .setFooter({
      text: `🐾 ⭐ GitHub 스타 · 📥 skills.sh 설치 수 · 갱신 ${new Date(updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
    });
}

export function pickRepoMenu(entries: Entry[]) {
  if (!entries.length) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId("pick")
    .setPlaceholder("🐾 설치할 레포 고르기 →")
    .addOptions(
      entries.slice(0, 25).map((e) => ({
        label: clip(e.repo, 100),
        value: e.repo.slice(0, 100),
        description: clip(`${stats(e)} · ${e.description || e.items[0]?.description || ""}`, 100),
      })),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

export function infoEmbed(e: Entry, s: Signals = { votes: 0, clicks: 0 }, summaryKo: string | null = null): EmbedBuilder {
  const fields: APIEmbedField[] = [
    { name: "⭐ Stars", value: e.stars.toLocaleString(), inline: true },
    { name: "📥 skills.sh 설치", value: e.installs ? e.installs.toLocaleString() : "—", inline: true },
    { name: "💗 우리 서버", value: `👍 ${s.votes} · 조회 ${s.clicks}`, inline: true },
    { name: "점수", value: `-# ${scoreBreakdown(e, s.votes, s.clicks)}` },
    { name: "최근 푸시", value: `<t:${Math.floor(new Date(e.pushedAt).getTime() / 1000)}:R>`, inline: true },
  ];
  if (e.marketplaceName) fields.push({ name: "마켓플레이스", value: `\`${e.marketplaceName}\``, inline: true });
  if (e.license) fields.push({ name: "License", value: e.license, inline: true });
  if (e.categories.length) fields.push({ name: "카테고리", value: e.categories.join(", "), inline: true });
  if (e.curatedBy.length) fields.push({ name: "수록된 큐레이션", value: e.curatedBy.join("\n") });

  const shown = e.items.slice(0, 15);
  const itemLines = shown.map(
    (i) => `• \`${i.name}\`${i.installs ? ` 📥${fmtNum(i.installs)}` : ""} ${clip(i.description, 80)}`,
  );
  if (e.items.length > shown.length) itemLines.push(`…외 ${e.items.length - shown.length}개`);
  fields.push({ name: e.marketplaceName ? "플러그인" : "스킬", value: clip(itemLines.join("\n"), 1024) });

  const desc = [badges(e, s), "", summaryKo ? `🐱 ${summaryKo}` : "", clip(e.description, 400)].filter(Boolean);
  return new EmbedBuilder()
    .setTitle(e.repo)
    .setURL(e.url)
    .setColor(e.official ? 0x7aa7ff : COLOR)
    .setDescription(desc.join("\n"))
    .addFields(fields);
}

export function installComponents(e: Entry, votes = 0) {
  const rows: ActionRowBuilder<any>[] = [];
  const opts = e.items.slice(0, 25);
  if (opts.length && e.repo.length <= 90) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`inst:${e.repo}`)
          .setPlaceholder(`📦 설치할 ${e.marketplaceName ? "플러그인" : "스킬"} 선택 (여러 개 가능)`)
          .setMinValues(1)
          .setMaxValues(Math.min(10, opts.length))
          .addOptions(
            opts.map((i, idx) => ({
              label: clip(i.name, 100),
              value: String(idx),
              description: clip(
                (i.installs ? `📥${fmtNum(i.installs)} · ` : "") +
                  (i.description || (i.kind === "plugin" ? "plugin" : i.path || "skill")),
                100,
              ),
            })),
          ),
      ),
    );
  }
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`vote:${e.repo}`.slice(0, 100))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("👍")
      .setLabel(`추천 ${votes}`),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("GitHub").setURL(e.url),
  ];
  if (e.installs) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("skills.sh").setURL(`https://skills.sh/${e.repo}`));
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
  return rows;
}

/** 디스코드 2000자 제한 대응 — 코드블록이 깨지지 않게 줄 단위로 나눔 */
export function chunkMessage(text: string, max = 1900): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    if (cur.length + line.length + 1 > max) {
      out.push(fence ? cur + "\n```" : cur);
      cur = fence ? fence : "";
    }
    cur = cur ? `${cur}\n${line}` : line;
    if (line.startsWith("```")) fence = fence ? null : line;
  }
  if (cur) out.push(cur);
  return out;
}
