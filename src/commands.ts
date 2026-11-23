import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { CATEGORIES } from "./ranking.js";

export const skillsCommand = new SlashCommandBuilder()
  .setName("skills")
  .setDescription("Claude Code 스킬/플러그인 추천 & 설치 명령")
  .addSubcommand((s) =>
    s
      .setName("top")
      .setDescription("스타 + 공식/큐레이션 점수로 정렬한 인기 스킬")
      .addStringOption((o) =>
        o
          .setName("category")
          .setDescription("카테고리 필터")
          .addChoices(...CATEGORIES.map((c) => ({ name: c, value: c }))),
      )
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("설치 방식 필터")
          .addChoices({ name: "플러그인 마켓플레이스", value: "plugin" }, { name: "단일 스킬", value: "skill" }),
      )
      .addIntegerOption((o) => o.setName("limit").setDescription("개수 (기본 10)").setMinValue(1).setMaxValue(25)),
  )
  .addSubcommand((s) =>
    s
      .setName("search")
      .setDescription("키워드로 스킬 검색")
      .addStringOption((o) => o.setName("query").setDescription("예: terraform, pdf, tdd").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("info")
      .setDescription("레포 상세 + 설치 명령")
      .addStringOption((o) =>
        o.setName("repo").setDescription("owner/repo").setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) => s.setName("refresh").setDescription("(관리자) 인덱스 즉시 갱신"))
  .setDefaultMemberPermissions(null)
  .setDMPermission(true);

export const REFRESH_PERMISSION = PermissionFlagsBits.ManageGuild;

export const commands = [skillsCommand.toJSON()];
