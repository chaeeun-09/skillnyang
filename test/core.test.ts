import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepoLinks, installsFor, matchInstalls, parseFrontmatter } from "../src/crawler.js";
import { _resetSkillsSh } from "../src/skillssh.js";
import { installFor, renderInstall } from "../src/install.js";
import { communityBonus, score, search } from "../src/ranking.js";
import { _reset, rankForGuild, recordClick, signals, toggleVote } from "../src/community.js";
import { isDigestTime, newcomers, rising } from "../src/digest.js";
import { sanitizeSummary } from "../src/summary.js";
import { detectIntent, isDailyTime, pickDaily, recommendFromText, surges, topicTerms } from "../src/auto.js";
import type { GuildData } from "../src/community.js";
import type { Entry } from "../src/types.js";
import { chunkMessage } from "../src/views.js";

const base: Entry = {
  repo: "acme/skills",
  url: "https://github.com/acme/skills",
  description: "Terraform and Kubernetes helpers",
  stars: 1000,
  pushedAt: "2026-11-01T00:00:00Z",
  topics: ["claude-skills"],
  license: "MIT",
  marketplaceName: null,
  items: [{ kind: "skill", name: "tf-plan", description: "Review terraform plans", path: "skills/tf-plan" }],
  official: false,
  curatedBy: [],
  categories: [],
  score: 0,
  installs: 0,
  firstSeen: "1970-01-01T00:00:00.000Z",
};

const S = (o: Partial<Parameters<typeof score>[0]>) =>
  score({ stars: 0, installs: 0, official: false, curatedCount: 0, hasMarketplace: false, ...o });

test("score: 스타·설치 로그 스케일 + 공식/큐레이션 가산", () => {
  const plain = S({ stars: 1000 });
  assert.equal(plain, 45);
  assert.equal(S({ stars: 1000, installs: 1000 }) - plain, 45, "설치 1k = +45");
  assert.equal(S({ stars: 1000, official: true }) - plain, 20);
  assert.equal(S({ stars: 1000, curatedCount: 10 }) - plain, 12, "큐레이션은 최대 3개까지만 반영");
  // 스타는 적어도 실제 설치가 많으면 역전
  assert.ok(S({ stars: 500, installs: 50_000 }) > S({ stars: 20_000 }));
});

test("communityBonus: 투표는 로그로 체감", () => {
  assert.equal(communityBonus(0, 0), 0);
  assert.equal(communityBonus(1, 0), 8);
  assert.equal(communityBonus(3, 0), 16);
  assert.equal(communityBonus(0, 1), 3);
});

test("install: 마켓플레이스 플러그인", () => {
  const e = { ...base, marketplaceName: "acme-mkt", items: [{ kind: "plugin" as const, name: "tf", description: "" }] };
  const ins = installFor(e, e.items[0])!;
  assert.deepEqual(ins.inSession, ["/plugin marketplace add acme/skills", "/plugin install tf@acme-mkt"]);
  assert.match(ins.shell[0], /^claude plugin marketplace add acme\/skills && claude plugin install tf@acme-mkt$/);
});

test("install: 공식 마켓플레이스는 add 생략", () => {
  const e = {
    ...base,
    repo: "anthropics/claude-plugins-official",
    marketplaceName: "claude-plugins-official",
    items: [{ kind: "plugin" as const, name: "github", description: "" }],
  };
  assert.deepEqual(installFor(e, e.items[0])!.inSession, ["/plugin install github@claude-plugins-official"]);
});

test("install: 단일 스킬은 npx + git 수동 설치", () => {
  const ins = installFor(base, base.items[0])!;
  assert.equal(ins.shell[0], "npx skills add acme/skills --skill tf-plan --agent claude-code -g");
  assert.match(ins.shell[1], /cp -R "\$tmp\/skills\/tf-plan" ~\/\.claude\/skills\/tf-plan/);
});

test("install: 위험한 이름/경로는 명령 생성 거부", () => {
  const bad = (name: string, path = "x") => installFor(base, { kind: "skill", name, description: "", path });
  assert.equal(bad("a; rm -rf ~"), null);
  assert.equal(bad("$(whoami)"), null);
  assert.equal(bad("ok", "../../etc"), null);
  assert.equal(bad("ok", "a b"), null);
  assert.equal(installFor({ ...base, repo: "evil/repo`id`" }, base.items[0]), null);
  assert.match(renderInstall(base, [{ kind: "skill", name: "x|y", description: "" }]), /생략: x\|y/);
});

