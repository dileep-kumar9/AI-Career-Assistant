/**
 * Page planning shared by the PDF export and the on-screen preview.
 *
 * Input: the height of the header and of every block (section) measured on
 * one continuous page. Output: which blocks start a new page (so a section is
 * never split between pages when it fits on one page), how much empty space
 * that leaves, and extra space to spread between the sections of a page that
 * ended early so the page looks evenly filled.
 */

export interface MeasuredBlock {
  height: number;
  /** Space above the block's heading (not needed at the top of a page). */
  topGap: number;
}

export interface PagePlan {
  pages: number;
  /** Blocks that start on a new page. */
  breaks: Set<number>;
  /** Extra space above a block to even out its page. */
  gaps: Map<number, number>;
  /** Space left at the bottom of pages that ended early because a section moved. */
  leftover: number;
  /** Height used on each page before the gaps are added. */
  pageUsed: number[];
}

export function planPages(headerHeight: number, blocks: MeasuredBlock[], pageHeight: number, maxGap = 16): PagePlan {
  const H = pageHeight;
  const breaks = new Set<number>();
  const pageBlocks: number[][] = [[]];
  const pageUsed: number[] = [];
  let y = headerHeight;
  let moved = false;
  blocks.forEach((b, i) => {
    if (y + b.height <= H + 0.5) {
      pageBlocks[pageBlocks.length - 1].push(i);
      y += b.height;
      return;
    }
    const alone = b.height - b.topGap;
    // (never leave a page with no section on it)
    if (alone <= H && pageBlocks[pageBlocks.length - 1].length > 0) {
      // The whole section moves to the next page.
      breaks.add(i);
      pageUsed.push(y);
      pageBlocks.push([i]);
      y = alone;
      moved = true;
    } else {
      // Taller than a page: it has to flow across pages.
      pageBlocks[pageBlocks.length - 1].push(i);
      let rest = y + b.height;
      while (rest > H) {
        pageUsed.push(H);
        pageBlocks.push([]);
        rest -= H;
      }
      y = rest;
    }
  });
  pageUsed.push(y);

  const gaps = new Map<number, number>();
  let leftover = 0;
  if (moved) {
    pageBlocks.forEach((ids, p) => {
      if (p === pageBlocks.length - 1) return; // the last page may end early
      if (!breaks.has(pageBlocks[p + 1]?.[0] ?? -1)) return;
      const free = H - pageUsed[p];
      leftover += free;
      const targets = p === 0 ? ids : ids.slice(1);
      if (!targets.length || free <= 0) return;
      const each = Math.min(free / targets.length, maxGap);
      for (const i of targets) gaps.set(i, each);
    });
  }
  return { pages: pageBlocks.length, breaks, gaps, leftover, pageUsed };
}
