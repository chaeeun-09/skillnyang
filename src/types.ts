export type ItemKind = "plugin" | "skill";

/** 레포 안에 들어있는 설치 단위 하나 (마켓플레이스 플러그인 또는 단일 스킬 폴더) */
export interface Item {
  kind: ItemKind;
  name: string;
  description: string;
  /** kind=skill 일 때 레포 루트 기준 스킬 폴더 경로 ("" = 루트) */
  path?: string;
}

export interface Entry {
  /** owner/repo */
  repo: string;
  url: string;
  description: string;
  stars: number;
  pushedAt: string;
  topics: string[];
  license: string | null;
  /** .claude-plugin/marketplace.json 의 name (있으면 플러그인 마켓플레이스) */
  marketplaceName: string | null;
  items: Item[];
  official: boolean;
  /** 이 레포를 링크한 큐레이션 리스트 목록 */
  curatedBy: string[];
  categories: string[];
  score: number;
}

export interface Index {
  updatedAt: string;
  entries: Entry[];
}
