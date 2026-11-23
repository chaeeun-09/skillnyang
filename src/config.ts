function num(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function list(name: string, def: string[]): string[] {
  const v = process.env[name];
  if (!v) return def;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? "",
  discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
  /** 지정하면 해당 길드에만 커맨드 등록(즉시 반영). 비우면 글로벌 등록. */
  discordGuildId: process.env.DISCORD_GUILD_ID ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  dataDir: process.env.DATA_DIR ?? "./data",
  refreshHours: num("REFRESH_HOURS", 6),
  /** 크롤링할 최대 레포 수 (스타 순 상위) */
  maxRepos: num("MAX_REPOS", 300),
  /** 레포당 frontmatter 를 읽을 SKILL.md 최대 개수 */
  maxSkillsPerRepo: num("MAX_SKILLS_PER_REPO", 40),
  minStars: num("MIN_STARS", 20),
  /** 검색에 안 잡힌 큐레이션 링크 레포 중 메타데이터를 조회할 최대 개수 */
  maxCuratedFetch: num("MAX_CURATED_FETCH", 200),
  /** 공식 출처로 취급할 GitHub owner */
  officialOwners: list("OFFICIAL_OWNERS", ["anthropics"]).map((s) => s.toLowerCase()),
  /** 큐레이션 리스트(awesome-*) — README 에 링크된 레포에 가산점 */
  curatedLists: list("CURATED_LISTS", [
    "travisvn/awesome-claude-skills",
    "ComposioHQ/awesome-claude-skills",
    "VoltAgent/awesome-agent-skills",
    "hesreallyhim/awesome-claude-code",
    "jqueryscript/awesome-claude-code",
  ]),
  /** 검색으로 못 잡을 수 있는 레포를 항상 포함 */
  seedRepos: list("SEED_REPOS", [
    "anthropics/skills",
    "anthropics/claude-plugins-official",
    "anthropics/claude-plugins-community",
    "anthropics/claude-code",
    "obra/superpowers",
    "trailofbits/skills",
  ]),
  searchQueries: list("SEARCH_QUERIES", [
    "topic:claude-skills",
    "topic:claude-code-skills",
    "topic:agent-skills",
    "topic:claude-code-plugin",
    "topic:claude-code-plugins",
    "topic:claude-plugins",
    "topic:claude-skill",
  ]),
};
