"use client";

import { ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { rdButtonOutline, rdTextLink } from "@/components/rd/styles";
import { rangeLabel, type PageSlice } from "@/lib/payments/pagination";
import { EMPTY_FILTERS, filtersActive, type FilterOptionKey, type FilteredRow, type TableFilters } from "@/lib/payments/filters";
import { Input } from "@/components/ui/input";
import { SelectOptionFilter, rfqFilterInput } from "@/components/rd/SelectOptionFilter";
import { RdStepper } from "@/components/rd/RdStepper";
import { cn } from "@/lib/utils";
import { AllocationRow } from "./AllocationRow";

/** S.No column width (RFQ `w-[60px]`, trimmed so page 1 fits at 1440px). */
export const SNO_WIDTH = 56;

/** Height of the column header row (py-2 + 11px label + gap-1.5 + h-7
 *  filter; measured 70px in Chrome) — the centred table states fill the rest
 *  of the scroll area. */
const HEADER_HEIGHT = 70;

/** RFQ footer link ("+ Create RFQ"): 14px semibold brand red (rDash token). */
export const rfqFooterLink =
  "text-sm font-semibold text-rd-red transition-colors hover:text-[#d41f24] disabled:cursor-not-allowed disabled:text-rd-disabled";

// Table card laid out like the RFQ list table card (`bg-white rounded-xl
// border border-gray-200 shadow-sm flex flex-col overflow-hidden`) and like
// rDash's Vendor Payments table: only the rows scroll. The box takes all
// remaining page height (flex-1, min-h-0); the stepper title row and the
// footer are fixed (shrink-0); messages are inline (form card, rows, pager); the body is ONE scroll
// container for both axes (overflow-auto) with the column header sticky
// inside it, so header and rows scroll together horizontally and columns stay
// aligned. The body is a size container (cqw / cqh) so table states can be
// centred in the visible area. Footer like RFQ's ("+ Create RFQ" left,
// `px-5 py-3 border-t border-gray-100`).
export function TableBox({
  title,
  action,
  footer,
  children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label="Payment due"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="shrink-0">
        <RdStepper items={[{ key: "due", label: title, active: true }]} right={action} />
      </div>
      <div data-testid="table-scroll" className="relative min-h-0 min-w-0 flex-1 overflow-auto [container-type:size]">
        {children}
      </div>
      {footer ? (
        <div data-testid="table-footer" className="flex shrink-0 items-center gap-3 border-t border-gray-100 px-5 py-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

interface Column {
  key: string;
  label: string;
  width: number;
  right?: boolean;
  /** Only on /payments/new (page 1 is read-only). */
  input?: boolean;
}

// table-fixed: every column has an explicit width (RFQ). Page 1's columns
// sum to 1316px so the table fits without horizontal scroll at 1440px (the
// table area is ~1326px inside the rDash chrome); w-full spreads any extra
// width proportionally. Page 2 adds Payment Done + Remarks and scrolls
// horizontally (one container — header and rows stay aligned).
const COLUMNS: Column[] = [
  { key: "sno", label: "S.No", width: SNO_WIDTH },
  { key: "requestId", label: "Request ID", width: 150 },
  { key: "project", label: "Project Name", width: 180 },
  { key: "requestDate", label: "Request Date", width: 130 },
  { key: "requestType", label: "Request Type", width: 140 },
  { key: "dueDate", label: "Due Date", width: 130 },
  { key: "requestedBy", label: "Requested By", width: 140 },
  { key: "status", label: "Status", width: 130 },
  { key: "requestedAmount", label: "Requested Amount", width: 130, right: true },
  { key: "paymentDue", label: "Payment Due", width: 130, right: true },
  { key: "paymentDone", label: "Payment Done", width: 210, input: true },
  { key: "remarks", label: "Remarks", width: 170, input: true },
];

const headLabel = "text-[11px] font-semibold tracking-wide text-gray-700";

// Header like the RFQ list: one light-grey sticky row, each label (11px
// semibold, tracking-wide, gray-700) stacked above its filter control (h-7,
// border-gray-200, rounded, white): funnel under S.No (red + clickable to
// clear when a filter is on), "Search" under Request ID, dd/mm/yyyy date
// inputs, "Select Option" dropdowns (Project Name, Request Type, Requested
// By, Status) built from the loaded rows. The bottom border is an inset shadow so it moves with the
// sticky cells. `items` = the current page of the FILTERED rows; each item
// carries its index in the full list (handlers, row errors) and its position
// among the shown rows (S.No "01" … across pages). `placeholder` (loading /
// empty / error) replaces the rows inside the scroll area under the header,
// pinned to the visible width.
export function AllocationTable({
  items,
  readOnly = false,
  filters,
  filterOptions: options,
  onFilters,
  placeholder,
  placeholderAlign = "center",
  rowErrors,
  onAmount,
  onPayInFull,
  onRemark,
  currencySymbol,
  todayKey,
}: {
  /** Single currency symbol of the rows (null = none / mixed). */
  currencySymbol: string | null;
  /** Current page of the filtered rows. */
  items: FilteredRow[];
  /** Page 1 (/payments): no Payment Done / Pay in full / Remarks columns. */
  readOnly?: boolean;
  filters: TableFilters;
  filterOptions: Record<FilterOptionKey, string[]>;
  onFilters: (next: TableFilters) => void;
  /** Shown instead of the rows (loading skeleton, empty state, load error). */
  placeholder?: React.ReactNode;
  /** "center" = centred in the visible rows area; "top" = from the top. */
  placeholderAlign?: "center" | "top";
  /** Keyed by index in the full list. */
  rowErrors?: Record<number, Record<string, string>>;
  onAmount?: (index: number, value: string) => void;
  onPayInFull?: (index: number) => void;
  onRemark?: (index: number, value: string) => void;
  todayKey: string;
}) {
  const columns = readOnly ? COLUMNS.filter((c) => !c.input) : COLUMNS;
  const minWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const active = filtersActive(filters);
  const set = <K extends keyof TableFilters>(key: K, value: TableFilters[K]) => onFilters({ ...filters, [key]: value });
  const select = (key: FilterOptionKey, label: string) => (
    <SelectOptionFilter label={`${label} filter`} options={options[key]} selected={filters[key]} onChange={(v) => set(key, v)} />
  );
  const date = (key: "requestDate" | "dueDate", label: string) => (
    <Input
      type="date"
      aria-label={`${label} filter`}
      value={filters[key]}
      onChange={(e) => set(key, e.target.value)}
      className="h-7 rounded border-gray-200 bg-white px-2 text-xs"
    />
  );
  const control = (c: Column): React.ReactNode => {
    switch (c.key) {
      case "sno":
        return (
          <button
            type="button"
            data-testid="filters-funnel"
            onClick={() => (active ? onFilters(EMPTY_FILTERS) : undefined)}
            title={active ? "Clear all filters" : "Filters"}
            className={cn("inline-flex h-7 items-center justify-center", active ? "cursor-pointer hover:opacity-80" : "cursor-default")}
          >
            <Filter className={cn("h-3.5 w-3.5", active ? "text-rd-red" : "text-gray-400")} fill={active ? "currentColor" : "none"} strokeWidth={1.5} />
          </button>
        );
      case "requestId":
        return (
          <input
            aria-label="Request ID search"
            placeholder="Search"
            value={filters.requestId}
            onChange={(e) => set("requestId", e.target.value)}
            className={cn(rfqFilterInput, "min-w-0 text-gray-900 outline-none placeholder:text-gray-400 focus:border-rd-red")}
          />
        );
      case "project":
        return select("project", "Project");
      case "requestDate":
        return date("requestDate", "Request Date");
      case "dueDate":
        return date("dueDate", "Due Date");
      case "requestType":
        return select("requestType", "Request Type");
      case "requestedBy":
        return select("requestedBy", "Requested By");
      case "status":
        return select("status", "Status");
      default:
        return <div className="h-7" />;
    }
  };
  return (
    <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth }}>
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={{ width: c.width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th
              key={c.key}
              scope="col"
              className={cn(
                "sticky top-0 z-10 overflow-hidden border-0 bg-gray-50 px-2 py-2 text-left align-top font-normal shadow-[inset_0_-1px_0_#e5e7eb]",
                i === 0 && "pl-3",
                i === columns.length - 1 && "pr-3",
              )}
            >
              <div className={cn("flex flex-col gap-1.5", c.right && "items-end")}>
                <div className={headLabel}>{c.label}</div>
                {control(c)}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {placeholder ? (
          <tr>
            <td colSpan={columns.length} className="p-0">
              <div
                data-testid="table-placeholder"
                className={cn("sticky left-0 w-[100cqw]", placeholderAlign === "center" && "flex flex-col items-center justify-center")}
                style={placeholderAlign === "center" ? { height: `max(240px, calc(100cqh - ${HEADER_HEIGHT}px))` } : undefined}
              >
                {placeholder}
              </div>
            </td>
          </tr>
        ) : null}
        {!placeholder &&
          items.map(({ row, index: i, position }) => (
            <AllocationRow
              key={row.config.payment_request_id}
              row={row}
              index={i}
              position={position}
              todayKey={todayKey}
              currencySymbol={currencySymbol}
              readOnly={readOnly}
              amountError={rowErrors?.[i]?.amount}
              onAmount={(v) => onAmount?.(i, v)}
              onPayInFull={() => onPayInFull?.(i)}
              onRemark={(v) => onRemark?.(i, v)}
            />
          ))}
      </tbody>
    </table>
  );
}

// Pager for the table footer (right side): "Showing 21–40 of 45", a link per
// other page that holds row errors, and Previous / Next (rDash outlined
// buttons), disabled at the ends.
export function TablePagination({
  slice,
  errorPages,
  hiddenErrors = 0,
  onClearFilters,
  onPage,
  disabled,
}: {
  slice: Pick<PageSlice<unknown>, "start" | "end" | "total" | "page" | "pageCount" | "hasPrevious" | "hasNext">;
  /** Other pages with row errors (pagesWithErrors). */
  errorPages: number[];
  /** Rows with errors that the filters hide (next to "Errors on page N"). */
  hiddenErrors?: number;
  onClearFilters?: () => void;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  return (
    <nav aria-label="Payment requests pages" className="ml-auto flex items-center gap-[10px]">
      {hiddenErrors > 0 ? (
        <span className="text-[12px] text-rd-red" role="status" data-testid="hidden-errors">
          {hiddenErrors} with error{hiddenErrors === 1 ? "" : "s"} hidden by filters
          {onClearFilters ? (
            <>
              {" · "}
              <button type="button" className={cn(rdTextLink, "text-[12px] underline")} onClick={onClearFilters}>
                Clear filters
              </button>
            </>
          ) : null}
        </span>
      ) : null}
      {errorPages.length > 0 ? (
        <span className="text-[12px] text-rd-red" role="status">
          Errors on page{errorPages.length > 1 ? "s" : ""}{" "}
          {errorPages.map((p, i) => (
            <span key={p}>
              {i > 0 ? ", " : ""}
              <button type="button" className={cn(rdTextLink, "text-[12px] underline")} onClick={() => onPage(p)}>
                {p}
              </button>
            </span>
          ))}
        </span>
      ) : null}
      <span className="whitespace-nowrap text-[14px] text-rd-text" aria-live="polite">
        {rangeLabel(slice)}
      </span>
      <button
        type="button"
        className={cn(rdButtonOutline, "px-3")}
        disabled={disabled || !slice.hasPrevious}
        onClick={() => onPage(slice.page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Previous
      </button>
      <button
        type="button"
        className={cn(rdButtonOutline, "px-3")}
        disabled={disabled || !slice.hasNext}
        onClick={() => onPage(slice.page + 1)}
        aria-label="Next page"
      >
        Next
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
}

// rDash PaymentEntryRowsLoader: rows of p-20 border-b with MUI text skeletons.
export function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading payment requests">
      {Array.from({ length: 10 }).map((_, r) => (
        <div key={r} className="grid grid-cols-[0.5fr_1.5fr_1.75fr_2fr_1.75fr_1.75fr_1.5fr_1.5fr_1.75fr_1.5fr] gap-[10px] border-b p-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className={cn("h-[14px] animate-pulse rounded bg-black/[0.11]", i === 0 && "w-5")} />
          ))}
        </div>
      ))}
    </div>
  );
}
