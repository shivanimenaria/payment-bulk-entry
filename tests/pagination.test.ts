import { describe, it, expect } from "vitest";
import {
  PAGE_SIZE,
  clampPage,
  pageCount,
  pageOfIndex,
  pageResetKey,
  pageSlice,
  pagesWithErrors,
  rangeLabel,
  syncPage,
  type PageState,
} from "@/lib/payments/pagination";
import { computeTotals } from "@/lib/payments/totals";
import { validateAllocation } from "@/lib/payments/validation";
import { setRowAmount } from "@/lib/payments/allocation";
import { rowsForCurrency } from "@/lib/payments/currency";
import type { AllocationRow, PaymentHeader } from "@/types/payments";

const INR = { id: "c-inr", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
const USD = { id: "c-usd", name: "US Dollar", symbol: "$", code: "USD", locale: "en-US" };

function row(i: number, currency = INR, amount = ""): AllocationRow {
  return {
    config: {
      payment_request_id: `PR${i}`,
      status: "approved",
      request_amount: "100.0000",
      paid_amount: "0",
      payment_due: "100.0000",
      currency,
      project_id: "p",
    },
    details: null,
    projectName: "P",
    projectIdSource: "config",
    detailsUnavailable: false,
    detailsError: null,
    amount,
    remark: "",
    remarkOverridden: false,
    rowStatus: "idle",
    rowError: null,
  };
}
const rowsN = (n: number, currency = INR) => Array.from({ length: n }, (_, i) => row(i + 1, currency));
const header = (amountPaid: string): PaymentHeader => ({
  amountPaid,
  paymentDate: "2026-10-15",
  paymentMode: "cash",
  reference: "",
  remark: "",
});

describe("page slicing", () => {
  it("20 rows per page; the last page holds the remainder", () => {
    const rows = rowsN(45);
    expect(PAGE_SIZE).toBe(20);
    const p1 = pageSlice(rows, 1);
    expect(p1.rows.map((r) => r.config.payment_request_id)).toEqual(rows.slice(0, 20).map((r) => r.config.payment_request_id));
    expect(p1).toMatchObject({ page: 1, pageCount: 3, start: 0, end: 20, total: 45, hasPrevious: false, hasNext: true });
    const p2 = pageSlice(rows, 2);
    expect(p2).toMatchObject({ start: 20, end: 40, hasPrevious: true, hasNext: true });
    expect(p2.rows[0].config.payment_request_id).toBe("PR21");
    const p3 = pageSlice(rows, 3);
    expect(p3).toMatchObject({ start: 40, end: 45, hasPrevious: true, hasNext: false });
    expect(p3.rows).toHaveLength(5);
  });

  it("range text", () => {
    const rows = rowsN(45);
    expect(rangeLabel(pageSlice(rows, 1))).toBe("Showing 1–20 of 45");
    expect(rangeLabel(pageSlice(rows, 2))).toBe("Showing 21–40 of 45");
    expect(rangeLabel(pageSlice(rows, 3))).toBe("Showing 41–45 of 45");
    expect(rangeLabel(pageSlice(rowsN(39), 2))).toBe("Showing 21–39 of 39");
    expect(rangeLabel(pageSlice([], 1))).toBe("Showing 0 of 0");
  });

  it("S.No continues across pages: page 2 starts at global index 20 → S.No 21", () => {
    const s = pageSlice(rowsN(45), 2);
    expect(s.start + 1).toBe(21);
    expect(pageOfIndex(20)).toBe(2);
    expect(pageOfIndex(19)).toBe(1);
  });
});

describe("bounds", () => {
  it("page count is at least 1; exact multiples don't add an empty page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
    expect(pageCount(40)).toBe(2);
  });

  it("out-of-range / invalid pages are clamped", () => {
    expect(clampPage(0, 45)).toBe(1);
    expect(clampPage(-3, 45)).toBe(1);
    expect(clampPage(9, 45)).toBe(3);
    expect(clampPage(Number.NaN, 45)).toBe(1);
    expect(clampPage(2.7, 45)).toBe(2);
    expect(pageSlice(rowsN(45), 99)).toMatchObject({ page: 3, start: 40, end: 45, hasNext: false });
    expect(pageSlice([], 5)).toMatchObject({ page: 1, start: 0, end: 0, hasPrevious: false, hasNext: false });
  });

  it("rows shrinking under the current page (e.g. after a refetch) clamps to the last page", () => {
    const state: PageState = { page: 3, key: pageResetKey("INR", 1) };
    expect(syncPage(state, pageResetKey("INR", 1), 25)).toBe(2);
  });
});

