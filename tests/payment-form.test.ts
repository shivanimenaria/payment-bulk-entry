import { describe, it, expect } from "vitest";
import {
  EMPTY_HEADER,
  FORM_FIELDS,
  NEW_PAYMENT_PATH,
  PAYMENTS_PATH,
  PAYMENT_MODE_LABELS,
  canCreatePayment,
  currencyFromSearch,
  hasEnteredAnything,
  paidAndExcess,
  visibleFieldErrors,
  formLevelMessage,
  withCurrency,
} from "@/lib/payments/payment-form";
import { failedPaymentLines, submitPromptFor } from "@/lib/payments/submit";
import { paymentDetailsLine, tallyLine } from "@/lib/payments/payment-form";
import { MESSAGES, PAYMENT_MODES, validateAllocation, validateHeader } from "@/lib/payments/validation";
import { computeTotals } from "@/lib/payments/totals";
import { setRowAmount } from "@/lib/payments/allocation";
import { setRowRemark } from "@/lib/payments/remarks";
import { buildSubmitRequest } from "@/lib/payments/build-payload";
import { formatPaymentDate } from "@/lib/format";
import type { AllocationRow, BulkSubmitResult, PaymentHeader } from "@/types/payments";

// Two-page flow: /payments (read-only, cards) → "+ Create Payment" →
// /payments/new (Create-RFQ-style form + table) → Submit → bulk API.

