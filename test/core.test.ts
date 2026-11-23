import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRepoLinks, parseFrontmatter } from "../src/crawler.js";
import { installFor, renderInstall } from "../src/install.js";
import { score, search } from "../src/ranking.js";
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
};

test("score: stars 로그 스케일 + 공식/큐레이션 가산", () => {
  const plain = score({ stars: 1000, official: false, curatedCount: 0, hasMarketplace: false });
  assert.equal(plain, 60);
  const official = score({ stars: 1000, official: true, curatedCount: 0, hasMarketplace: false });
  assert.equal(official - plain, 25);
  const curated = score({ stars: 1000, official: false, curatedCount: 10, hasMarketplace: false });
  assert.equal(curated - plain, 15, "큐레이션은 최대 3개까지만 반영");
  // 공식 1k★ 가 비공식 10k★ 보다 위
  assert.ok(official > score({ stars: 10_000, official: false, curatedCount: 0, hasMarketplace: false }));
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
  assert.equal(ins.shell[0], "npx skills add acme/skills --skill tf-plan");
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
