import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { ADMIN_PERMISSION } from "./commands.js";
import {
  allGuilds,
  flushCommunity,
  guild,
  loadCommunity,
  markDigestSent,
  rankForGuild,
  recordClick,
  setDigest,
  signals,
  toggleVote,
} from "./community.js";
import { config } from "./config.js";
import { crawl } from "./crawler.js";
import { buildDigest, isDigestTime, rising, serverFavorites } from "./digest.js";
import { renderInstall } from "./install.js";
import { search } from "./ranking.js";
import { getIndex, isStale, loadIndex, saveIndex } from "./store.js";
import { cachedSummary, loadSummaries, summarize } from "./summary.js";
import type { Entry } from "./types.js";
import { chunkMessage, COLOR, fmtNum, infoEmbed, installComponents, listEmbed, pickRepoMenu } from "./views.js";
import { EmbedBuilder } from "discord.js";

const Ephemeral = MessageFlags.Ephemeral;
const WEEK = 7 * 86_400_000;

let crawling: Promise<void> | null = null;
function refresh(): Promise<void> {
  crawling ??= crawl(getIndex())
    .then(saveIndex)
    .catch((e) => console.error("[refresh] failed", e))
    .finally(() => {
      crawling = null;
    });
  return crawling;
}

const findEntry = (repo: string): Entry | undefined =>
  getIndex().entries.find((e) => e.repo.toLowerCase() === repo.toLowerCase());

const sigFor = (guildId: string | null) => (e: Entry) => signals(guildId, e.repo);

async function showInfo(i: ChatInputCommandInteraction | StringSelectMenuInteraction, e: Entry) {
  const s = signals(i.guildId, e.repo);
  const cached = cachedSummary(e);
  await i.reply({ embeds: [infoEmbed(e, s, cached)], components: installComponents(e, s.votes), flags: Ephemeral });
  if (!cached) {
    // 요약은 느릴 수 있으니 먼저 보여주고 나중에 채움
    const ko = await summarize(e);
    if (ko) await i.editReply({ embeds: [infoEmbed(e, signals(i.guildId, e.repo), ko)] }).catch(() => {});
  }
}

function isAdmin(i: ChatInputCommandInteraction) {
  return !i.inGuild() || !!i.memberPermissions?.has(ADMIN_PERMISSION);
}

