import { describe, it, expect } from "vitest";
import { autoAllocate, autoAllocatePaidUnits, hasReplaceableAmounts } from "@/lib/payments/allocation";
import { applyFilters, EMPTY_FILTERS } from "@/lib/payments/filters";
import { pageSlice } from "@/lib/payments/pagination";
import { computeTotals } from "@/lib/payments/totals";
import { userUnits } from "@/lib/payments/money";
import type { AllocationRow } from "@/types/payments";

const INR = { id: "cur-inr", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };

function row(id: string, due: string, over: Partial<AllocationRow> = {}): AllocationRow {
  return {
    config: { payment_request_id: id, status: "approved", request_amount: due, paid_amount: "0", payment_due: due, currency: INR, project_id: "p" },
    details: null,
    projectName: "P",
    projectIdSource: "config",
    detailsUnavailable: false,
    detailsError: null,
    amount: "",
    remark: "",
    remarkOverridden: false,
    rowStatus: "idle",
    rowError: null,
    ...over,
  };
}
const ids = (rs: AllocationRow[]) => rs.map((r) => r.config.payment_request_id);
const amounts = (rs: AllocationRow[]) => rs.map((r) => r.amount);

describe("autoAllocate", () => {
  it("example: 2000 over 44, 1247.62, 243425290… → 44, 1247.62, 708.38, rest empty", () => {
    const rows = [row("a", "44.0000"), row("b", "1247.6200"), row("c", "243425290.0000"), row("d", "10.0000"), row("e", "5.0000")];
    const out = autoAllocate(rows, ids(rows), "2000");
    expect(amounts(out)).toEqual(["44", "1247.62", "708.38", "", ""]);
    const t = computeTotals("2000", out);
    expect(t.allocatedUnits).toBe(userUnits("2000"));
    expect(t.excessUnits).toBe(BigInt(0));
  });

  it("exact sums with paise and sub-paisa (no floats)", () => {
    const rows = [row("a", "0.1000"), row("b", "0.2000"), row("c", "0.0003"), row("d", "99.9999")];
    const out = autoAllocate(rows, ids(rows), "50.3002");
    expect(amounts(out)).toEqual(["0.1", "0.2", "0.0003", "49.9999"]);
    expect(computeTotals("50.3002", out).excessUnits).toBe(BigInt(0));
    // 20-digit amounts stay exact.
    const big = [row("x", "99999999999999999998.9999"), row("y", "5.0000")];
    expect(amounts(autoAllocate(big, ids(big), "99999999999999999999.9999"))).toEqual(["99999999999999999998.9999", "1"]);
  });

  it("skips rows that can't take a payment and leaves them untouched", () => {
    const rows = [
      row("over", "100000000000000000000.0000"),
      row("pending", "10.0000", { detailsUnavailable: true }),
      row("err", "10.0000", { detailsError: "Could not load details" }),
      row("failed", "10.0000", { rowError: "rDash rejected", amount: "7" }),
      row("ok", "30.0000"),
    ];
    const out = autoAllocate(rows, ids(rows), "25");
    expect(amounts(out)).toEqual(["", "", "", "7", "25"]);
  });

  it("follows the display order and respects filters (hidden rows cleared, remarks kept)", () => {
    const rows = [
      row("a", "100.0000", { projectName: "Alpha", amount: "3", remark: "keep" }),
      row("b", "100.0000", { projectName: "Beta" }),
      row("c", "100.0000", { projectName: "Alpha" }),
    ];
    const shown = applyFilters(rows, { ...EMPTY_FILTERS, project: ["Beta"] });
    const out = autoAllocate(rows, shown.map((s) => s.row.config.payment_request_id), "150");
    expect(amounts(out)).toEqual(["", "100", ""]);
    expect(out[0].remark).toBe("keep");
    // Reversed display order fills the last row first.
    expect(amounts(autoAllocate(rows, ["c", "b", "a"], "150"))).toEqual(["", "50", "100"]);
  });

  it("covers all pages, not only the visible one", () => {
    const rows = Array.from({ length: 45 }, (_, i) => row(`r${i}`, "10.0000"));
    const shown = applyFilters(rows, EMPTY_FILTERS);
    expect(pageSlice(shown, 1).rows.length).toBeLessThan(45);
    const out = autoAllocate(rows, shown.map((s) => s.row.config.payment_request_id), "425");
    expect(out.slice(0, 42).every((r) => r.amount === "10")).toBe(true);
    expect(out[42].amount).toBe("5");
    expect(out[44].amount).toBe("");
  });

  it("Amount Paid above total due → every row in full, the rest is Excess", () => {
    const rows = [row("a", "44.0000"), row("b", "1247.6200")];
    const out = autoAllocate(rows, ids(rows), "2000");
    expect(amounts(out)).toEqual(["44", "1247.62"]);
    expect(computeTotals("2000", out).excessUnits).toBe(userUnits("708.38"));
  });

  it("overwrites amounts already entered; invalid Amount Paid changes nothing", () => {
    const rows = [row("a", "10.0000", { amount: "1" }), row("b", "10.0000", { amount: "9" })];
    expect(amounts(autoAllocate(rows, ids(rows), "12"))).toEqual(["10", "2"]);
    for (const bad of ["", "0", "0.00", "abc", "1.23456", "-5", "1e3"]) expect(autoAllocate(rows, ids(rows), bad)).toBe(rows);
  });
});

describe("Auto allocate guards", () => {
  it("enabled only for a valid Amount Paid > 0", () => {
    for (const bad of ["", " ", "0", "0.0000", ".", "abc", "1.23456", "-1", "123456789012345678901"]) expect(autoAllocatePaidUnits(bad)).toBeNull();
    expect(autoAllocatePaidUnits("0.0001")).toBe(BigInt(1));
    expect(autoAllocatePaidUnits("2000")).toBe(BigInt(20000000));
  });

  it("asks to replace only when an editable row has an amount", () => {
    expect(hasReplaceableAmounts([row("a", "10.0000"), row("b", "10.0000")])).toBe(false);
    expect(hasReplaceableAmounts([row("a", "10.0000", { amount: "5" })])).toBe(true);
    expect(hasReplaceableAmounts([row("a", "10.0000", { amount: "5", rowError: "failed" })])).toBe(false);
  });
});
