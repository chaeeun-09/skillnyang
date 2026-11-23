export type ItemKind = "plugin" | "skill";

/** 레포 안에 들어있는 설치 단위 하나 (마켓플레이스 플러그인 또는 단일 스킬 폴더) */
export interface Item {
  kind: ItemKind;
  name: string;
  description: string;
  /** kind=skill 일 때 레포 루트 기준 스킬 폴더 경로 ("" = 루트) */
  path?: string;
  /** skills.sh 누적 설치 수 (매칭되면) */
  installs?: number;
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
  /** 아이템 skills.sh 설치 수 합계 */
  installs: number;
  official: boolean;
  /** 이 레포를 링크한 큐레이션 리스트 목록 */
  curatedBy: string[];
  categories: string[];
  /** 서버 투표 등을 제외한 전역 점수 */
  score: number;
  /** 처음 인덱스에 등장한 시각 (다이제스트 "신규" 판단용) */
  firstSeen: string;
}

export interface Index {
  updatedAt: string;
  entries: Entry[];
  /** 날짜(YYYY-MM-DD) → repo → [stars, installs]. 급상승 계산용, 최근 N일만 보관 */
  history: Record<string, Record<string, [number, number]>>;
}
