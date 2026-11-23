import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import type { Index } from "./types.js";

const file = () => join(config.dataDir, "index.json");

let current: Index = { updatedAt: new Date(0).toISOString(), entries: [], history: {} };

export function getIndex(): Index {
  return current;
}

export async function loadIndex(): Promise<Index> {
  try {
    const raw = JSON.parse(await readFile(file(), "utf8")) as Partial<Index>;
    // 이전 버전 인덱스 호환
    current = {
      updatedAt: raw.updatedAt ?? new Date(0).toISOString(),
      history: raw.history ?? {},
      entries: (raw.entries ?? []).map((e) => ({
        ...e,
        installs: e.installs ?? 0,
        firstSeen: e.firstSeen ?? new Date(0).toISOString(),
      })),
    };
  } catch {
    // 첫 실행
  }
  return current;
}

export async function saveIndex(idx: Index): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = file() + ".tmp";
  await writeFile(tmp, JSON.stringify(idx, null, 2));
  await rename(tmp, file());
  current = idx;
}

export function isStale(idx: Index, hours: number): boolean {
  return Date.now() - new Date(idx.updatedAt).getTime() > hours * 3_600_000 || idx.entries.length === 0;
}
