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

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const fmtStars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

export function badges(e: Entry): string {
  const b: string[] = [];
  if (e.official) b.push("🏛️ 공식");
  if (e.curatedBy.length) b.push(`📚 큐레이션 ${e.curatedBy.length}`);
  b.push(e.marketplaceName ? `🧩 플러그인 ${e.items.length}` : `📄 스킬 ${e.items.length}`);
  return b.join(" · ");
}

export function listEmbed(title: string, entries: Entry[], updatedAt: string): EmbedBuilder {
  const lines = entries.map(
    (e, i) =>
      `**${i + 1}. [${e.repo}](${e.url})** — ⭐ ${fmtStars(e.stars)} · 점수 ${e.score}\n` +
      `${badges(e)}\n${clip(e.description || e.items[0]?.description || "", 140)}`,
  );
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0xd97757)
    .setDescription(lines.join("\n\n") || "결과가 없어요.")
    .setFooter({ text: `인덱스 갱신: ${new Date(updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 아래에서 골라 설치 명령 받기` });
}

export function pickRepoMenu(entries: Entry[]) {
  if (!entries.length) return [];
  const menu = new StringSelectMenuBuilder()
    .setCustomId("pick")
    .setPlaceholder("설치할 레포 선택 →")
    .addOptions(
      entries.slice(0, 25).map((e) => ({
        label: clip(e.repo, 100),
        value: e.repo,
        description: clip(`⭐ ${fmtStars(e.stars)} · ${e.description || e.items[0]?.description || ""}`, 100),
      })),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

export function infoEmbed(e: Entry): EmbedBuilder {
  const fields: APIEmbedField[] = [
    { name: "⭐ Stars", value: e.stars.toLocaleString(), inline: true },
    { name: "점수", value: `${e.score}\n-# ${scoreBreakdown(e)}`, inline: true },
    { name: "최근 푸시", value: `<t:${Math.floor(new Date(e.pushedAt).getTime() / 1000)}:R>`, inline: true },
  ];
  if (e.marketplaceName) fields.push({ name: "마켓플레이스", value: `\`${e.marketplaceName}\``, inline: true });
  if (e.license) fields.push({ name: "License", value: e.license, inline: true });
  if (e.categories.length) fields.push({ name: "카테고리", value: e.categories.join(", "), inline: true });
  if (e.curatedBy.length) fields.push({ name: "수록된 큐레이션", value: e.curatedBy.join("\n") });

  const shown = e.items.slice(0, 15);
  const itemLines = shown.map((i) => `• \`${i.name}\` ${clip(i.description, 90)}`);
  if (e.items.length > shown.length) itemLines.push(`…외 ${e.items.length - shown.length}개`);
  fields.push({ name: e.marketplaceName ? "플러그인" : "스킬", value: clip(itemLines.join("\n"), 1024) });

  return new EmbedBuilder()
    .setTitle(e.repo)
    .setURL(e.url)
    .setColor(e.official ? 0x2f80ed : 0xd97757)
    .setDescription(`${badges(e)}\n\n${clip(e.description, 500)}`)
    .addFields(fields);
}

export function installComponents(e: Entry) {
  const rows: ActionRowBuilder<any>[] = [];
  const opts = e.items.slice(0, 25);
  if (opts.length) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`inst:${e.repo}`)
          .setPlaceholder(`설치할 ${e.marketplaceName ? "플러그인" : "스킬"} 선택 (여러 개 가능)`)
          .setMinValues(1)
          .setMaxValues(Math.min(10, opts.length))
          .addOptions(
            opts.map((i, idx) => ({
              label: clip(i.name, 100),
              value: String(idx),
              description: clip(i.description || (i.kind === "plugin" ? "plugin" : i.path || "skill"), 100),
            })),
          ),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("GitHub에서 보기").setURL(e.url),
    ),
  );
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
