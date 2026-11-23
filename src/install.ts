import type { Entry, Item } from "./types.js";

/**
 * 설치 명령은 사용자가 그대로 터미널에 붙여넣으므로, 외부(레포)에서 온 값은
 * 반드시 안전한 문자만 허용한다. 하나라도 어긋나면 명령을 만들지 않는다.
 */
const SAFE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const SAFE_PATH = /^[A-Za-z0-9_./-]{0,300}$/;

export function isSafeRepo(s: string) {
  return SAFE_REPO.test(s) && !s.includes("..");
}
export function isSafeName(s: string) {
  return SAFE_NAME.test(s) && !s.includes("..");
}
export function isSafePath(s: string) {
  return SAFE_PATH.test(s) && !s.split("/").includes("..") && !s.startsWith("/");
}

/** 공식 마켓플레이스는 Claude Code 에 기본 등록돼 있어 add 가 필요 없음 */
const BUILTIN_MARKETPLACES: Record<string, string> = {
  "anthropics/claude-plugins-official": "claude-plugins-official",
};

export interface InstallInstructions {
  /** Claude Code 세션 안에 붙여넣는 슬래시 명령 */
  inSession: string[];
  /** 일반 터미널(셸)에서 실행하는 명령 */
  shell: string[];
  note?: string;
}

export function installFor(entry: Entry, item: Item): InstallInstructions | null {
  if (!isSafeRepo(entry.repo) || !isSafeName(item.name)) return null;

  if (item.kind === "plugin") {
    const mkt = entry.marketplaceName;
    if (!mkt || !isSafeName(mkt)) return null;
    const builtin = BUILTIN_MARKETPLACES[entry.repo.toLowerCase()];
    if (builtin) {
      return {
        inSession: [`/plugin install ${item.name}@${builtin}`],
        shell: [`claude plugin install ${item.name}@${builtin}`],
      };
    }
    return {
      inSession: [`/plugin marketplace add ${entry.repo}`, `/plugin install ${item.name}@${mkt}`],
      shell: [`claude plugin marketplace add ${entry.repo} && claude plugin install ${item.name}@${mkt}`],
      note: `Claude Code v2.1.275+ 는 한 줄로도 가능: /plugin install ${item.name} --marketplace ${entry.repo}`,
    };
  }

  // 단일 스킬 폴더 → ~/.claude/skills/<name>
  const path = item.path ?? "";
  if (!isSafePath(path)) return null;
  const dirName = item.name.replace(/:/g, "-");
  const src = path ? `"$tmp/${path}"` : `"$tmp"`;
  const manual =
    `tmp=$(mktemp -d) && git clone --depth 1 https://github.com/${entry.repo}.git "$tmp" && ` +
    `rm -rf "$tmp/.git" && mkdir -p ~/.claude/skills && cp -R ${src} ~/.claude/skills/${dirName} && rm -rf "$tmp"`;
  return {
    inSession: [],
    shell: [`npx skills add ${entry.repo} --skill ${item.name} --agent claude-code -g`, manual],
    note: "위 두 줄 중 하나만 실행하면 됩니다 (npx skills CLI 또는 git 수동 설치). 설치 후 Claude Code 재시작.",
  };
}

export function renderInstall(entry: Entry, items: Item[]): string {
  const inSession: string[] = [];
  const shell: string[] = [];
  const notes = new Set<string>();
  const skipped: string[] = [];
  for (const item of items) {
    const ins = installFor(entry, item);
    if (!ins) {
      skipped.push(item.name);
      continue;
    }
    for (const l of ins.inSession) if (!inSession.includes(l)) inSession.push(l);
    if (item.kind === "skill") {
      shell.push(ins.shell[0]);
    } else {
      for (const l of ins.shell) if (!shell.includes(l)) shell.push(l);
    }
    if (ins.note && item.kind === "plugin") notes.add(ins.note);
  }

  const out: string[] = [];
  if (inSession.length) out.push("**Claude Code 안에서 붙여넣기**", "```", ...inSession, "```");
  if (shell.length) out.push("**터미널에서 실행**", "```bash", ...shell, "```");
  if (items.length === 1 && items[0].kind === "skill") {
    const ins = installFor(entry, items[0]);
    if (ins) out.push("npx 를 안 쓰려면 (git 수동 설치):", "```bash", ins.shell[1], "```");
  }
  for (const n of notes) out.push(`-# ${n}`);
  if (skipped.length) out.push(`-# ⚠️ 이름에 허용되지 않는 문자가 있어 생략: ${skipped.join(", ")}`);
  out.push("-# ⚠️ 스킬/플러그인은 내 PC에서 코드를 실행할 수 있어요. 설치 전 레포의 SKILL.md·스크립트를 한 번 확인하세요.");
  return out.join("\n");
}
