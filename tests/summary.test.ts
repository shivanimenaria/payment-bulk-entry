import { describe, it, expect } from "vitest";
import { SUMMARY_CARDS, summarizeConfig } from "@/lib/payments/summary";
import type { VendorPaymentRequestConfigItem } from "@/types/rdash";

// Page-1 amount cards (lib/payments/summary.ts) — computed server-side from
// the FULL config per currency, exact decimal strings. TODO(verify) with rDash.

const INR = { id: "c-inr", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
const USD = { id: "c-usd", name: "US Dollar", symbol: "$", code: "USD", locale: "en-US" };
function cfg(
  id: string,
  status: string,
  request_amount: string,
  paid_amount: string,
  payment_due: string,
  currency: VendorPaymentRequestConfigItem["currency"] = INR,
): VendorPaymentRequestConfigItem {
  return { payment_request_id: id, status, request_amount, paid_amount, payment_due, currency, project_id: "p" };
}

const CONFIG = [
  cfg("1", "approved", "1000.0000", "0", "1000.0000"),
  cfg("2", "pending", "800.0000", "300.0000", "500.0000"),
  cfg("3", "submitted", "200.5000", "0", "200.5000"),
  cfg("4", "approved", "50.0000", "50.0000", "0"), // fully paid → not payable
  cfg("5", "rejected", "70.0000", "0", "70.0000"),
  cfg("6", "cancelled", "90.0000", "10.0000", "80.0000"),
  cfg("7", "hold", "25.0000", "5.0000", "20.0000"),
  cfg("8", "approved", "99999999999999999999999999999.9999", "0", "1.0000"), // 29 digits — exact
  cfg("9", "approved", "40.0000", "0", "40.0000", USD),
];

describe("summarizeConfig", () => {
  const s = summarizeConfig(CONFIG);

  it("cards in rDash order", () => {
    expect(SUMMARY_CARDS.map((c) => c.title)).toEqual(["Payment Requested", "Payment Approved", "Pending Approval", "Payment Due", "Payments Done"]);
  });

  it("grouped per currency code", () => {
    expect(Object.keys(s).sort()).toEqual(["INR", "USD"]);
    expect(s.USD.paymentRequested).toEqual({ count: 1, total: "40" });
  });

  it("Payment Requested: all except cancelled / rejected, Σ request_amount (BigInt-exact, any size)", () => {
    expect(s.INR.paymentRequested.count).toBe(6);
    expect(s.INR.paymentRequested.total).toBe("100000000000000000000000002075.4999");
  });

  it("Payment Approved: status approved, Σ request_amount", () => {
    expect(s.INR.paymentApproved.count).toBe(3);
    expect(s.INR.paymentApproved.total).toBe("100000000000000000000000001049.9999");
  });

  it("Pending Approval: pending + submitted, Σ request_amount", () => {
    expect(s.INR.pendingApproval).toEqual({ count: 2, total: "1000.5" });
  });

  it("Payment Due: payable rows (current rule), Σ payment_due — hold / rejected / cancelled / due 0 excluded", () => {
    expect(s.INR.paymentDue).toEqual({ count: 4, total: "1701.5" });
  });

  it("Payments Done: Σ paid_amount (except cancelled / rejected), count of rows with paid > 0", () => {
    expect(s.INR.paymentsDone).toEqual({ count: 3, total: "355" });
  });

  it("invalid amounts are never summed (counted in invalidAmounts); rows without a currency code are left out", () => {
    const r = summarizeConfig([
      cfg("x", "approved", "abc", "0", "10.0000"),
      cfg("y", "approved", "10.12345", "0", "10.0000"),
      { ...cfg("z", "approved", "5", "0", "5"), currency: { id: null, name: "?", symbol: "?", code: "" } as VendorPaymentRequestConfigItem["currency"] },
    ]);
    expect(Object.keys(r)).toEqual(["INR"]);
    expect(r.INR.paymentRequested).toEqual({ count: 2, total: "0" });
    expect(r.INR.invalidAmounts).toBe(4); // 2 × request_amount (requested + approved)
    expect(r.INR.paymentDue).toEqual({ count: 2, total: "20" });
  });

  it("statuses are matched exactly (no case-folding)", () => {
    const r = summarizeConfig([cfg("a", "Approved", "10", "0", "10"), cfg("b", "CANCELLED", "5", "0", "5")]);
    expect(r.INR.paymentApproved.count).toBe(0);
    expect(r.INR.paymentRequested.count).toBe(2);
    expect(r.INR.paymentDue.count).toBe(0);
  });
});
