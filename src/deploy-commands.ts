import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";
import { config } from "./config.js";

if (!config.discordToken || !config.discordClientId) {
  console.error("DISCORD_TOKEN, DISCORD_CLIENT_ID 가 필요합니다");
  process.exit(1);
}

const rest = new REST().setToken(config.discordToken);
const route = config.discordGuildId
  ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
  : Routes.applicationCommands(config.discordClientId);

await rest.put(route, { body: commands });
console.log(`✅ ${commands.length}개 커맨드 등록 (${config.discordGuildId ? `guild ${config.discordGuildId}` : "global"})`);
