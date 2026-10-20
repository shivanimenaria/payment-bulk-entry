import { describe, it, expect } from "vitest";
import { validateAllocation, validateSubmission, MESSAGES } from "@/lib/payments/validation";
import { computeTotals } from "@/lib/payments/totals";
import { applyHeaderRemark, setRowRemark } from "@/lib/payments/remarks";
import { buildBulkEntries, buildSubmitRequest } from "@/lib/payments/build-payload";
import { buildRetryEntries, buildRetryRequest, RetryMismatchError } from "@/lib/payments/retry";
import { userUnits, unitsToDecimalString } from "@/lib/payments/money";

/** Exact money units (0.0001) — BigInt literals need an ES2020 target. */
const U = (v: string | number) => BigInt(v);
import type { AllocationRow, PaymentHeader, BulkSubmitResult } from "@/types/payments";
import type { VendorPaymentRequestConfigItem } from "@/types/rdash";

const INR = { id: "cur-inr", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
/** rDash-shaped config item: amounts as 4-decimal strings, like the real API. */
const dec4 = (n: number | string) => (typeof n === "string" ? n : (Math.round(n * 100) / 100).toFixed(4));
function cfg(id: string, due: number | string): VendorPaymentRequestConfigItem {
  return { payment_request_id: id, status: "approved", request_amount: dec4(due), paid_amount: "0", payment_due: dec4(due), currency: INR, project_id: "p" };
}

function row(id: string, due: number | string, amount = "", over: Partial<AllocationRow> = {}): AllocationRow {
  return {
    config: cfg(id, due),
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
    ...over,
  };
}

const header = (amountPaid: string, over: Partial<PaymentHeader> = {}): PaymentHeader => ({
  amountPaid,
  paymentDate: "2026-10-15",
  paymentMode: "cheque",
  reference: "CHQ-001",
  remark: "Oct",
  ...over,
});

describe("money", () => {
  it("parses user amounts into exact units (0.0001), rejects the rest", () => {
    expect(userUnits("1200")).toBe(U(12000000));
    expect(userUnits("0.1")).toBe(U(1000));
    expect(userUnits(0.29)).toBe(U(2900));
    expect(userUnits("1.005")).toBe(U(10050));
    expect(userUnits("1.12345")).toBeNull();
    expect(userUnits("-1")).toBeNull();
    expect(userUnits("1e3")).toBeNull();
    expect(userUnits(0.1 + 0.2)).toBeNull(); // float drift is never silently rounded
    expect([5, 50, 100, 12005000].map((n) => unitsToDecimalString(U(n)))).toEqual(["0.0005", "0.005", "0.01", "1200.5"]);
  });
});

describe("totals (exact units)", () => {
  it("totalDue, allocated, excess, selectedCount", () => {
    const rows = [row("a", 100.1), row("b", 200.2, "0.1"), row("c", 50, "0.2"), row("d", 10, "")];
    const t = computeTotals("0.3", rows);
    expect(t.totalDueUnits).toBe(U(3603000));
    expect(t.allocatedUnits).toBe(U(3000)); // 0.1 + 0.2 === 0.3 exactly
    expect(t.excessUnits).toBe(U(0));
    expect(t.selectedCount).toBe(2);
    expect(t.hasInvalidAmount).toBe(false);
  });

  it("malformed amount is flagged and excluded; invalid Amount Paid → excess null", () => {
    const t = computeTotals("abc", [row("a", 10, "1.23456"), row("b", 10, "2")]);
    expect(t).toMatchObject({ allocatedUnits: U(20000), hasInvalidAmount: true, amountPaidUnits: null, excessUnits: null });
  });
});

describe("validateAllocation (client)", () => {
  it("valid allocation → ok, only rows with amount > 0, summary empty", () => {
    const r = validateAllocation(header("150.50"), [row("a", 100, "100"), row("b", 80, "50.5"), row("c", 30, "")]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toEqual([]);
    expect(r.value.rows.map((x) => [x.payment_request_id, x.amountUnits])).toEqual([["a", U(1000000)], ["b", U(505000)]]);
  });

  it("overpay → row error + summary line", () => {
    const r = validateAllocation(header("100.01"), [row("a", 100, "100.01")]);
    expect(r.ok).toBe(false);
    expect(r.errors.rows[0]).toEqual({ amount: MESSAGES.amountOverDue });
    expect(r.summary).toContain(`Row 1: ${MESSAGES.amountOverDue}`);
  });

  it("excess ≠ 0 → form error (both directions)", () => {
    for (const paid of ["99.99", "100.01"]) {
      const r = validateAllocation(header(paid), [row("a", 200, "100")]);
      expect(r.ok).toBe(false);
      expect(r.errors.form).toEqual([MESSAGES.excess]);
    }
  });

  it("zero selection → form error", () => {
    const r = validateAllocation(header("10"), [row("a", 100, ""), row("b", 100, "0")]);
    expect(r.errors.form).toEqual([MESSAGES.noSelection]);
  });

  it("more than 4 decimals / negative → row error (submit limit message)", () => {
    const r = validateAllocation(header("1"), [row("a", 100, "1.00005"), row("b", 100, "-1")]);
    expect(r.errors.rows[0].amount).toBe(MESSAGES.amountLimit);
    expect(r.errors.rows[1].amount).toBe(MESSAGES.amountLimit);
  });

  it("detailsUnavailable / detailsError rows cannot take an amount; at 0 they're fine", () => {
    const r = validateAllocation(header("30"), [
      row("a", 100, "10", { detailsUnavailable: true }),
      row("b", 100, "20", { detailsError: "Details could not be loaded" }),
      row("c", 100, "", { detailsUnavailable: true }),
    ]);
    expect(r.errors.rows).toEqual({ 0: { amount: MESSAGES.detailsUnavailable }, 1: { amount: MESSAGES.detailsError } });
  });

  it("a failed (rowError) row keeps its amount and still validates — needed for Retry failed", () => {
    const r = validateAllocation(header("10"), [row("a", 100, "10", { rowStatus: "failed", rowError: "Rejected" })]);
    expect(r.ok).toBe(true);
  });

  it("header: amountPaid > 0, date and mode required", () => {
    const r = validateAllocation(header("0", { paymentDate: "", paymentMode: null }), [row("a", 10, "1")]);
    expect(Object.keys(r.errors.header).sort()).toEqual(["amountPaid", "paymentDate", "paymentMode"]);
    expect(r.summary).toContain(`Payment mode: ${MESSAGES.paymentMode}`);
  });
});

describe("remarks", () => {
  it("header remark copies to non-overridden rows only", () => {
    const rows = [row("a", 1), row("b", 1, "", { remark: "mine", remarkOverridden: true })];
    const out = applyHeaderRemark(rows, "Header");
    expect(out.map((r) => r.remark)).toEqual(["Header", "mine"]);
    expect(rows[0].remark).toBe(""); // immutable
  });

  it("row override survives later header changes", () => {
    let rows = applyHeaderRemark([row("a", 1), row("b", 1)], "H1");
    rows = [setRowRemark(rows[0], "Row A"), rows[1]];
    rows = applyHeaderRemark(rows, "H2");
    expect(rows.map((r) => r.remark)).toEqual(["Row A", "H2"]);
  });

  it("an emptied override stays empty (no remark) and ends up null in the entry", () => {
    let rows = applyHeaderRemark([row("a", 100, "10")], "H1");
    rows = [setRowRemark(rows[0], "")];
    rows = applyHeaderRemark(rows, "H2");
    expect(rows[0]).toMatchObject({ remark: "", remarkOverridden: true });
    const r = validateAllocation(header("10"), rows);
    if (!r.ok) throw new Error("expected ok");
    expect(buildBulkEntries(r.value)[0].remark).toBeNull();
  });
});

describe("build-payload", () => {
  it("valid payload: amount > 0 rows only, header fields copied, proof null, no other defaults", () => {
    const rows = [
      row("a", 100, "100", { remark: "  first  " }),
      row("b", 100, ""),
      row("c", 100, "0.5", { remark: "" }),
    ];
    const r = validateAllocation(header("100.5", { reference: "   " }), rows);
    if (!r.ok) throw new Error(r.summary.join("; "));
    expect(buildBulkEntries(r.value)).toEqual([
      { payment_request_id: "a", amount: 100, payment_mode: "cheque", payment_date: "2026-10-15", transaction_id: null, transaction_proof_file_url: null, transaction_proof_file_name: null, remark: "first" },
      { payment_request_id: "c", amount: 0.5, payment_mode: "cheque", payment_date: "2026-10-15", transaction_id: null, transaction_proof_file_url: null, transaction_proof_file_name: null, remark: null },
    ]);
  });

  it("client and server share the rules: the client's request passes server validation and yields the same entries", () => {
    const rows = [row("a", 100, "99.99", { remark: "x" }), row("b", 50.5, "50.5")];
    const client = validateAllocation(header("150.49"), rows);
    if (!client.ok) throw new Error(client.summary.join("; "));
    const request = buildSubmitRequest(header("150.49"), client.value);
    const server = validateSubmission(request, rows.map((r) => r.config));
    if (!server.ok) throw new Error(server.summary.join("; "));
    expect(buildBulkEntries(server.value)).toEqual(buildBulkEntries(client.value));
  });
});

describe("retry", () => {
  const previous = {
    header: header("150"),
    rows: [
      { payment_request_id: "a", amount: "100", remark: null },
      { payment_request_id: "b", amount: "30.25", remark: "r" },
      { payment_request_id: "c", amount: "19.75", remark: null },
    ],
  };
  const result: BulkSubmitResult = {
    count: 1,
    created: [{ id: "e1", payment_request_id: "a" }],
    failed: [
      { payment_request_id: "b", error: "x" },
      { payment_request_id: "c", error: "y" },
    ],
    recordedAmount: "100",
    notRecordedAmount: "50",
  };

  it("retries only ids in failed[]; Amount Paid = not-recorded amount", () => {
    const req = buildRetryRequest(result, previous);
    expect(req.rows.map((r) => r.payment_request_id)).toEqual(["b", "c"]);
    expect(req.header.amountPaid).toBe("50");
    expect(req.header.paymentMode).toBe("cheque");
  });

  it("never resends ids missing from both created and failed", () => {
    const partial: BulkSubmitResult = { ...result, failed: [{ payment_request_id: "b", error: "x" }] }; // "c" in neither
    const entries = buildRetryEntries(
      partial,
      previous.rows.map((r) => ({
        payment_request_id: r.payment_request_id,
        amount: Number(r.amount),
        payment_mode: "cheque" as const,
        payment_date: "2026-10-15",
        transaction_id: null,
        transaction_proof_file_url: null,
        transaction_proof_file_name: null,
        remark: r.remark,
      })),
    );
    expect(entries.map((e) => e.payment_request_id)).toEqual(["b"]);
    expect(buildRetryRequest(partial, previous).rows.map((r) => r.payment_request_id)).toEqual(["b"]);
  });

  it("a failed id that wasn't submitted → RetryMismatchError", () => {
    expect(() =>
      buildRetryRequest({ ...result, failed: [{ payment_request_id: "zzz", error: "x" }] }, previous),
    ).toThrow(RetryMismatchError);
  });

  it("the retry request passes server validation against the refreshed due", () => {
    const req = buildRetryRequest(result, previous);
    const server = validateSubmission(req, [cfg("b", 30.25), cfg("c", 19.75)]);
    expect(server.ok).toBe(true);
  });
});

describe("allocation actions", () => {
  // Imported lazily to keep this block self-contained.
  it("Pay in full sets the exact due; Clear resets editable rows; locked rows untouched", async () => {
    const { payInFull, clearAppliedAmounts, isAmountEditable, setRowAmount } = await import("@/lib/payments/allocation");
    expect(payInFull(row("a", 45000.5)).amount).toBe("45000.5");
    const pending = row("b", 100, "", { detailsUnavailable: true });
    const failedDetails = row("c", 100, "", { detailsError: "x" });
    const failedBulk = row("d", 100, "40", { rowStatus: "failed", rowError: "Rejected" });
    for (const r of [pending, failedDetails, failedBulk]) {
      expect(isAmountEditable(r)).toBe(false);
      expect(payInFull(r)).toBe(r);
      expect(setRowAmount(r, "5")).toBe(r);
    }
    const cleared = clearAppliedAmounts([row("e", 10, "10"), failedBulk]);
    expect(cleared.map((r) => r.amount)).toEqual(["", "40"]);
  });
});

describe("format", () => {
  it("Indian grouping, dd/mm/yyyy, dashes for null", async () => {
    const { formatRdashAmount, formatMoneyUnits, formatDate, textOrDash } = await import("@/lib/format");
    expect(formatRdashAmount("12345678.5")).toBe("1,23,45,678.50");
    expect(formatMoneyUnits(U(2000000000), "₹")).toBe("₹2,00,000.00");
    expect(formatMoneyUnits(null, "₹")).toBe("—");
    expect(formatDate("2026-09-03")).toBe("03/09/2026");
    expect(formatDate("2026-08-04T20:00:00Z")).toBe("05/08/2026"); // IST
    expect(formatDate(null)).toBe("—");
    expect(textOrDash("")).toBe("—");
    const { formatCardUnits } = await import("@/lib/format");
    expect(formatCardUnits(U(2000000000), "₹")).toBe("₹ 2,00,000");
    expect(formatCardUnits(U(299995000), "₹")).toBe("₹ 29,999.50");
    expect(formatCardUnits(U(-700000000), "₹")).toBe("₹ -70,000");
    expect(formatCardUnits(null, "₹")).toBe("—");
  });
});

describe("submit flow helpers", () => {
  it("merge after partial failure: created cleared, failed keep amount+remark+error, others keep edits, paid-off rows drop", async () => {
    const { mergeRowsAfterSubmit } = await import("@/lib/payments/submit");
    const prev = [
      row("a", 100, "100", { remark: "ra", remarkOverridden: true }),
      row("b", 50, "50", { remark: "H" }),
      row("c", 70, "20", { remark: "rc", remarkOverridden: true }),
      row("d", 10, "", { remark: "H" }),
    ];
    const fresh = [row("b", 50), row("c", 50), row("d", 10)]; // "a" paid off → hidden
    const result: BulkSubmitResult = {
      count: 2,
      created: [{ id: "e1", payment_request_id: "a" }, { id: "e2", payment_request_id: "c" }],
      failed: [{ payment_request_id: "b", error: "Rejected" }],
      recordedAmount: "120",
      notRecordedAmount: "50",
    };
    const out = mergeRowsAfterSubmit(prev, fresh, result);
    expect(out.map((r) => r.config.payment_request_id)).toEqual(["b", "c", "d"]);
    expect(out[0]).toMatchObject({ amount: "50", remark: "H", rowStatus: "failed", rowError: "Rejected" });
    expect(out[1]).toMatchObject({ amount: "", remark: "rc", remarkOverridden: true, rowStatus: "created", rowError: null });
    expect(out[1].config.payment_due).toBe("50.0000"); // fresh due (rDash decimal string)
    expect(out[2]).toMatchObject({ amount: "", remark: "H", rowStatus: "idle" });
  });

  it("merge with no result (rejected) keeps every row's state", async () => {
    const { mergeRowsAfterSubmit } = await import("@/lib/payments/submit");
    const prev = [row("a", 100, "120", { remark: "x", remarkOverridden: true })];
    expect(mergeRowsAfterSubmit(prev, [row("a", 100)], null)[0]).toMatchObject({ amount: "120", remark: "x", remarkOverridden: true });
  });

  it("server 400 row errors map from sent index to table index", async () => {
    const { mapServerRowErrors } = await import("@/lib/payments/submit");
    const rows = [row("a", 1), row("b", 1), row("c", 1)];
    const request = { header: header("2"), rows: [{ payment_request_id: "c", amount: "1", remark: null }, { payment_request_id: "a", amount: "1", remark: null }] };
    const mapped = mapServerRowErrors(request, { form: [], header: {}, rows: { 0: { amount: "Amount is more than the payment due" } } }, rows);
    expect(mapped).toEqual({ 2: "Amount is more than the payment due" });
  });

  it("shape guards", async () => {
    const { isBulkSubmitResult, isValidationRejection } = await import("@/lib/payments/submit");
    expect(isBulkSubmitResult({ count: 0, created: [], failed: [], recordedAmount: "0", notRecordedAmount: "0" })).toBe(true);
    expect(isBulkSubmitResult({ count: 0, created: [], failed: [], recordedAmount: 0, notRecordedAmount: 0 })).toBe(false);
    expect(isBulkSubmitResult({ created: [], failed: [] })).toBe(false);
    expect(isValidationRejection({ error: "x", fieldErrors: { form: [], header: {}, rows: {} }, summary: [] })).toBe(true);
    expect(isValidationRejection({ error: "x" })).toBe(false);
  });
});

describe("Remove a failed row", () => {
  it("dismissFailedRow: clears amount + rowError, unlocks, keeps remark; non-failed rows untouched", async () => {
    const { dismissFailedRow, isAmountEditable } = await import("@/lib/payments/allocation");
    const failed = row("a", 100, "40", { rowStatus: "failed", rowError: "Rejected", remark: "keep me", remarkOverridden: true });
    expect(isAmountEditable(failed)).toBe(false);
    const out = dismissFailedRow(failed);
    expect(out).toMatchObject({ amount: "", rowError: null, rowStatus: "idle", remark: "keep me", remarkOverridden: true });
    expect(isAmountEditable(out)).toBe(true);
    const ok = row("b", 100, "10");
    expect(dismissFailedRow(ok)).toBe(ok);
  });

  it("removeFailedId: Retry failed no longer includes the removed id; Amount paid follows what's left", async () => {
    const { removeFailedId, retryAmountPaid } = await import("@/lib/payments/retry");
    const previous = {
      header: header("85"),
      rows: [
        { payment_request_id: "a", amount: "40", remark: null },
        { payment_request_id: "b", amount: "45", remark: null },
      ],
    };
    const result: BulkSubmitResult = {
      count: 0,
      created: [],
      failed: [{ payment_request_id: "a", error: "x" }, { payment_request_id: "b", error: "y" }],
      recordedAmount: "0",
      notRecordedAmount: "85",
    };
    const afterA = removeFailedId(result, "a");
    expect(buildRetryRequest(afterA, previous).rows.map((r) => r.payment_request_id)).toEqual(["b"]);
    expect(retryAmountPaid(afterA, previous)).toBe("45");
    expect(afterA.notRecordedAmount).toBe("85"); // reported outcome unchanged
    const none = removeFailedId(afterA, "b");
    expect(buildRetryRequest(none, previous).rows).toEqual([]);
    expect(retryAmountPaid(none, previous)).toBe("");
  });
});

describe("payable rule (lib/payments/payable.ts)", () => {
  it("exact lowercase statuses only; missing / other / differently-cased → not payable", async () => {
    const { PAYABLE_STATUSES, isPayableStatus, isPayable } = await import("@/lib/payments/payable");
    expect([...PAYABLE_STATUSES]).toEqual(["pending", "approved", "submitted"]);
    for (const s of ["pending", "approved", "submitted"]) expect(isPayableStatus(s)).toBe(true);
    for (const s of ["rejected", "cancelled", "hold", "paid", "partially_paid", "Approved", " approved", "", null, undefined, 1]) {
      expect(isPayableStatus(s)).toBe(false);
    }
    expect(isPayable({ status: "approved", payment_due: "0.0100" })).toBe(true);
    expect(isPayable({ status: "approved", payment_due: "0" })).toBe(false);
    expect(isPayable({ status: "approved", payment_due: "0.0" })).toBe(false);
    expect(isPayable({ status: "hold", payment_due: "100.0000" })).toBe(false);
    // Unprocessable due is NOT silently dropped — shown with an error instead.
    expect(isPayable({ status: "approved", payment_due: "2000000000000000000000000000.0000" })).toBe(true);
    expect(isPayable({ status: "approved", payment_due: "12.3456" })).toBe(true);
  });

  it("client validation blocks an amount on a non-payable row (same shared rule)", () => {
    const r = validateAllocation(header("10"), [row("a", 100, "10", { config: { ...cfg("a", 100), status: "hold" } })]);
    expect(r.errors.rows[0].amount).toBe(MESSAGES.notPayableStatus);
  });
});

describe("rDash amounts (decimal strings)", () => {
  it("parses rDash amounts exactly up to DECIMAL(33,4); beyond → invalid", async () => {
    const { parseRdashAmount, rdashUnits, unitsToRdash } = await import("@/lib/payments/money");
    expect(rdashUnits("29500.0000")).toBe(U(295000000));
    expect(rdashUnits("0")).toBe(U(0));
    expect(rdashUnits("0.0")).toBe(U(0));
    expect(rdashUnits("12.3456")).toBe(U(123456));
    expect(rdashUnits("12.345600")).toBe(U(123456)); // extra zero decimals tolerated
    expect(rdashUnits(29500)).toBe(U(295000000)); // JSON numbers still accepted (details may use them)
    const max29 = `${"9".repeat(29)}.9999`;
    expect(rdashUnits(max29)).toBe(BigInt("9".repeat(33)));
    for (const bad of ["12.34567", "abc", "-1", "1e3", "", " ", null, undefined, {}, 0.1 + 0.2, -5, `1${"0".repeat(29)}`]) {
      expect(parseRdashAmount(bad)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(unitsToRdash(U(299995000))).toBe("29999.5000");
  });

  it("formats on the digits (no float): Indian grouping, never rounds sub-paisa", async () => {
    const { formatRdashAmount } = await import("@/lib/format");
    expect(formatRdashAmount("29500.0000")).toBe("29,500.00");
    expect(formatRdashAmount("0")).toBe("0.00");
    expect(formatRdashAmount("12.3456")).toBe("12.3456");
    expect(formatRdashAmount("12.3400")).toBe("12.34");
    expect(formatRdashAmount("12.3450")).toBe("12.345");
    expect(formatRdashAmount("12.34567")).toBe("12.34567"); // invalid → raw text, never rounded
    expect(formatRdashAmount("2000000000000000000000000000.0000")).toBe("2,00,00,00,00,00,00,00,00,00,00,00,00,000.00");
    expect(formatRdashAmount(null)).toBe("—");
  });

  it("a row whose due exceeds the submit limit: shown, counted in Total Due, Pay in Full disabled", async () => {
    const { rowAmountIssue, isAmountEditable, payInFull } = await import("@/lib/payments/allocation");
    const huge = "2000000000000000000000000000.0000";
    const big = row("big", 0, "", { config: { ...cfg("big", huge), request_amount: huge } });
    const normal = row("ok", 100, "100");
    expect(rowAmountIssue(big)).toBe("Payment due exceeds the bulk API limit");
    expect(isAmountEditable(big)).toBe(false);
    expect(payInFull(big)).toBe(big);
    const t = computeTotals("100", [big, normal]);
    expect(t.totalDueUnits).toBe(BigInt("20000000000000000000000000000000") + U(1000000));
    expect(t).toMatchObject({ allocatedUnits: U(1000000), excessUnits: U(0), hasInvalidAmount: false });
    // Client: an amount forced onto the row is still rejected.
    const forced = validateAllocation(header("1"), [{ ...big, amount: "1" }]);
    expect(forced.errors.rows[0].amount).toBe("Payment due exceeds the bulk API limit");
    // Server: fresh config with the huge due → 400 field error.
    const server = validateSubmission(
      { header: header("1"), rows: [{ payment_request_id: "big", amount: "1", remark: null }] },
      [big.config],
    );
    expect(server.ok).toBe(false);
    expect(JSON.stringify(server.errors.rows[0])).toContain("Payment due exceeds the bulk API limit");
  });

  it("a due exactly at the submit limit can be paid in full", async () => {
    const { rowAmountIssue, payInFull } = await import("@/lib/payments/allocation");
    const max = "99999999999999999999.9999";
    const r = row("m", 0, "", { config: { ...cfg("m", max), request_amount: max } });
    expect(rowAmountIssue(r)).toBeNull();
    expect(payInFull(r).amount).toBe(max);
  });

  it("an invalid rDash due (5 decimals / 30 digits) is shown with an error, never rounded", async () => {
    const { rowAmountIssue } = await import("@/lib/payments/allocation");
    expect(rowAmountIssue(row("x", 0, "", { config: { ...cfg("x", "12.34567") } }))).toBe("Invalid amount from rDash");
    const d30 = `1${"0".repeat(29)}`;
    expect(rowAmountIssue(row("y", 0, "", { config: { ...cfg("y", d30), request_amount: d30 } }))).toBe("Invalid amount from rDash");
  });

  it("bulk entry amount is an exact JSON number", () => {
    const r = validateAllocation(header("29500.5"), [row("a", "29500.5000", "29500.50")]);
    if (!r.ok) throw new Error(r.summary.join("; "));
    const [e] = buildBulkEntries(r.value);
    expect(e.amount).toBe(29500.5);
    expect(typeof e.amount).toBe("number");
  });
});

describe("amount limits (bulk API: 20 integer digits, 4 decimals)", () => {
  const LIMIT = "Max amount is 99,999,999,999,999,999,999.9999 (20 digits, 4 decimals)";
  const ACCEPT = ["1", "1.5", "1.1234", "12345678901234567890.1234", "99999999999999999999.9999"];
  const REJECT = ["100000000000000000000", "1.12345", "-1", "1e5", "abc", "1.2.3", " 1 2"];
  const BIG = "99999999999999999999.9999"; // due = the submit limit (payable in full)

  it("limit constants", async () => {
    const m = await import("@/lib/payments/money");
    expect([m.MAX_RDASH_INT_DIGITS, m.MAX_SUBMIT_INT_DIGITS, m.MAX_DECIMALS]).toEqual([29, 20, 4]);
    expect(m.SUBMIT_LIMIT_MESSAGE).toBe(LIMIT);
    expect(MESSAGES.amountLimit).toBe(LIMIT);
  });

  it("userUnits accepts / rejects the listed values", () => {
    for (const a of ACCEPT) expect(userUnits(a), a).not.toBeNull();
    for (const b of REJECT) expect(userUnits(b), b).toBeNull();
    expect(userUnits("99999999999999999999.9999")).toBe(BigInt("999999999999999999999999"));
  });

  it("input guard blocks typing beyond 20 integer digits / 4 decimals", async () => {
    const { isAllowedAmountInput } = await import("@/lib/payments/money");
    for (const ok of ["", "1", "1.", "1.1234", "9".repeat(20), `${"9".repeat(20)}.9999`]) expect(isAllowedAmountInput(ok), ok).toBe(true);
    for (const no of ["9".repeat(21), "1.12345", "-1", "1e5", "a", "1.2.3"]) expect(isAllowedAmountInput(no), no).toBe(false);
  });

  it("client: Amount Paid and row amounts outside the limit → the limit message", () => {
    for (const b of REJECT) {
      const head = validateAllocation(header(b), [row("a", BIG, "1")]);
      expect(head.errors.header.amountPaid, b).toBe(LIMIT);
      const rowR = validateAllocation(header("1"), [row("a", BIG, b)]);
      expect(rowR.errors.rows[0]?.amount, b).toBe(LIMIT);
    }
  });

  it("client + server accept the listed amounts (string payloads, so 16+ digits are fine)", () => {
    for (const a of ACCEPT) {
      const c = validateAllocation(header(a), [row("a", BIG, a)], { bulkAmountAsString: true });
      expect(c.ok, a).toBe(true);
      const sv = validateSubmission({ header: header(a), rows: [{ payment_request_id: "a", amount: a, remark: null }] }, [cfg("a", BIG)], {
        bulkAmountAsString: true,
      });
      expect(sv.ok, a).toBe(true);
    }
  });

  it("server rejects every listed bad amount with the limit message", () => {
    for (const b of REJECT) {
      const sv = validateSubmission({ header: header("1"), rows: [{ payment_request_id: "a", amount: b, remark: null }] }, [cfg("a", BIG)]);
      expect(sv.ok, b).toBe(false);
      expect(JSON.stringify(sv.errors), b).toContain(LIMIT);
    }
  });

  it("exact sums: 0.0001 + 0.0002 = 0.0003; the max + 0.0001 is exact", () => {
    const t = computeTotals("0.0003", [row("a", 1, "0.0001"), row("b", 1, "0.0002")]);
    expect(t.allocatedUnits).toBe(U(3));
    expect(t.excessUnits).toBe(U(0));
    const big = computeTotals("1", [row("a", BIG, "99999999999999999999.9999"), row("b", BIG, "0.0001")]);
    expect(unitsToDecimalString(big.allocatedUnits)).toBe("100000000000000000000");
    expect(unitsToDecimalString(big.excessUnits!)).toBe("-99999999999999999999");
  });

  it("display: exact Indian grouping, 2 decimals unless 3rd/4th are non-zero", async () => {
    const { formatUnits } = await import("@/lib/payments/money");
    expect(formatUnits(BigInt("999999999999999999999999"))).toBe("9,99,99,99,99,99,99,99,99,999.9999");
    expect(formatUnits(U(15000))).toBe("1.50");
    expect(formatUnits(U(11234))).toBe("1.1234");
    expect(formatUnits(U(11230))).toBe("1.123");
  });
});

describe("bulk amount: JSON number vs exact string (BULK_AMOUNT_AS_STRING)", () => {
  it("default is false (TODO(verify) with rDash)", async () => {
    const { BULK_AMOUNT_AS_STRING } = await import("@/lib/payments/build-payload");
    expect(BULK_AMOUNT_AS_STRING).toBe(false);
  });

  it("false: ≤ 15 significant digits → exact number; 16+ → rejected, never rounded", async () => {
    const { bulkAmountValue, AMOUNT_NOT_EXACT_MESSAGE } = await import("@/lib/payments/build-payload");
    expect(bulkAmountValue(userUnits("123456789012345")!, false)).toBe(123456789012345);
    expect(bulkAmountValue(userUnits("12345678901.1234")!, false)).toBe(12345678901.1234);
    expect(bulkAmountValue(userUnits("1234567890123456")!, false)).toBeNull();
    expect(bulkAmountValue(userUnits("99999999999999999999.9999")!, false)).toBeNull();
    const big = "99999999999999999999.9999";
    const r = validateAllocation(header("1234567890123456"), [row("a", big, "1234567890123456")]);
    expect(r.ok).toBe(false);
    expect(r.errors.rows[0].amount).toBe(AMOUNT_NOT_EXACT_MESSAGE);
    const sv = validateSubmission(
      { header: header("1234567890123456"), rows: [{ payment_request_id: "a", amount: "1234567890123456", remark: null }] },
      [cfg("a", big)],
    );
    expect(sv.ok).toBe(false);
    expect(JSON.stringify(sv.errors)).toContain(AMOUNT_NOT_EXACT_MESSAGE);
  });

  it("true: the exact decimal string is sent", async () => {
    const { bulkAmountValue, buildBulkEntries } = await import("@/lib/payments/build-payload");
    expect(bulkAmountValue(userUnits("99999999999999999999.9999")!, true)).toBe("99999999999999999999.9999");
    const v = validateSubmission(
      { header: header("99999999999999999999.9999"), rows: [{ payment_request_id: "a", amount: "99999999999999999999.9999", remark: null }] },
      [cfg("a", "99999999999999999999.9999")],
      { bulkAmountAsString: true },
    );
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    expect(buildBulkEntries(v.value, true)[0].amount).toBe("99999999999999999999.9999");
  });
});

describe("currency filter rules (lib/payments/currency.ts)", () => {
  const cur = (code: string, name: string, symbol: string) => ({ id: `c-${code}`, name, symbol, code, locale: "en" });
  const inCur = (id: string, due: string, c: ReturnType<typeof cur>, amount = "") =>
    row(id, due, amount, { config: { ...cfg(id, due), currency: c } });
  const INR = cur("INR", "Indian National Rupee", "₹");
  const USD = cur("USD", "US Dollar", "$");
  const KWD = cur("KWD", "Kuwaiti Dinar", "KD");
  const UGX = cur("UGX", "Ugandan Shilling", "USh");

  it("one option per currency, labelled '<name> - <code>', sorted by name", async () => {
    const { listCurrencies, currencyLabel } = await import("@/lib/payments/currency");
    const rows = [inCur("a", "1", USD), inCur("b", "2", INR), inCur("c", "3", USD), inCur("d", "4", UGX), inCur("e", "5", KWD)];
    expect(listCurrencies(rows).map(currencyLabel)).toEqual([
      "Indian National Rupee - INR",
      "Kuwaiti Dinar - KWD",
      "Ugandan Shilling - UGX", // localeCompare: alphabetical, case-insensitive
      "US Dollar - USD",
    ]);
  });

  it("exactly one currency → auto-selected; several → none (no default/guess); a pick survives reloads", async () => {
    const { listCurrencies, resolveSelectedCurrency } = await import("@/lib/payments/currency");
    expect(resolveSelectedCurrency(listCurrencies([inCur("a", "1", INR), inCur("b", "2", INR)]), null)).toBe("INR");
    const multi = listCurrencies([inCur("a", "1", INR), inCur("b", "2", USD)]);
    expect(resolveSelectedCurrency(multi, null)).toBeNull();
    expect(resolveSelectedCurrency(multi, "USD")).toBe("USD");
    expect(resolveSelectedCurrency(multi, "KWD")).toBeNull(); // picked currency no longer present
    expect(resolveSelectedCurrency([], null)).toBeNull();
  });

  it("search filters options by name or code (case-insensitive)", async () => {
    const { listCurrencies, filterCurrencyOptions } = await import("@/lib/payments/currency");
    const opts = listCurrencies([inCur("a", "1", INR), inCur("b", "1", USD), inCur("c", "1", KWD), inCur("d", "1", UGX)]);
    expect(filterCurrencyOptions(opts, "dinar").map((o) => o.code)).toEqual(["KWD"]);
    expect(filterCurrencyOptions(opts, "us").map((o) => o.code)).toEqual(["USD"]);
    expect(filterCurrencyOptions(opts, "inr").map((o) => o.code)).toEqual(["INR"]);
    expect(filterCurrencyOptions(opts, "  ").map((o) => o.code)).toHaveLength(4);
    expect(filterCurrencyOptions(opts, "zzz")).toEqual([]);
  });

  it("filtering: rows and totals only for the selected currency; nothing selected → no rows", async () => {
    const { rowsForCurrency, rowsWithoutCurrency } = await import("@/lib/payments/currency");
    const rows = [inCur("a", "100.0000", INR, "40"), inCur("b", "50.0000", USD, "50"), inCur("c", "60.0000", INR)];
    const inr = rowsForCurrency(rows, "INR");
    expect(inr.map((r) => r.config.payment_request_id)).toEqual(["a", "c"]);
    expect(computeTotals("40", inr)).toMatchObject({ totalDueUnits: U(1600000), allocatedUnits: U(400000), excessUnits: U(0), selectedCount: 1 });
    expect(rowsForCurrency(rows, null)).toEqual([]);
    const noCode = row("x", "1", "", { config: { ...cfg("x", "1"), currency: { ...INR, code: "" } } });
    expect(rowsWithoutCurrency([...rows, noCode])).toBe(1);
  });

  it("server: rows in different currencies (fresh config) → 400 'All payments must be in the same currency'", () => {
    const a = { ...cfg("a", "100"), currency: INR };
    const b = { ...cfg("b", "50"), currency: USD };
    const r = validateSubmission(
      {
        header: header("150"),
        rows: [
          { payment_request_id: "a", amount: "100", remark: null },
          { payment_request_id: "b", amount: "50", remark: null },
        ],
      },
      [a, b],
    );
    expect(r.ok).toBe(false);
    expect(r.errors.form).toEqual(["All payments must be in the same currency"]);
    const same = validateSubmission(
      { header: header("150"), rows: [{ payment_request_id: "a", amount: "100", remark: null }, { payment_request_id: "c", amount: "50", remark: null }] },
      [a, { ...cfg("c", "50"), currency: INR }],
    );
    expect(same.ok).toBe(true);
  });
});

describe("display labels", () => {
  it("Request Type like rDash; other values → spaces + Title Case; '' → '—'", async () => {
    const { formatRequestType, textOrDash } = await import("@/lib/format");
    expect(formatRequestType("non_order")).toBe("Non Order");
    expect(formatRequestType("po_advance")).toBe("PO Advance");
    expect(formatRequestType("invoice")).toBe("Invoice");
    expect(formatRequestType("running_bill")).toBe("Running Bill");
    expect(formatRequestType("RETENTION_release")).toBe("Retention Release");
    expect(formatRequestType("Material Supply")).toBe("Material Supply");
    for (const v of ["", "   ", null, undefined]) expect(formatRequestType(v)).toBe("—");
    for (const v of ["", "  ", null, undefined]) expect(textOrDash(v)).toBe("—");
    expect(textOrDash("PR-1")).toBe("PR-1");
  });
});
