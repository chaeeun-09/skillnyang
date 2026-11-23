import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type StringSelectMenuInteraction,
} from "discord.js";
import { ADMIN_PERMISSION } from "./commands.js";
import {
  allGuilds,
  flushCommunity,
  guild,
  loadCommunity,
  markAlerted,
  markDaily,
  markDigestSent,
  rankForGuild,
  recordClick,
  setAuto,
  setDigest,
  setWatch,
  signals,
  toggleVote,
} from "./community.js";
import {
  ALERT_COOLDOWN,
  detectIntent,
  isDailyTime,
  kstDate,
  MIN_MATCH,
  pickDaily,
  recommendFromText,
  surges,
} from "./auto.js";
import { config } from "./config.js";
import { crawl } from "./crawler.js";
import { buildDigest, isDigestTime, rising, serverFavorites } from "./digest.js";
import { renderInstall } from "./install.js";
import { search, searchScored } from "./ranking.js";
import { getIndex, isStale, loadIndex, saveIndex } from "./store.js";
import { cachedSummary, loadSummaries, summarize } from "./summary.js";
import type { Entry } from "./types.js";
import {
  chunkMessage,
  COLOR,
  fmtNum,
  infoButtons,
  infoEmbed,
  installComponents,
  listEmbed,
  pickRepoMenu,
  surgeEmbed,
} from "./views.js";
import { EmbedBuilder } from "discord.js";

const Ephemeral = MessageFlags.Ephemeral;
const WEEK = 7 * 86_400_000;

let clientRef: Client | null = null;
let crawling: Promise<void> | null = null;
function refresh(): Promise<void> {
  crawling ??= crawl(getIndex())
    .then(saveIndex)
    .then(() => {
      if (clientRef) void alertTick(clientRef);
    })
    .catch((e) => console.error("[refresh] failed", e))
    .finally(() => {
      crawling = null;
    });
  return crawling;
}

const findEntry = (repo: string): Entry | undefined =>
  getIndex().entries.find((e) => e.repo.toLowerCase() === repo.toLowerCase());

const sigFor = (guildId: string | null) => (e: Entry) => signals(guildId, e.repo);