const INR = { id: "c-inr", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
function row(id: string, due = "100.0000", over: Partial<AllocationRow> = {}): AllocationRow {
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
const details = (n: string, type = "invoice", vendor = "Shree Ganesh Builders") =>
  ({ request_number: n, request_type: type, vendor: { id: "v", name: vendor } }) as unknown as AllocationRow["details"];
const FILLED: PaymentHeader = { amountPaid: "150", paymentDate: "2026-09-23", paymentMode: "upi", reference: "UTR-1", remark: "Sep" };

describe("page 1 → page 2", () => {
  it("+ Create Payment: enabled once loaded with payable rows", () => {
    expect(canCreatePayment({ loaded: true, payableCount: 3 })).toBe(true);
    expect(canCreatePayment({ loaded: true, payableCount: 0 })).toBe(false);
    expect(canCreatePayment({ loaded: false, payableCount: 3 })).toBe(false);
  });
  it("keeps the selected currency in the URL (?currency=INR) both ways", () => {
    expect(PAYMENTS_PATH).toBe("/payments");
    expect(NEW_PAYMENT_PATH).toBe("/payments/new");
    expect(withCurrency(NEW_PAYMENT_PATH, "INR")).toBe("/payments/new?currency=INR");
    expect(withCurrency(PAYMENTS_PATH, null)).toBe("/payments");
    expect(currencyFromSearch("?currency=INR&orgId=x")).toBe("INR");
    expect(currencyFromSearch("?currency=usd")).toBe("USD");
    expect(currencyFromSearch("?currency=%3Cscript%3E")).toBeNull();
    expect(currencyFromSearch("")).toBeNull();
  });
});

describe("page 2 form", () => {
  it("fields in order; payment modes with labels", () => {
    expect(FORM_FIELDS).toEqual(["amountPaid", "paymentDate", "paymentMode", "reference", "remark"]);
    expect(PAYMENT_MODES.map((m) => PAYMENT_MODE_LABELS[m])).toEqual(["Bank Transfer", "Cheque", "Cash", "UPI"]);
  });
  it("'Discard entered amounts?' only when something was entered", () => {
    expect(hasEnteredAnything(EMPTY_HEADER, [row("a")])).toBe(false);
    expect(hasEnteredAnything({ ...EMPTY_HEADER, reference: "x" }, [row("a")])).toBe(true);
    expect(hasEnteredAnything({ ...EMPTY_HEADER, paymentMode: "cash" }, [row("a")])).toBe(true);
    expect(hasEnteredAnything(EMPTY_HEADER, [setRowAmount(row("a"), "5")])).toBe(true);
    expect(hasEnteredAnything(EMPTY_HEADER, [setRowRemark(row("a"), "own")])).toBe(true);
  });
  it("field errors show only after Submit", () => {
    const errors = validateHeader(EMPTY_HEADER).errors;
    expect(visibleFieldErrors(errors, false)).toEqual({});
    expect(Object.keys(visibleFieldErrors(errors, true)).sort()).toEqual(["amountPaid", "paymentDate", "paymentMode"]);
  });
  it("form-level line: only after Submit; submit error first; no duplicates", () => {
    const form = [MESSAGES.noSelection];
    expect(formLevelMessage({ attempted: false, formErrors: form, outcome: null })).toBeNull();
    expect(formLevelMessage({ attempted: true, formErrors: [], outcome: null })).toBeNull();
    expect(formLevelMessage({ attempted: true, formErrors: form, outcome: null })).toBe(MESSAGES.noSelection);
    expect(formLevelMessage({ attempted: true, formErrors: [], outcome: { kind: "error", message: "No access" } })).toBe("No access");
    expect(formLevelMessage({ attempted: true, formErrors: [], outcome: { kind: "rejected", form: [] } })).toBe(
      "Nothing was recorded — fix the highlighted fields and submit again.",
    );
    expect(formLevelMessage({ attempted: true, formErrors: ["Mixed"], outcome: { kind: "rejected", form: ["Mixed"] } })).toBe("Nothing was recorded: Mixed");
  });
  it("same limits: Amount Paid > 0, ≤ 20 digits, ≤ 4 decimals; valid date; mode required", () => {
    expect(validateHeader({ ...FILLED, amountPaid: "0" }).errors.amountPaid).toBe(MESSAGES.amountPositive);
    expect(validateHeader({ ...FILLED, amountPaid: "1.12345" }).errors.amountPaid).toBe(MESSAGES.amountLimit);
    expect(validateHeader({ ...FILLED, paymentDate: "2026-02-30" }).errors.paymentDate).toBe(MESSAGES.paymentDate);
    expect(validateHeader({ ...FILLED, paymentMode: null }).errors.paymentMode).toBe(MESSAGES.paymentMode);
  });
  it("Submit validation: Excess must be 0, ≥ 1 amount, no row errors (existing rules)", () => {
    const two = [setRowAmount(row("a"), "100"), setRowAmount(row("b"), "50")];
    expect(validateAllocation(FILLED, two).ok).toBe(true);
    expect(validateAllocation({ ...FILLED, amountPaid: "200" }, two).summary).toContain(MESSAGES.excess);
    expect(validateAllocation(FILLED, [row("a")]).summary).toContain(MESSAGES.noSelection);
    expect(validateAllocation({ ...FILLED, amountPaid: "150" }, [setRowAmount(row("a"), "150")]).ok).toBe(false);
  });
  it("cards: Amount Paid / Excess '—' until valid; Excess = Paid − Allocated", () => {
    const rows = [setRowAmount(row("a"), "100"), setRowAmount(row("b"), "50")];
    for (const paid of ["", "abc", "0", "1.12345"]) expect(paidAndExcess(computeTotals(paid, rows))).toEqual({ amountPaidUnits: null, excessUnits: null });
    expect(paidAndExcess(computeTotals("200", rows)).excessUnits).toBe(BigInt(500000));
    expect(paidAndExcess(computeTotals("150", rows)).excessUnits).toBe(BigInt(0));
  });
  it("Payment Date shown as '23 Sep 2026'", () => {
    expect(formatPaymentDate("2026-09-23")).toBe("23 Sep 2026");
  });
});

describe("'Some payments could not be recorded' popup (failedPaymentLines)", () => {
  const rows = [
    setRowAmount(row("a", "100.0000", { details: details("PR-1"), projectName: "Tower A" }), "100"),
    setRowAmount(row("b", "80.0000", { details: details("PR-2") }), "50"),
  ];
  const v = validateAllocation(FILLED, rows);
  it("only the failed rows: Request ID, Project Name, Amount sent, Error", () => {
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const request = buildSubmitRequest(FILLED, v.value);
    const result: BulkSubmitResult = {
      count: 2,
      created: [{ id: "e1", payment_request_id: "a" }],
      failed: [{ payment_request_id: "b", error: "Payment request is on hold" }],
      recordedAmount: "100",
      notRecordedAmount: "50",
    };
    expect(failedPaymentLines(result, request, rows)).toEqual([
      { paymentRequestId: "b", requestId: "PR-2", projectName: "P", amountUnits: BigInt(500000), error: "Payment request is on hold" },
    ]);
  });
  it("unknown labels / empty error → '—' (never invented)", () => {
    if (!v.ok) return;
    const request = buildSubmitRequest(FILLED, v.value);
    const lines = failedPaymentLines({ failed: [{ payment_request_id: "a", error: "" }] }, request, [row("a", "100", { projectName: null })]);
    expect(lines[0]).toMatchObject({ requestId: "—", projectName: "—", error: "—", amountUnits: BigInt(1000000) });
  });
});

describe("result prompts after Submit (submitPromptFor + lines)", () => {
  const rows = [
    setRowAmount(row("a", "100.0000", { details: details("PR-1"), projectName: "Tower A" }), "100"),
    setRowAmount(row("b", "80.0000", { details: details("PR-2") }), "50.25"),
  ];
  const v = validateAllocation({ ...FILLED, amountPaid: "150.25" }, rows);
  const request = () => {
    if (!v.ok) throw new Error("invalid");
    return buildSubmitRequest({ ...FILLED, amountPaid: "150.25" }, v.value);
  };
  it("all created → success with count, exact recorded amount and the header", () => {
    const p = submitPromptFor(
      { count: 2, created: [{ id: "e1", payment_request_id: "a" }, { id: "e2", payment_request_id: "b" }], failed: [], recordedAmount: "150.2500", notRecordedAmount: "0" },
      request(),
      rows,
    );
    expect(p).toEqual({
      kind: "success",
      recorded: { count: 2, amountUnits: BigInt(1502500) },
      header: { paymentDate: FILLED.paymentDate, paymentMode: FILLED.paymentMode, reference: FILLED.reference },
    });
    if (p.kind !== "success") return;
    expect(tallyLine(p.recorded, "₹")).toBe("2 payments · ₹ 150.25");
  });
  it("some failed → partial: recorded / not recorded tallies + only the failed rows", () => {
    const p = submitPromptFor(
      { count: 2, created: [{ id: "e1", payment_request_id: "a" }], failed: [{ payment_request_id: "b", error: "On hold" }], recordedAmount: "100", notRecordedAmount: "50.25" },
      request(),
      rows,
    );
    expect(p.kind).toBe("partial");
    if (p.kind !== "partial") return;
    expect(p.recorded).toEqual({ count: 1, amountUnits: BigInt(1000000) });
    expect(p.notRecorded).toEqual({ count: 1, amountUnits: BigInt(502500) });
    expect(p.lines.map((l) => [l.requestId, l.error])).toEqual([["PR-2", "On hold"]]);
  });
  it("lines: singular, exact large amounts, details without an empty reference", () => {
    expect(tallyLine({ count: 1, amountUnits: BigInt("999999999999999999999999") }, "₹")).toBe("1 payment · ₹ 9,99,99,99,99,99,99,99,99,999.9999");
    expect(tallyLine({ count: 3, amountUnits: null }, "₹")).toBe("3 payments · —");
    expect(paymentDetailsLine({ paymentDate: "2026-10-21", paymentMode: "upi", reference: " UTR-77 " })).toBe("21 Oct 2026 · UPI · UTR-77");
    expect(paymentDetailsLine({ paymentDate: "2026-10-05", paymentMode: "bank_transfer", reference: "" })).toBe("5 Oct 2026 · Bank Transfer");
  });
});
