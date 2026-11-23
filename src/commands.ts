import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { CATEGORIES } from "./ranking.js";

export const skillsCommand = new SlashCommandBuilder()
  .setName("skills")
  .setDescription("🐱 스킬냥이 — Claude Code 스킬 추천 & 설치 명령")
  .addSubcommand((s) =>
    s
      .setName("top")
      .setDescription("스타·실제 설치 수·공식/큐레이션·우리 서버 투표로 정렬한 인기 스킬")
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
      .setDescription("레포 상세 + 한국어 요약 + 설치 명령")
      .addStringOption((o) =>
        o.setName("repo").setDescription("owner/repo").setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) => s.setName("server").setDescription("💗 우리 서버에서 👍·설치 조회가 많은 스킬"))
  .addSubcommand((s) => s.setName("rising").setDescription("📈 최근 7일 스타·설치 급상승"))
  .addSubcommandGroup((g) =>
    g
      .setName("digest")
      .setDescription("(관리자) 주간 다이제스트 설정")
      .addSubcommand((s) =>
        s
          .setName("set")
          .setDescription("다이제스트를 보낼 채널 지정")
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("텍스트 채널")
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          ),
      )
      .addSubcommand((s) => s.setName("off").setDescription("다이제스트 끄기"))
      .addSubcommand((s) => s.setName("now").setDescription("지금 바로 미리보기 (나에게만 보임)")),
  )
  .addSubcommandGroup((g) =>
    g
      .setName("auto")
      .setDescription("(관리자) 자동 추천 설정")
      .addSubcommand((s) =>
        s
          .setName("set")
          .setDescription("매일 '오늘의 스킬'과 급상승 알림을 보낼 채널 지정")
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("텍스트 채널")
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          )
          .addIntegerOption((o) =>
            o.setName("hour").setDescription("보낼 시각 (서울, 0~23)").setMinValue(0).setMaxValue(23),
          )
          .addBooleanOption((o) => o.setName("alerts").setDescription("급상승 즉시 알림도 켜기 (기본: 켜짐)")),
      )
      .addSubcommand((s) => s.setName("off").setDescription("오늘의 스킬·급상승 알림 끄기"))
      .addSubcommand((s) =>
        s
          .setName("watch")
          .setDescription("채널 대화를 보고 관련 스킬 제안 켜기/끄기 (채널별)")
          .addChannelOption((o) =>
            o
              .setName("channel")
              .setDescription("텍스트 채널")
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true),
          )
          .addBooleanOption((o) => o.setName("enabled").setDescription("켜기(true) / 끄기(false)").setRequired(true)),
      )
      .addSubcommand((s) => s.setName("now").setDescription("'오늘의 스킬' 미리보기 (나에게만 보임)"))
      .addSubcommand((s) => s.setName("status").setDescription("자동 추천 설정 보기")),
  )
  .addSubcommand((s) => s.setName("refresh").setDescription("(관리자) 인덱스 즉시 갱신"))
  .setDMPermission(true);

export const ADMIN_PERMISSION = PermissionFlagsBits.ManageGuild;

export const commands = [skillsCommand.toJSON()];