describe("reset", () => {
  it("currency change → page 1", () => {
    const state: PageState = { page: 2, key: pageResetKey("INR", 1) };
    expect(syncPage(state, pageResetKey("INR", 1), 45)).toBe(2);
    expect(syncPage(state, pageResetKey("USD", 1), 45)).toBe(1);
    expect(syncPage(state, pageResetKey(null, 1), 45)).toBe(1);
  });

  it("data reload → page 1", () => {
    const state: PageState = { page: 3, key: pageResetKey("INR", 1) };
    expect(syncPage(state, pageResetKey("INR", 2), 45)).toBe(1);
  });
});

describe("display-only: totals, validation and amounts use ALL rows", () => {
  it("totals are the same on every page and include rows of other pages", () => {
    const rows = rowsN(45).map((r, i) => (i === 0 || i === 30 ? setRowAmount(r, "100") : r));
    const all = computeTotals("200", rows);
    expect(all.selectedCount).toBe(2);
    expect(all.excessUnits).toBe(BigInt(0));
    // What the page renders doesn't feed the totals.
    for (const p of [1, 2, 3]) {
      pageSlice(rows, p);
      expect(computeTotals("200", rows)).toEqual(all);
    }
    // Contrast: totals of page 1 only would be wrong.
    expect(computeTotals("200", pageSlice(rows, 1).rows).selectedCount).toBe(1);
  });

  it("entered amounts survive switching pages (rows are updated by id, globally)", () => {
    let rows = rowsN(45);
    // Edit row S.No 25 while on page 2 (global index 24).
    const onPage2 = pageSlice(rows, 2);
    const id = onPage2.rows[24 - onPage2.start].config.payment_request_id;
    rows = rows.map((r) => (r.config.payment_request_id === id ? setRowAmount(r, "40") : r));
    // Edit row S.No 3 on page 1.
    rows = rows.map((r, i) => (i === 2 ? setRowAmount(r, "10") : r));

    expect(pageSlice(rows, 1).rows[2].amount).toBe("10");
    expect(pageSlice(rows, 3).rows.every((r) => r.amount === "")).toBe(true);
    expect(pageSlice(rows, 2).rows[4].amount).toBe("40");
    expect(computeTotals("50", rows).excessUnits).toBe(BigInt(0));
  });

  it("only the selected currency's rows are paged", () => {
    const rows = [...rowsN(25), ...rowsN(10, USD).map((r, i) => ({ ...r, config: { ...r.config, payment_request_id: `U${i}` } }))];
    expect(pageSlice(rowsForCurrency(rows, "INR"), 2)).toMatchObject({ total: 25, start: 20, end: 25 });
    expect(pageSlice(rowsForCurrency(rows, "USD"), 1)).toMatchObject({ total: 10, pageCount: 1 });
  });

  it("validation errors on another page are reported by page", () => {
    // Row S.No 25 (page 2) overpays its due.
    const rows = rowsN(45).map((r, i) => (i === 24 ? setRowAmount(r, "150") : r));
    const v = validateAllocation(header("150"), rows);
    const errorIdx = Object.keys(v.errors.rows).map(Number);
    expect(errorIdx).toContain(24);
    expect(pagesWithErrors(errorIdx, 1)).toEqual([2]);
    expect(pagesWithErrors(errorIdx, 2)).toEqual([]);
  });

  it("pagesWithErrors: unique, sorted, ignores the current page and bad indices", () => {
    expect(pagesWithErrors([45, 3, 41, 22, -1, 1.5], 1)).toEqual([2, 3]);
    expect(pagesWithErrors(new Set([0, 1]), 1)).toEqual([]);
  });
});