async function showInfo(i: ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction, e: Entry) {
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

  if (group === "auto") {
    if (!i.inGuild()) return i.reply({ content: "서버에서만 쓸 수 있어요.", flags: Ephemeral });
    if (!isAdmin(i)) return i.reply({ content: "서버 관리 권한이 필요하다냥.", flags: Ephemeral });
    const g = guild(i.guildId);
    const types = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

    if (sub === "set") {
      const ch = i.options.getChannel("channel", true, [...types]);
      const hour = i.options.getInteger("hour") ?? undefined;
      const alerts = i.options.getBoolean("alerts") ?? undefined;
      setAuto(i.guildId, { channelId: ch.id, hour, alerts });
      return i.reply({
        content:
          `🌅 매일 ${hour ?? g.dailyHour ?? config.dailyHour}시(서울)에 <#${ch.id}> 로 '오늘의 스킬'을 올릴게요!\n` +
          `🔥 급상승 즉시 알림: ${g.alertsOn === false ? "꺼짐" : "켜짐"}`,
        flags: Ephemeral,
      });
    }
    if (sub === "off") {
      setAuto(i.guildId, {});
      return i.reply({ content: "오늘의 스킬과 급상승 알림을 껐어요.", flags: Ephemeral });
    }
    if (sub === "watch") {
      const ch = i.options.getChannel("channel", true, [...types]);
      const on = i.options.getBoolean("enabled", true);
      setWatch(i.guildId, ch.id, on);
      const warn =
        on && !config.enableMessageContent
          ? "\n⚠️ 아직 봇에 메시지 읽기 권한이 꺼져 있어요. 서버 `.env` 에 `ENABLE_MESSAGE_CONTENT=true` 를 넣고, 개발자 포털 Bot 메뉴에서 **Message Content Intent** 를 켠 뒤 봇을 재시작해야 동작해요."
          : "";
      return i.reply({
        content: (on ? `👀 <#${ch.id}> 대화에서 스킬 얘기가 나오면 관련 스킬을 제안할게요.` : `<#${ch.id}> 관찰을 껐어요.`) + warn,
        flags: Ephemeral,
      });
    }
    if (sub === "now") {
      if (!idx.entries.length) return i.reply({ content: "아직 인덱스를 만드는 중이다냥.", flags: Ephemeral });
      const { picks } = pickDaily(rankForGuild(idx.entries, i.guildId), g);
      return i.reply({
        embeds: [listEmbed("🌅 오늘의 스킬 (미리보기)", picks, idx.updatedAt, sigFor(i.guildId), cachedSummary)],
        components: pickRepoMenu(picks),
        flags: Ephemeral,
      });
    }
    if (sub === "status") {
      const watch = (g.watchChannelIds ?? []).map((c) => `<#${c}>`).join(", ") || "없음";
      return i.reply({
        content: [
          `🌅 오늘의 스킬: ${g.autoChannelId ? `<#${g.autoChannelId}> · 매일 ${g.dailyHour ?? config.dailyHour}시(서울)` : "꺼짐"}`,
          `🔥 급상승 알림: ${g.autoChannelId ? (g.alertsOn === false ? "꺼짐" : "켜짐") : "꺼짐 (채널 미설정)"}`,
          `👀 대화 감지 채널: ${watch}${config.enableMessageContent ? "" : " (⚠️ ENABLE_MESSAGE_CONTENT 꺼져 있음)"}`,
          `📮 주간 다이제스트: ${g.digestChannelId ? `<#${g.digestChannelId}>` : "꺼짐"}`,
        ].join("\n"),
        flags: Ephemeral,
      });
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
  if (i.customId.startsWith("info:")) {
    const e = findEntry(i.customId.slice(5));
    if (!e) return i.reply({ content: "인덱스가 갱신돼서 못 찾았다냥.", flags: Ephemeral });
    return showInfo(i, e);
  }
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

async function dailyTick(client: Client) {
  const idx = getIndex();
  if (!idx.entries.length) return;
  for (const [guildId, g] of allGuilds()) {
    if (!g.autoChannelId || !isDailyTime(g)) continue;
    try {
      const { picks, nextCursor, reset } = pickDaily(rankForGuild(idx.entries, guildId), g);
      // 전송이 실패해도 오늘은 다시 시도하지 않는다 (권한 문제로 10분마다 재시도하는 것 방지)
      markDaily(guildId, { date: kstDate(), picks: picks.map((p) => p.repo), cursor: nextCursor, reset });
      if (!picks.length) continue;
      const ch = await client.channels.fetch(g.autoChannelId);
      if (!ch?.isSendable()) continue;
      await Promise.all(picks.map((p) => summarize(p)));
      await ch.send({
        embeds: [listEmbed("🌅 오늘의 스킬", picks, idx.updatedAt, sigFor(guildId), cachedSummary)],
        components: pickRepoMenu(picks),
      });
      console.log(`[daily] sent to ${guildId}`);
    } catch (e) {
      console.error(`[daily] ${guildId} failed`, e);
    }
  }
}

async function alertTick(client: Client) {
  const hits = surges(getIndex());
  if (!hits.length) return;
  for (const [guildId, g] of allGuilds()) {
    if (!g.autoChannelId || g.alertsOn === false) continue;
    const fresh = hits
      .filter((h) => Date.now() - (g.alerted?.[h.entry.repo.toLowerCase()] ?? 0) > ALERT_COOLDOWN)
      .slice(0, 3);
    if (!fresh.length) continue;
    try {
      const ch = await client.channels.fetch(g.autoChannelId);
      if (!ch?.isSendable()) continue;
      await Promise.all(fresh.map((h) => summarize(h.entry)));
      for (const h of fresh) markAlerted(guildId, h.entry.repo);
      await ch.send({
        embeds: [surgeEmbed(fresh, cachedSummary)],
        components: infoButtons(fresh.map((h) => h.entry)),
      });
      console.log(`[alert] ${fresh.length} surge(s) → ${guildId}`);
    } catch (e) {
      console.error(`[alert] ${guildId} failed`, e);
    }
  }
}

const lastSuggestInChannel = new Map<string, number>();
const lastSuggestToUser = new Map<string, number>();

/** 대화 내용은 저장하지 않고, 메모리에서 키워드 매칭만 한 뒤 버린다 */
async function onMessage(m: Message, client: Client) {
  if (m.author.bot || !m.inGuild() || !client.user) return;
  const mentioned = m.mentions.users.has(client.user.id);
  const watching = config.enableMessageContent && !!guild(m.guildId).watchChannelIds?.includes(m.channelId);
  if (!mentioned && !watching) return;

  const idx = getIndex();
  if (!idx.entries.length) return;
  const ranked = rankForGuild(idx.entries, m.guildId);
  const reply = { allowedMentions: { repliedUser: false } } as const;

  if (mentioned) {
    const text = m.content.replace(/<@!?\d+>/g, "").trim();
    const { list, matched } = recommendFromText(ranked, text);
    await m.reply({
      ...reply,
      embeds: [
        listEmbed(
          matched ? "🐱 이런 스킬은 어때요?" : "🐱 딱 맞는 건 못 찾았지만, 요즘 인기 스킬이에요",
          list,
          idx.updatedAt,
          sigFor(m.guildId),
          cachedSummary,
        ),
      ],
      components: infoButtons(list),
    });
    return;
  }

  const query = detectIntent(m.content);
  if (!query) return;
  const now = Date.now();
  if (now - (lastSuggestInChannel.get(m.channelId) ?? 0) < config.suggestChannelCooldownMin * 60_000) return;
  if (now - (lastSuggestToUser.get(m.author.id) ?? 0) < config.suggestUserCooldownMin * 60_000) return;
  const hits = searchScored(ranked, query, 2).filter((x) => x.m >= MIN_MATCH);
  if (!hits.length) return;
  lastSuggestInChannel.set(m.channelId, now);
  lastSuggestToUser.set(m.author.id, now);
  const list = hits.map((h) => h.e);
  await m.reply({
    ...reply,
    embeds: [listEmbed("🐱 혹시 이런 스킬 찾으세요?", list, idx.updatedAt, sigFor(m.guildId), cachedSummary)],
    components: infoButtons(list),
  });
}

async function main() {
  if (!config.discordToken) throw new Error("DISCORD_TOKEN 이 필요합니다");
  if (!config.githubToken) console.warn("[warn] GITHUB_TOKEN 이 없으면 GitHub API 한도(60회/시간)로 크롤링이 거의 불가능합니다");

  await Promise.all([loadIndex(), loadCommunity(), loadSummaries()]);
  if (isStale(getIndex(), config.refreshHours)) void refresh();
  setInterval(() => void refresh(), config.refreshHours * 3_600_000).unref();

  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  // 일반 대화 읽기는 특권 인텐트라 포털에서 켜 두지 않았다면 로그인 자체가 실패한다 → 명시적으로 켠 경우에만 요청
  if (config.enableMessageContent) intents.push(GatewayIntentBits.MessageContent);
  const client = new Client({
    intents,
    // 레포 설명 등 외부 텍스트에 @everyone 이 섞여 있어도 아무도 멘션되지 않게
    allowedMentions: { parse: [] },
  });
  client.once(Events.ClientReady, (c) => {
    console.log(`[bot] logged in as ${c.user.tag} 🐱`);
    clientRef = client;
    const tick = () => {
      void digestTick(client);
      void dailyTick(client);
    };
    setInterval(tick, 10 * 60_000).unref();
    tick();
  });
  client.on(Events.MessageCreate, (m) => {
    onMessage(m, client).catch((e) => console.error("[message] failed", e));
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
