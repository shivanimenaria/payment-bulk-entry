import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTERS,
  applyFilters,
  filterOptions,
  filtersActive,
  filtersKey,
  hiddenErrorCount,
  type TableFilters,
} from "@/lib/payments/filters";
import {
  dueDateDisplay,
  formatSerial,
  formatShortDate,
  formatTableAmount,
  localDateKey,
  requestTypeBadgeClass,
  statusBadge,
  titleCase,
} from "@/lib/payments/table-display";
import { pageSlice } from "@/lib/payments/pagination";
import { computeTotals } from "@/lib/payments/totals";
import { validateAllocation } from "@/lib/payments/validation";
import { setRowAmount } from "@/lib/payments/allocation";
import { buildSubmitRequest } from "@/lib/payments/build-payload";
import type { AllocationRow, PaymentHeader } from "@/types/payments";

// RFQ-style table: cell display rules and the client-side filters (display
// only — totals, validation and the submit never see them).

const INR = { id: "c-inr", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
function row(
  id: string,
  opts: { status?: string; number?: string | null; type?: string; by?: string | null; at?: string; due?: string | null; project?: string | null; amountDue?: string } = {},
): AllocationRow {
  const due = opts.amountDue ?? "100.0000";
  return {
    config: { payment_request_id: id, status: opts.status ?? "approved", request_amount: due, paid_amount: "0", payment_due: due, currency: INR, project_id: "p" },
    details: {
      id,
      request_number: opts.number === undefined ? `PR-${id}` : opts.number,
      request_type: opts.type ?? "invoice",
      requested_by: opts.by === null ? null : { id: "u", name: opts.by ?? "Anita Sharma" },
      requested_at: opts.at ?? "2026-05-20T10:00:00",
      due_date: opts.due === undefined ? "2026-06-11" : opts.due,
    } as unknown as AllocationRow["details"],
    projectName: opts.project === undefined ? "Tower A" : opts.project,
    projectIdSource: "config",
    detailsUnavailable: false,
    detailsError: null,
    amount: "",
    remark: "",
    remarkOverridden: false,
    rowStatus: "idle",
    rowError: null,
  };
}

const ROWS = [
  row("1", { status: "approved", type: "invoice", by: "Anita Sharma", at: "2026-05-20T10:00:00", due: "2026-06-11", project: "Tower A" }),
  row("2", { status: "pending", type: "po_advance", by: "Rahul Verma", at: "2026-05-21T09:00:00", due: "2026-06-12", project: "Villas" }),
  row("3", { status: "submitted", type: "non_order", by: null, at: "2026-05-20T18:30:00", due: null, project: "Tower A", number: null }),
  row("4", { status: "approved", type: "invoice", by: "Anita Sharma", at: "2026-06-01", due: "2026-06-11", project: "Mall", number: "INV-77" }),
];
const F = (over: Partial<TableFilters>): TableFilters => ({ ...EMPTY_FILTERS, ...over });

describe("cell display (RFQ look)", () => {
  it("S.No zero-padded, continuing across pages", () => {
    expect(formatSerial(1)).toBe("01");
    expect(formatSerial(21)).toBe("21");
    expect(formatSerial(123)).toBe("123");
  });
  it("dates '20 May 2026'; plain dates never shift; '—' when missing", () => {
    expect(formatShortDate("2026-05-20")).toBe("20 May 2026");
    expect(formatShortDate("2026-06-04")).toBe("04 Jun 2026");
    expect(formatShortDate("2026-05-20T10:00:00")).toBe("20 May 2026");
    expect(formatShortDate(null)).toBe("—");
    expect(formatShortDate("garbage")).toBe("—");
    expect(localDateKey("2026-05-20")).toBe("2026-05-20");
  });
  it("Due Date: red when past, grey otherwise; accent bar like RFQ deadline urgency", () => {
    expect(dueDateDisplay("2026-06-10", "2026-06-11")).toMatchObject({ text: "10 Jun 2026", className: "text-red-600 font-medium", accent: "border-l-4 border-l-red-400", icon: true });
    expect(dueDateDisplay("2026-06-11", "2026-06-11")).toMatchObject({ className: "text-gray-500", accent: "border-l-4 border-l-red-400" });
    expect(dueDateDisplay("2026-06-12", "2026-06-11").accent).toBe("border-l-4 border-l-red-300");
    expect(dueDateDisplay("2026-06-14", "2026-06-11").accent).toBe("border-l-4 border-l-orange-300");
    expect(dueDateDisplay("2026-06-30", "2026-06-11")).toMatchObject({ className: "text-gray-500", accent: "" });
    expect(dueDateDisplay(null, "2026-06-11")).toMatchObject({ text: "—", icon: false, accent: "" });
  });
  it("Request Type pill: Invoice blue, PO Advance amber, Non Order orange, others amber", () => {
    expect(requestTypeBadgeClass("invoice")).toContain("blue");
    expect(requestTypeBadgeClass("Invoice")).toContain("blue");
    expect(requestTypeBadgeClass("po_advance")).toContain("amber");
    expect(requestTypeBadgeClass("non_order")).toContain("orange");
    expect(requestTypeBadgeClass("Non Order")).toContain("orange");
    expect(requestTypeBadgeClass("Running Bill")).toContain("amber");
  });
  it("Status pill: Approved green, Pending amber, Submitted blue, title case", () => {
    expect(statusBadge("approved")).toMatchObject({ label: "Approved", dot: "bg-green-500" });
    expect(statusBadge("pending")).toMatchObject({ label: "Pending", dot: "bg-amber-500" });
    expect(statusBadge("submitted")).toMatchObject({ label: "Submitted", dot: "bg-blue-500" });
    expect(statusBadge("on_hold")).toMatchObject({ label: "On Hold", dot: "bg-gray-400" });
    expect(titleCase("partially_paid")).toBe("Partially Paid");
  });
  it("amounts '₹92,06,000' — symbol attached, decimals only when non-zero, exact", () => {
    expect(formatTableAmount("9206000.0000", "₹")).toBe("₹92,06,000");
    expect(formatTableAmount("29999.5000", "₹")).toBe("₹29,999.50");
    expect(formatTableAmount("0.0001", "₹")).toBe("₹0.0001");
    expect(formatTableAmount("99999999999999999999999999999.9999", "₹")).toBe("₹99,99,99,99,99,99,99,99,99,99,99,99,99,999.9999");
    expect(formatTableAmount("abc", "₹")).toBe("abc");
    expect(formatTableAmount(null, "₹")).toBe("—");
  });
});

describe("filters (display only)", () => {
  it("options built from the loaded rows (distinct, sorted, no empties)", () => {
    expect(filterOptions(ROWS)).toEqual({
      requestType: ["Invoice", "Non Order", "PO Advance"],
      requestedBy: ["Anita Sharma", "Rahul Verma"],
      status: ["Approved", "Pending", "Submitted"],
      project: ["Mall", "Tower A", "Villas"],
    });
  });

  it("no filter → all rows, positions 1…n, indices kept", () => {
    expect(applyFilters(ROWS, EMPTY_FILTERS).map((r) => [r.index, r.position])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]]);
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
  });

  it("Request ID search: contains, case-insensitive; rows without a number never match", () => {
    expect(applyFilters(ROWS, F({ requestId: "inv" })).map((r) => r.row.config.payment_request_id)).toEqual(["4"]);
    expect(applyFilters(ROWS, F({ requestId: "  PR-" })).map((r) => r.row.config.payment_request_id)).toEqual(["1", "2"]);
  });

  it("Request Date / Due Date: exact local day", () => {
    expect(applyFilters(ROWS, F({ requestDate: "2026-05-20" })).map((r) => r.row.config.payment_request_id)).toEqual(["1", "3"]);
    expect(applyFilters(ROWS, F({ requestDate: "2026-06-01" })).map((r) => r.row.config.payment_request_id)).toEqual(["4"]);
    expect(applyFilters(ROWS, F({ dueDate: "2026-06-11" })).map((r) => r.row.config.payment_request_id)).toEqual(["1", "4"]);
  });

  it("Select Option filters: any of the picked values; combined with AND", () => {
    expect(applyFilters(ROWS, F({ status: ["Approved", "Pending"] })).map((r) => r.row.config.payment_request_id)).toEqual(["1", "2", "4"]);
    expect(applyFilters(ROWS, F({ status: ["Approved"], project: ["Mall"] })).map((r) => r.row.config.payment_request_id)).toEqual(["4"]);
    expect(applyFilters(ROWS, F({ requestType: ["PO Advance"] })).map((r) => r.row.config.payment_request_id)).toEqual(["2"]);
    expect(applyFilters(ROWS, F({ requestedBy: ["Rahul Verma"] })).map((r) => r.row.config.payment_request_id)).toEqual(["2"]);
  });

  it("positions renumber the shown rows (S.No 01, 02 …) while indices stay global", () => {
    const shown = applyFilters(ROWS, F({ status: ["Approved"] }));
    expect(shown.map((s) => [s.index, s.position])).toEqual([[0, 1], [3, 2]]);
  });

  it("pagination counts only the shown rows", () => {
    const many = Array.from({ length: 45 }, (_, i) => row(String(i), { status: i % 3 === 0 ? "pending" : "approved" }));
    const shown = applyFilters(many, F({ status: ["Pending"] }));
    expect(shown).toHaveLength(15);
    expect(pageSlice(shown, 1)).toMatchObject({ total: 15, pageCount: 1 });
    expect(pageSlice(applyFilters(many, EMPTY_FILTERS), 3)).toMatchObject({ total: 45, start: 40, end: 45 });
  });

  it("never change totals, validation or what is submitted — amounts on hidden rows are kept", () => {
    const rows = [setRowAmount(ROWS[0], "100"), setRowAmount(ROWS[1], "50"), ROWS[2], ROWS[3]];
    const header: PaymentHeader = { amountPaid: "150", paymentDate: "2026-09-23", paymentMode: "upi", reference: "", remark: "" };
    const before = computeTotals("150", rows);
    const shown = applyFilters(rows, F({ status: ["Pending"] }));
    expect(shown.map((s) => s.row.config.payment_request_id)).toEqual(["2"]);
    expect(rows[0].amount).toBe("100"); // hidden, kept
    expect(computeTotals("150", rows)).toEqual(before);
    const v = validateAllocation(header, rows);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(buildSubmitRequest(header, v.value).rows.map((r) => r.payment_request_id)).toEqual(["1", "2"]);
  });

  it("hidden error rows are counted; filtersKey changes with the filters", () => {
    const shown = applyFilters(ROWS, F({ status: ["Pending"] }));
    expect(hiddenErrorCount(shown, [0, 1])).toBe(1);
    expect(filtersKey(EMPTY_FILTERS)).not.toBe(filtersKey(F({ status: ["Pending"] })));
    expect(filtersKey(F({ requestId: " PR " }))).toBe(filtersKey(F({ requestId: "pr" })));
    expect(filtersActive(F({ dueDate: "2026-06-11" }))).toBe(true);
  });
});