test("frontmatter 파싱 (블록 스칼라 포함)", () => {
  const md = `---\nname: pdf\ndescription: >\n  Read and\n  write PDFs\n---\n# body`;
  assert.deepEqual(parseFrontmatter(md), { name: "pdf", description: "Read and write PDFs" });
  assert.deepEqual(parseFrontmatter(`---\nname: "q"\n---`), { name: "q" });
  assert.deepEqual(parseFrontmatter("# no fm"), {});
});

test("awesome README 링크 추출", () => {
  const md = "- [a](https://github.com/Foo/Bar) and https://github.com/x/y.git, https://github.com/foo/bar/tree/main";
  assert.deepEqual(extractRepoLinks(md).sort(), ["foo/bar", "x/y"]);
});

test("search: 아이템명 매칭", () => {
  const other = { ...base, repo: "z/other", description: "pdf", items: [], score: 99 };
  assert.equal(search([other, base], "tf-plan")[0].repo, "acme/skills");
});

test("chunkMessage: 코드블록 유지", () => {
  const text = "```bash\n" + Array.from({ length: 200 }, (_, i) => `echo ${i} ${"x".repeat(20)}`).join("\n") + "\n```";
  const chunks = chunkMessage(text, 500);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= 520);
    assert.equal((c.match(/```/g) ?? []).length % 2, 0, "각 청크의 펜스 짝이 맞아야 함");
  }
});

test("community: 투표 토글 + 서버별 랭킹 반영", () => {
  _reset();
  const a = { ...base, repo: "a/a", score: 50 };
  const b = { ...base, repo: "b/b", score: 45 };
  assert.deepEqual(rankForGuild([a, b], "g1").map((e) => e.repo), ["a/a", "b/b"]);
  assert.deepEqual(toggleVote("g1", "B/B", "u1"), { voted: true, count: 1 });
  toggleVote("g1", "b/b", "u2");
  assert.deepEqual(rankForGuild([a, b], "g1").map((e) => e.repo), ["b/b", "a/a"], "2표(+12.7)면 역전");
  assert.deepEqual(rankForGuild([a, b], "g2").map((e) => e.repo), ["a/a", "b/b"], "다른 서버엔 영향 없음");
  assert.deepEqual(toggleVote("g1", "b/b", "u1"), { voted: false, count: 1 });
  recordClick("g1", "a/a");
  assert.deepEqual(signals("g1", "a/a"), { votes: 0, clicks: 1 });
  assert.deepEqual(signals(null, "a/a"), { votes: 0, clicks: 0 });
});

test("digest: 급상승은 7일 전 스냅샷과 비교", () => {
  const now = Date.parse("2026-11-23T03:00:00Z");
  const idx = {
    updatedAt: "",
    entries: [
      { ...base, repo: "x/x", stars: 1500, installs: 100 },
      { ...base, repo: "y/y", stars: 5000, installs: 0 },
      { ...base, repo: "z/z", stars: 10, installs: 0, firstSeen: "2026-11-22T00:00:00Z" },
    ],
    history: {
      "2026-11-10": { "x/x": [1000, 0] as [number, number], "y/y": [4990, 0] as [number, number] },
      "2026-11-16": { "x/x": [1400, 50] as [number, number], "y/y": [4900, 0] as [number, number] },
    },
  };
  const r = rising(idx, 7, 5, now);
  assert.equal(r.length, 2, "z/z 는 과거 스냅샷이 없어 제외");
  assert.equal(r[0].entry.repo, "x/x", "스타 증가가 같으면 설치 증가가 있는 쪽이 위");
  assert.equal(r.find((x) => x.entry.repo === "x/x")!.installDelta, 50);
  assert.equal(r.find((x) => x.entry.repo === "y/y")!.starDelta, 100);
  assert.deepEqual(newcomers(idx, Date.parse("2026-11-16T00:00:00Z")).map((e) => e.repo), ["z/z"]);
});

test("digest: 발송 시각 판정 (서울 월요일 10시 이후, 주 1회)", () => {
  const mon11kst = new Date("2026-11-23T02:00:00Z"); // 월 11:00 KST
  const mon09kst = new Date("2026-11-23T00:00:00Z"); // 월 09:00 KST
  const tue = new Date("2026-11-24T02:00:00Z");
  assert.equal(isDigestTime(undefined, mon11kst), true);
  assert.equal(isDigestTime(undefined, mon09kst), false);
  assert.equal(isDigestTime(undefined, tue), false);
  assert.equal(isDigestTime("2026-11-23T01:05:00Z", mon11kst), false, "이미 보냄");
  assert.equal(isDigestTime("2026-11-16T01:05:00Z", mon11kst), true);
});

test("summary: 멘션/링크 제거", () => {
  assert.equal(
    sanitizeSummary("@everyone 안녕 <@123> [여기](https://evil.com) https://x.y 끝"),
    "＠everyone 안녕 여기 끝",
  );
});

test("skills.sh: 같은 레포 결과만 모아 아이템 설치 수 매칭, 장애 시 빈 결과", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        skills: [
          { id: "acme/skills/tf-plan", name: "tf-plan", source: "acme/skills", installs: 1234 },
          { id: "acme/other/tf-plan", name: "tf-plan", source: "acme/other", installs: 99999 },
          { id: "acme/skills/helper", name: "helper", source: "acme/skills", installs: 6 },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    _resetSkillsSh();
    const hits = await installsFor("acme/skills", base.items, new Map());
    assert.equal(hits.size, 2, "다른 레포(acme/other) 결과는 제외, id 로 중복 제거");
    assert.equal(matchInstalls(base.items[0], hits), 1234);
    assert.ok(calls.every((u) => u.includes("/api/search?") && u.includes("owner=acme")));

    globalThis.fetch = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    _resetSkillsSh();
    const none = await installsFor("acme/skills", base.items, new Map());
    assert.equal(none.size, 0);
  } finally {
    globalThis.fetch = realFetch;
    _resetSkillsSh();
  }
});

const NOW = Date.parse("2026-11-23T03:00:00Z");
const G = (o: Partial<GuildData> = {}): GuildData => ({ votes: {}, clicks: {}, ...o });
const E = (repo: string, score: number, categories: string[] = [], extra: Partial<Entry> = {}): Entry => ({
  ...base,
  repo,
  score,
  categories,
  ...extra,
});

test("auto: 오늘의 스킬은 카테고리를 돌려가며, 이미 소개한 건 제외", () => {
  const ranked = [E("a/a", 90, ["dev"]), E("b/b", 80, ["devops"]), E("c/c", 70, ["dev"]), E("d/d", 60)];
  // cursor=1 → devops 우선 (b), 나머지는 전체 상위 (a)
  const first = pickDaily(ranked, G({ categoryCursor: 1 }), 2, NOW);
  assert.deepEqual(first.picks.map((e) => e.repo), ["b/b", "a/a"]);
  assert.equal(first.nextCursor, 2);
  assert.equal(first.reset, false);
  // a, b 는 이미 소개 → c 와 d
  const second = pickDaily(ranked, G({ categoryCursor: 2, shown: ["a/a", "b/b"] }), 2, NOW);
  assert.deepEqual(second.picks.map((e) => e.repo), ["c/c", "d/d"]);
  // 전부 소개했으면 기록 초기화하고 다시 처음부터
  const all = pickDaily(ranked, G({ shown: ["a/a", "b/b", "c/c", "d/d"] }), 2, NOW);
  assert.equal(all.reset, true);
  assert.equal(all.picks.length, 2);
  // 1년 넘게 푸시 없는 레포는 제외
  const stale = [E("old/old", 99, ["dev"], { pushedAt: "2024-01-01T00:00:00Z" }), E("new/new", 10, ["dev"])];
  assert.deepEqual(pickDaily(stale, G(), 1, NOW).picks.map((e) => e.repo), ["new/new"]);
});

test("auto: 오늘의 스킬 발송 시각 (서울 기준, 하루 1번)", () => {
  const g = G({ autoChannelId: "c1", dailyHour: 10 });
  assert.equal(isDailyTime(g, new Date("2026-11-23T02:00:00Z")), true, "KST 11시");
  assert.equal(isDailyTime(g, new Date("2026-11-23T00:00:00Z")), false, "KST 9시");
  assert.equal(isDailyTime({ ...g, lastDailyDate: "2026-11-23" }, new Date("2026-11-23T02:00:00Z")), false, "오늘 이미 보냄");
  assert.equal(isDailyTime({ ...g, lastDailyDate: "2026-11-23" }, new Date("2026-11-24T02:00:00Z")), true, "다음 날");
  assert.equal(isDailyTime(G({ dailyHour: 10 }), new Date("2026-11-23T02:00:00Z")), false, "채널 미설정");
  // UTC 15시 이후는 서울 기준으로 다음 날
  assert.equal(isDailyTime({ ...g, lastDailyDate: "2026-11-23" }, new Date("2026-11-23T16:00:00Z")), false, "KST 11-24 01시 < 10시");
});

test("auto: 급상승은 어제 스냅샷 대비 기준을 넘는 것만", () => {
  const idx = {
    updatedAt: "",
    entries: [
      E("x/x", 1, [], { stars: 1300, installs: 0 }), // +300
      E("y/y", 1, [], { stars: 1050, installs: 0 }), // +50
      E("z/z", 1, [], { stars: 1150, installs: 0 }), // +150, 15%
      E("w/w", 1, [], { stars: 1000, installs: 1500 }), // 설치 +1500
      E("n/n", 1, [], { stars: 9999, installs: 0 }), // 어제 기록 없음
    ],
    history: {
      "2026-11-22": {
        "x/x": [1000, 0] as [number, number],
        "y/y": [1000, 0] as [number, number],
        "z/z": [1000, 0] as [number, number],
        "w/w": [1000, 0] as [number, number],
      },
    },
  };
  assert.deepEqual(surges(idx, NOW).map((s) => s.entry.repo), ["x/x", "w/w", "z/z"]);
  assert.deepEqual(surges({ ...idx, history: {} }, NOW), [], "기록 없으면 알림 없음");
  assert.deepEqual(surges({ ...idx, history: { "2026-11-23": idx.history["2026-11-22"] } }, NOW), [], "오늘 기록은 기준이 아님");
  assert.deepEqual(surges({ ...idx, history: { "2026-11-10": idx.history["2026-11-22"] } }, NOW), [], "너무 오래된 기록");
});

test("auto: 대화 의도 감지 — 맥락 + 질문 + 주제어가 모두 있을 때만", () => {
  assert.equal(detectIntent("클로드 코드에서 테라폼 스킬 추천해줘"), "terraform");
  assert.equal(detectIntent("claude code pdf 다루는 skill 있을까?"), "pdf");
  assert.equal(detectIntent("도커랑 쿠버네티스 쓰는 스킬 뭐 있어?"), "docker kubernetes");
  assert.equal(detectIntent("오늘 점심 뭐 먹지?"), null, "맥락 없음");
  assert.equal(detectIntent("테라폼 apply 했더니 에러났어"), null, "Claude/스킬 맥락 없음");
  assert.equal(detectIntent("클로드 코드 스킬 추천해줘"), null, "주제어 없음 → 조용히");
  assert.equal(detectIntent("클로드 코드로 테라폼 짰어"), null, "질문 아님");
  assert.equal(detectIntent("?"), null);
  assert.deepEqual(topicTerms("깃허브 액션이랑 테스트"), ["github actions", "test tdd"]);
});

test("auto: 멘션 질문은 주제어 → 영어 단어 → 전체 상위로 폴백", () => {
  const tf = E("t/tf", 10, [], { items: [{ kind: "skill", name: "terraform-plan", description: "" }] });
  const other = E("o/o", 99, [], { items: [{ kind: "skill", name: "helper", description: "" }], description: "misc" });
  const r1 = recommendFromText([other, tf], "테라폼 스킬 알려줘");
  assert.equal(r1.matched, true);
  assert.equal(r1.list[0].repo, "t/tf");
  const r2 = recommendFromText([other, tf], "terraform 쓰는 거");
  assert.equal(r2.list[0].repo, "t/tf");
  const r3 = recommendFromText([other, tf], "ㅋㅋㅋ 뭐 있어");
  assert.equal(r3.matched, false);
  assert.equal(r3.list[0].repo, "o/o");
});
