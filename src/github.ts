import { config } from "./config.js";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

export interface RepoMeta {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  pushed_at: string;
  topics?: string[];
  archived: boolean;
  fork: boolean;
  default_branch: string;
  license: { spdx_id: string | null } | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(url: string, accept = "application/vnd.github+json"): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "skill-scout-bot",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? "1");
    if ((res.status === 403 || res.status === 429) && remaining === 0) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? "0") * 1000;
      const wait = Math.min(Math.max(reset - Date.now(), 1000), 5 * 60_000);
      console.warn(`[github] rate limited, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (res.status >= 500) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    return res;
  }
  throw new Error(`GitHub request failed after retries: ${url}`);
}

async function getJson<T>(url: string): Promise<T | null> {
  const res = await request(url);
  if (res.status === 404 || res.status === 409) return null; // 409 = empty repo
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function searchRepos(query: string, pages = 2): Promise<RepoMeta[]> {
  const out: RepoMeta[] = [];
  for (let page = 1; page <= pages; page++) {
    const q = encodeURIComponent(`${query} stars:>=${config.minStars}`);
    const data = await getJson<{ items: RepoMeta[] }>(
      `${API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`,
    );
    if (!data?.items?.length) break;
    out.push(...data.items);
    if (data.items.length < 100) break;
  }
  return out;
}

export function getRepo(fullName: string): Promise<RepoMeta | null> {
  return getJson<RepoMeta>(`${API}/repos/${fullName}`);
}

export async function getTree(fullName: string, branch: string): Promise<string[]> {
  const data = await getJson<{ tree: { path: string; type: string }[] }>(
    `${API}/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  return data?.tree.filter((t) => t.type === "blob").map((t) => t.path) ?? [];
}

/** raw.githubusercontent 는 API rate limit 에 포함되지 않음 */
export async function getRaw(fullName: string, branch: string, path: string): Promise<string | null> {
  const res = await fetch(`${RAW}/${fullName}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    headers: { "User-Agent": "skill-scout-bot" },
  });
  if (!res.ok) return null;
  const text = await res.text();
  return text.length > 512_000 ? text.slice(0, 512_000) : text;
}

/** 동시 실행 개수를 제한해서 map */
export async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