async function onCommand(i: ChatInputCommandInteraction) {
  if (i.commandName !== "skills") return;
  const group = i.options.getSubcommandGroup(false);
  const sub = i.options.getSubcommand();
  const idx = getIndex();

  if (sub === "refresh") {
    if (!isAdmin(i)) return i.reply({ content: "서버 관리 권한이 필요하다냥.", flags: Ephemeral });
    await i.reply({ content: "🔄 열심히 긁어오는 중이다냥… (수 분 걸려요)", flags: Ephemeral });
    await refresh();
    return i.editReply(`✅ 갱신 완료: ${getIndex().entries.length}개 레포`);
  }

  if (group === "digest") {
    if (!i.inGuild()) return i.reply({ content: "서버에서만 쓸 수 있어요.", flags: Ephemeral });
    if (!isAdmin(i)) return i.reply({ content: "서버 관리 권한이 필요하다냥.", flags: Ephemeral });
    if (sub === "set") {
      const ch = i.options.getChannel("channel", true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
      setDigest(i.guildId, ch.id);
      const days = ["일", "월", "화", "수", "목", "금", "토"];
      return i.reply({
        content: `📮 매주 ${days[config.digestDay]}요일 ${config.digestHour}시에 <#${ch.id}> 로 다이제스트를 보낼게요!`,
        flags: Ephemeral,
      });
    }
    if (sub === "off") {
      setDigest(i.guildId, undefined);
      return i.reply({ content: "다이제스트를 껐어요.", flags: Ephemeral });
    }
    if (sub === "now") {
      await i.deferReply({ flags: Ephemeral });
      const since = new Date(guild(i.guildId).lastDigestAt ?? Date.now() - WEEK).getTime();
      return i.editReply({ embeds: [await buildDigest(idx, i.guildId, since)] });
    }
  }

  if (!idx.entries.length) {
    return i.reply({ content: "아직 인덱스를 만드는 중이다냥. 잠시 후 다시 시도해 주세요 🐾", flags: Ephemeral });
  }

  if (sub === "top") {
    const cat = i.options.getString("category");
    const type = i.options.getString("type");
    const limit = i.options.getInteger("limit") ?? 10;
    let list = rankForGuild(idx.entries, i.guildId);
    if (cat) list = list.filter((e) => e.categories.includes(cat));
    if (type === "plugin") list = list.filter((e) => e.marketplaceName);
    if (type === "skill") list = list.filter((e) => !e.marketplaceName);
    list = list.slice(0, limit);
    const title = `🏆 인기 스킬 TOP ${list.length}${cat ? ` · ${cat}` : ""}`;
    return i.reply({
      embeds: [listEmbed(title, list, idx.updatedAt, sigFor(i.guildId), cachedSummary)],
      components: pickRepoMenu(list),
    });
  }

  if (sub === "search") {
    const q = i.options.getString("query", true);
    const list = search(rankForGuild(idx.entries, i.guildId), q, 10);
    return i.reply({
      embeds: [listEmbed(`🔎 "${q}" 찾아왔다냥`, list, idx.updatedAt, sigFor(i.guildId), cachedSummary)],
      components: pickRepoMenu(list),
    });
  }

  if (sub === "server") {
    if (!i.inGuild()) return i.reply({ content: "서버에서만 쓸 수 있어요.", flags: Ephemeral });
    const favs = serverFavorites(idx, i.guildId, 0, 10);
    if (!favs.length) {
      return i.reply({ content: "아직 우리 서버 기록이 없다냥. `/skills info` 에서 👍 를 눌러주세요!", flags: Ephemeral });
    }
    return i.reply({
      embeds: [
        listEmbed(`💗 우리 서버 인기 스킬`, favs.map((f) => f.e), idx.updatedAt, sigFor(i.guildId), cachedSummary),
      ],
      components: pickRepoMenu(favs.map((f) => f.e)),
    });
  }

  if (sub === "rising") {
    const list = rising(idx, 7, 10);
    if (!list.length) {
      return i.reply({ content: "비교할 기록이 아직 부족하다냥 (며칠 쌓이면 보여요).", flags: Ephemeral });
    }
    const embed = new EmbedBuilder()
      .setTitle("📈 최근 7일 급상승")
      .setColor(COLOR)
      .setDescription(
        list
          .map(
            (r, n) =>
              `**${n + 1}. [${r.entry.repo}](${r.entry.url})** ⭐ +${fmtNum(r.starDelta)}` +
              (r.installDelta > 0 ? ` · 📥 +${fmtNum(r.installDelta)}` : "") +
              `\n${(cachedSummary(r.entry) ?? r.entry.description).slice(0, 120)}`,
          )
          .join("\n\n"),
      );
    return i.reply({ embeds: [embed], components: pickRepoMenu(list.map((r) => r.entry)) });
  }

  if (sub === "info") {
    const e = findEntry(i.options.getString("repo", true));
    if (!e) return i.reply({ content: "인덱스에 없는 레포다냥. `/skills search` 로 찾아보세요.", flags: Ephemeral });
    return showInfo(i, e);
  }
}

async function onAutocomplete(i: AutocompleteInteraction) {
  const q = String(i.options.getFocused() ?? "");
  const list = q ? search(getIndex().entries, q, 25) : getIndex().entries.slice(0, 25);
  await i.respond(list.map((e) => ({ name: `${e.repo} (⭐${fmtNum(e.stars)})`.slice(0, 100), value: e.repo.slice(0, 100) })));
}

async function onSelect(i: StringSelectMenuInteraction) {
  if (i.customId === "pick") {
    const e = findEntry(i.values[0]);
    if (!e) return i.reply({ content: "인덱스가 갱신돼서 못 찾았다냥.", flags: Ephemeral });
    return showInfo(i, e);
  }

  if (i.customId.startsWith("inst:")) {
    const e = findEntry(i.customId.slice(5));
    if (!e) return i.reply({ content: "인덱스가 갱신돼서 못 찾았다냥.", flags: Ephemeral });
    const items = i.values.map((v) => e.items[Number(v)]).filter(Boolean);
    if (i.guildId) recordClick(i.guildId, e.repo);
    const [first, ...rest] = chunkMessage(`### 📦 ${e.repo} 설치\n${renderInstall(e, items)}`);
    await i.reply({ content: first, flags: Ephemeral });
    for (const c of rest) await i.followUp({ content: c, flags: Ephemeral });
  }
}

async function onButton(i: ButtonInteraction) {
  if (!i.customId.startsWith("vote:")) return;
  if (!i.guildId) return i.reply({ content: "추천은 서버에서만 할 수 있어요.", flags: Ephemeral });
  const e = findEntry(i.customId.slice(5));
  if (!e) return i.reply({ content: "인덱스가 갱신돼서 못 찾았다냥.", flags: Ephemeral });
  const { voted } = toggleVote(i.guildId, e.repo, i.user.id);
  const s = signals(i.guildId, e.repo);
  await i.update({ embeds: [infoEmbed(e, s, cachedSummary(e))], components: installComponents(e, s.votes) });
  await i.followUp({ content: voted ? `👍 ${e.repo} 추천 완료다냥!` : "추천을 취소했어요.", flags: Ephemeral });
}

async function digestTick(client: Client) {
  const idx = getIndex();
  if (!idx.entries.length) return;
  for (const [guildId, g] of allGuilds()) {
    if (!g.digestChannelId || !isDigestTime(g.lastDigestAt)) continue;
    try {
      const ch = await client.channels.fetch(g.digestChannelId);
      if (!ch?.isSendable()) continue;
      const since = new Date(g.lastDigestAt ?? Date.now() - WEEK).getTime();
      await ch.send({ embeds: [await buildDigest(idx, guildId, since)] });
      markDigestSent(guildId);
      console.log(`[digest] sent to ${guildId}`);
    } catch (e) {
      console.error(`[digest] ${guildId} failed`, e);
    }
  }
}

async function main() {
  if (!config.discordToken) throw new Error("DISCORD_TOKEN 이 필요합니다");
  if (!config.githubToken) console.warn("[warn] GITHUB_TOKEN 이 없으면 GitHub API 한도(60회/시간)로 크롤링이 거의 불가능합니다");

  await Promise.all([loadIndex(), loadCommunity(), loadSummaries()]);
  if (isStale(getIndex(), config.refreshHours)) void refresh();
  setInterval(() => void refresh(), config.refreshHours * 3_600_000).unref();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    // 레포 설명 등 외부 텍스트에 @everyone 이 섞여 있어도 아무도 멘션되지 않게
    allowedMentions: { parse: [] },
  });
  client.once(Events.ClientReady, (c) => {
    console.log(`[bot] logged in as ${c.user.tag} 🐱`);
    setInterval(() => void digestTick(client), 10 * 60_000).unref();
    void digestTick(client);
  });
  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand()) await onCommand(i);
      else if (i.isAutocomplete()) await onAutocomplete(i);
      else if (i.isStringSelectMenu()) await onSelect(i);
      else if (i.isButton()) await onButton(i);
    } catch (e) {
      console.error("[bot] interaction error", e);
      if (i.isRepliable() && !i.replied && !i.deferred) {
        await i.reply({ content: "앗, 오류가 났다냥 😿", flags: Ephemeral }).catch(() => {});
      }
    }
  });

  const shutdown = () => {
    console.log("[bot] shutting down");
    void flushCommunity()
      .catch(() => {})
      .finally(() => void client.destroy().finally(() => process.exit(0)));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await client.login(config.discordToken);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
