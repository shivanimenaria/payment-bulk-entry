"use client";

import { useMemo, useState } from "react";
import type { AllocationRow } from "@/types/payments";
import {
  EMPTY_FILTERS,
  applyFilters,
  filterOptions,
  filtersActive,
  filtersKey,
  hiddenErrorCount,
  type TableFilters,
} from "@/lib/payments/filters";
import { clampPage, pageResetKey, pageSlice, pagesWithErrors, syncPage, type PageState } from "@/lib/payments/pagination";
import { todayKey } from "@/lib/payments/table-display";

// Shared by /payments and /payments/new: the table's client-side filters
// (lib/payments/filters.ts) and paging (lib/payments/pagination.ts) over the
// rows of the selected currency. DISPLAY ONLY — callers keep using `rows`
// (all rows of the currency) for totals, cards, validation and submit.
// Filters reset when the currency changes; the page resets when the
// currency, the loaded data or the filters change.
export function useFilteredPaging(
  rows: AllocationRow[],
  currency: string | null,
  loadSeq: number,
  rowErrorIndices: number[] = [],
) {
  const [state, setState] = useState<{ currency: string | null; filters: TableFilters }>({ currency, filters: EMPTY_FILTERS });
  const filters = state.currency === currency ? state.filters : EMPTY_FILTERS;
  const setFilters = (f: TableFilters) => setState({ currency, filters: f });

  const options = useMemo(() => filterOptions(rows), [rows]);
  const shown = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const [pageState, setPageState] = useState<PageState>({ page: 1, key: "" });
  const keyFor = (c: string | null, seq: number, f: TableFilters) => `${pageResetKey(c, seq)}|${filtersKey(f)}`;
  const resetKey = keyFor(currency, loadSeq, filters);
  const page = syncPage(pageState, resetKey, shown.length);
  const slice = useMemo(() => pageSlice(shown, page), [shown, page]);
  const goToPage = (p: number) => setPageState({ page: clampPage(p, shown.length), key: resetKey });

  // "Errors on page N" counts positions among the SHOWN rows; errors on rows
  // the filters hide are reported separately.
  const errorSet = new Set(rowErrorIndices);
  const errorPositions = shown.flatMap((s, pos) => (errorSet.has(s.index) ? [pos] : []));
  const errorPages = pagesWithErrors(errorPositions, slice.page);
  const hiddenErrors = hiddenErrorCount(shown, rowErrorIndices);

  return {
    filters,
    setFilters,
    clearFilters: () => setFilters(EMPTY_FILTERS),
    active: filtersActive(filters),
    options,
    shown,
    slice,
    goToPage,
    errorPages,
    hiddenErrors,
    /** Restore a page (re-handover) for a currency / load after the restore,
     *  with no filters. */
    restorePage: (p: number, c: string | null, seq: number) => setPageState({ page: p, key: keyFor(c, seq, EMPTY_FILTERS) }),
    todayKey: todayKey(),
  };
}
