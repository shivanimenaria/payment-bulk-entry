// Client-side paging of the allocation table (CLAUDE.md "UI Layout" →
// Table box). Display-only: every payable row of the selected currency is
// still loaded, and totals / validation / submit always use ALL of them —
// these helpers only decide which slice is rendered. Row indices stay
// global (index into the full currency-filtered list), so S.No, row errors
// and row handlers are unaffected by the page.

export const PAGE_SIZE = 20;

/** Number of pages (at least 1, so an empty table is "page 1 of 1"). */
export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/** Page number clamped to 1…pageCount (non-integers / NaN → 1). */
export function clampPage(page: number, total: number, size = PAGE_SIZE): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), pageCount(total, size));
}

export interface PageSlice<T> {
  /** Rows on this page. */
  rows: T[];
  /** 1-based page actually shown (clamped). */
  page: number;
  pageCount: number;
  /** Global index of the first row on the page (0-based). */
  start: number;
  /** Global index after the last row on the page (exclusive). */
  end: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function pageSlice<T>(rows: T[], page: number, size = PAGE_SIZE): PageSlice<T> {
  const total = rows.length;
  const p = clampPage(page, total, size);
  const start = Math.min((p - 1) * size, total);
  const end = Math.min(start + size, total);
  const count = pageCount(total, size);
  return {
    rows: rows.slice(start, end),
    page: p,
    pageCount: count,
    start,
    end,
    total,
    hasPrevious: p > 1,
    hasNext: p < count,
  };
}

/** "Showing 21–40 of 45" (1-based, inclusive); "Showing 0 of 0" when empty. */
export function rangeLabel(slice: Pick<PageSlice<unknown>, "start" | "end" | "total">): string {
  if (slice.total === 0 || slice.end <= slice.start) return `Showing 0 of ${slice.total}`;
  return `Showing ${slice.start + 1}–${slice.end} of ${slice.total}`;
}

/** 1-based page that holds the row at a global index. */
export function pageOfIndex(index: number, size = PAGE_SIZE): number {
  return Math.floor(Math.max(0, index) / size) + 1;
}

/** Other pages (ascending, unique) that hold a row with an error. */
export function pagesWithErrors(errorRowIndices: Iterable<number>, currentPage: number, size = PAGE_SIZE): number[] {
  const pages = new Set<number>();
  for (const i of Array.from(errorRowIndices)) {
    if (!Number.isInteger(i) || i < 0) continue;
    const p = pageOfIndex(i, size);
    if (p !== currentPage) pages.add(p);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

/** Paging state tied to a reset key (selected currency + data load). */
export interface PageState {
  page: number;
  key: string;
}

/** The page to show for the current reset key: back to 1 when the key
 *  changed (currency switched or data reloaded), else the stored page,
 *  clamped to the current row count. Pure — derive it during render. */
export function syncPage(state: PageState, key: string, total: number, size = PAGE_SIZE): number {
  return state.key === key ? clampPage(state.page, total, size) : 1;
}

/** Reset key: changes whenever the currency filter or the loaded data does. */
export function pageResetKey(currency: string | null, loadSeq: number): string {
  return `${currency ?? ""}#${loadSeq}`;
}
