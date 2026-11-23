// 봇 없이 크롤링만 1회 실행하고 상위 20개를 출력 (디버깅/점검용)
import { crawl } from "./crawler.js";
import { loadIndex, saveIndex } from "./store.js";

const prev = await loadIndex();
const idx = await crawl(prev);
await saveIndex(idx);
for (const [n, e] of idx.entries.slice(0, 20).entries()) {
  console.log(
    `${String(n + 1).padStart(2)}. ${e.score.toFixed(1).padStart(6)}  ⭐${String(e.stars).padStart(7)}  ${e.repo}` +
      `  📥${e.installs}${e.official ? " [공식]" : ""}${e.curatedBy.length ? ` [큐레이션${e.curatedBy.length}]` : ""}` +
      `  (${e.marketplaceName ? `plugin×${e.items.length}` : `skill×${e.items.length}`})`,
  );
}
