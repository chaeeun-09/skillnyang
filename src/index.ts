import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { REFRESH_PERMISSION } from "./commands.js";
import { config } from "./config.js";
import { crawl } from "./crawler.js";
import { renderInstall } from "./install.js";
import { search } from "./ranking.js";
import { getIndex, isStale, loadIndex, saveIndex } from "./store.js";
import type { Entry } from "./types.js";
import { chunkMessage, infoEmbed, installComponents, listEmbed, pickRepoMenu } from "./views.js";

const Ephemeral = MessageFlags.Ephemeral;

let crawling: Promise<void> | null = null;
function refresh(): Promise<void> {
  crawling ??= crawl()
    .then(saveIndex)
    .catch((e) => console.error("[refresh] failed", e))
    .finally(() => {
      crawling = null;
    });
  return crawling;
}

const findEntry = (repo: string): Entry | undefined =>
  getIndex().entries.find((e) => e.repo.toLowerCase() === repo.toLowerCase());

async function onCommand(i: ChatInputCommandInteraction) {
  if (i.commandName !== "skills") return;
  const sub = i.options.getSubcommand();
  const idx = getIndex();

  if (sub === "refresh") {
    if (i.inGuild() && !i.memberPermissions?.has(REFRESH_PERMISSION)) {
      return i.reply({ content: "서버 관리 권한이 필요해요.", flags: Ephemeral });
    }
    await i.reply({ content: "🔄 인덱스 갱신 중… (수 분 걸릴 수 있어요)", flags: Ephemeral });
    await refresh();
    return i.editReply(`✅ 갱신 완료: ${getIndex().entries.length}개 레포`);
  }

  if (!idx.entries.length) {
    return i.reply({ content: "아직 인덱스를 만드는 중이에요. 잠시 후 다시 시도해 주세요.", flags: Ephemeral });
  }

  if (sub === "top") {
    const cat = i.options.getString("category");
    const type = i.options.getString("type");
    const limit = i.options.getInteger("limit") ?? 10;
    let list = idx.entries;
    if (cat) list = list.filter((e) => e.categories.includes(cat));
    if (type === "plugin") list = list.filter((e) => e.marketplaceName);
    if (type === "skill") list = list.filter((e) => !e.marketplaceName);
    list = list.slice(0, limit);
    const title = `🏆 Claude Code 인기 스킬 TOP ${list.length}${cat ? ` · ${cat}` : ""}`;
    return i.reply({ embeds: [listEmbed(title, list, idx.updatedAt)], components: pickRepoMenu(list) });
  }

  if (sub === "search") {
    const q = i.options.getString("query", true);
    const list = search(idx.entries, q, 10);
    return i.reply({
      embeds: [listEmbed(`🔎 "${q}" 검색 결과`, list, idx.updatedAt)],
      components: pickRepoMenu(list),
    });
  }

  if (sub === "info") {
    const e = findEntry(i.options.getString("repo", true));
    if (!e) return i.reply({ content: "인덱스에 없는 레포예요. `/skills search` 로 찾아보세요.", flags: Ephemeral });
    return i.reply({ embeds: [infoEmbed(e)], components: installComponents(e), flags: Ephemeral });
  }
}

async function onAutocomplete(i: AutocompleteInteraction) {
  const q = String(i.options.getFocused() ?? "");
  const list = q ? search(getIndex().entries, q, 25) : getIndex().entries.slice(0, 25);
  await i.respond(list.map((e) => ({ name: `${e.repo} (⭐${e.stars})`.slice(0, 100), value: e.repo.slice(0, 100) })));
}

async function onSelect(i: StringSelectMenuInteraction) {
  if (i.customId === "pick") {
    const e = findEntry(i.values[0]);
    if (!e) return i.reply({ content: "인덱스가 갱신돼 항목을 찾을 수 없어요.", flags: Ephemeral });
    return i.reply({ embeds: [infoEmbed(e)], components: installComponents(e), flags: Ephemeral });
  }

  if (i.customId.startsWith("inst:")) {
    const e = findEntry(i.customId.slice(5));
    if (!e) return i.reply({ content: "인덱스가 갱신돼 항목을 찾을 수 없어요.", flags: Ephemeral });
    const items = i.values.map((v) => e.items[Number(v)]).filter(Boolean);
    const [first, ...rest] = chunkMessage(`### 📦 ${e.repo} 설치\n${renderInstall(e, items)}`);
    await i.reply({ content: first, flags: Ephemeral });
    for (const c of rest) await i.followUp({ content: c, flags: Ephemeral });
  }
}

async function main() {
  if (!config.discordToken) throw new Error("DISCORD_TOKEN 이 필요합니다");
  if (!config.githubToken) console.warn("[warn] GITHUB_TOKEN 이 없으면 GitHub API 한도(60회/시간)로 크롤링이 거의 불가능합니다");

  await loadIndex();
  if (isStale(getIndex(), config.refreshHours)) void refresh();
  setInterval(() => void refresh(), config.refreshHours * 3_600_000).unref();

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once(Events.ClientReady, (c) => console.log(`[bot] logged in as ${c.user.tag}`));
  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isChatInputCommand()) await onCommand(i);
      else if (i.isAutocomplete()) await onAutocomplete(i);
      else if (i.isStringSelectMenu()) await onSelect(i);
    } catch (e) {
      console.error("[bot] interaction error", e);
      if (i.isRepliable() && !i.replied && !i.deferred) {
        await i.reply({ content: "오류가 났어요 😢", flags: Ephemeral }).catch(() => {});
      }
    }
  });

  const shutdown = () => {
    console.log("[bot] shutting down");
    void client.destroy().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await client.login(config.discordToken);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
