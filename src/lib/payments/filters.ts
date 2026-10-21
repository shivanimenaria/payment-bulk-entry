// Client-side table filters (RFQ list filter row): Request ID search, Request
// Date and Due Date (exact local day, like RFQ), and multi-select "Select
// Option" filters for Request Type / Requested By / Status / Project built
// from the loaded rows. DISPLAY ONLY: they decide which rows are shown and
// counted by the pager — totals, cards, validation and the submit always use
// every row of the selected currency, and amounts on hidden rows are kept.
// Pure.
import type { AllocationRow } from "@/types/payments";
import { formatRequestType } from "@/lib/format";
import { localDateKey, titleCase } from "./table-display";

export interface TableFilters {
  /** Request ID (request_number) contains, case-insensitive. */
  requestId: string;
  /** "YYYY-MM-DD" exact local day, "" = off. */
  requestDate: string;
  dueDate: string;
  requestType: string[];
  requestedBy: string[];
  status: string[];
  project: string[];
}

export const EMPTY_FILTERS: TableFilters = {
  requestId: "",
  requestDate: "",
  dueDate: "",
  requestType: [],
  requestedBy: [],
  status: [],
  project: [],
};

export type FilterOptionKey = "requestType" | "requestedBy" | "status" | "project";

/** The value a row shows for each "Select Option" column (null = none). */
function rowValue(row: AllocationRow, key: FilterOptionKey): string | null {
  switch (key) {
    case "requestType":
      return row.details?.request_type ? formatRequestType(row.details.request_type) : null;
    case "requestedBy":
      return row.details?.requested_by?.name || null;
    case "status":
      return row.config.status ? titleCase(row.config.status) : null;
    case "project":
      return row.projectName || null;
  }
}

/** Options per "Select Option" filter, from the loaded rows (distinct,
 *  sorted; rows without a value add none). */
export function filterOptions(rows: AllocationRow[]): Record<FilterOptionKey, string[]> {
  const keys: FilterOptionKey[] = ["requestType", "requestedBy", "status", "project"];
  const out = {} as Record<FilterOptionKey, string[]>;
  for (const k of keys) {
    const set = new Set<string>();
    for (const r of rows) {
      const v = rowValue(r, k);
      if (v) set.add(v);
    }
    out[k] = Array.from(set).sort((a, b) => a.localeCompare(b));
  }
  return out;
}

export function filtersActive(f: TableFilters): boolean {
  return (
    f.requestId.trim() !== "" ||
    f.requestDate !== "" ||
    f.dueDate !== "" ||
    f.requestType.length > 0 ||
    f.requestedBy.length > 0 ||
    f.status.length > 0 ||
    f.project.length > 0
  );
}

/** Changes whenever the filters do — part of the paging reset key. */
export function filtersKey(f: TableFilters): string {
  return JSON.stringify([f.requestId.trim().toLowerCase(), f.requestDate, f.dueDate, f.requestType, f.requestedBy, f.status, f.project]);
}

export function rowMatches(row: AllocationRow, f: TableFilters): boolean {
  const q = f.requestId.trim().toLowerCase();
  if (q && !(row.details?.request_number || "").toLowerCase().includes(q)) return false;
  if (f.requestDate && localDateKey(row.details?.requested_at) !== f.requestDate) return false;
  if (f.dueDate && localDateKey(row.details?.due_date) !== f.dueDate) return false;
  for (const k of ["requestType", "requestedBy", "status", "project"] as const) {
    if (f[k].length === 0) continue;
    const v = rowValue(row, k);
    if (!v || !f[k].includes(v)) return false;
  }
  return true;
}

/** A row to display: `index` = its position in the full (currency) list —
 *  what row handlers, row errors and validation use; `position` = 1-based
 *  place among the shown rows (S.No "01", "02", … across pages). */
export interface FilteredRow {
  row: AllocationRow;
  index: number;
  position: number;
}

export function applyFilters(rows: AllocationRow[], f: TableFilters): FilteredRow[] {
  const out: FilteredRow[] = [];
  rows.forEach((row, index) => {
    if (rowMatches(row, f)) out.push({ row, index, position: out.length + 1 });
  });
  return out;
}

/** Rows with errors that the filters currently hide (so the page can say so). */
export function hiddenErrorCount(shown: FilteredRow[], errorIndices: Iterable<number>): number {
  const visible = new Set(shown.map((s) => s.index));
  let n = 0;
  for (const i of Array.from(errorIndices)) if (!visible.has(i)) n++;
  return n;
}
