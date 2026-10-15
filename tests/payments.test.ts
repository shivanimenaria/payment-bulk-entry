import { describe, it, expect } from "vitest";
import { validateAllocation, validateSubmission, MESSAGES, toPaise } from "@/lib/payments/validation";
import { computeTotals } from "@/lib/payments/totals";
import { applyHeaderRemark, setRowRemark } from "@/lib/payments/remarks";
import { buildBulkEntries, buildSubmitRequest } from "@/lib/payments/build-payload";
import { buildRetryEntries, buildRetryRequest, RetryMismatchError } from "@/lib/payments/retry";
import { paiseToInput } from "@/lib/payments/money";
import type { AllocationRow, PaymentHeader, BulkSubmitResult } from "@/types/payments";
import type { VendorPaymentRequestConfigItem } from "@/types/rdash";

function cfg(id: string, due: number): VendorPaymentRequestConfigItem {
  return { payment_request_id: id, status: "approved", request_amount: due, paid_amount: 0, payment_due: due, currency: {}, project_id: "p" };
}

function row(id: string, due: number, amount = "", over: Partial<AllocationRow> = {}): AllocationRow {
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
  it("parses ≤ 2 decimals into integer paise, rejects the rest", () => {
    expect(toPaise("1200")).toBe(120000);
    expect(toPaise("0.1")).toBe(10);
    expect(toPaise(0.29)).toBe(29);
    expect(toPaise("1.005")).toBeNull();
    expect(toPaise("-1")).toBeNull();
    expect(toPaise("1e3")).toBeNull();
    expect(toPaise(0.1 + 0.2)).toBeNull(); // float drift is never silently rounded
    expect([5, 50, 100, 120050].map(paiseToInput)).toEqual(["0.05", "0.5", "1", "1200.5"]);
  });
});

describe("totals (paise-safe)", () => {
  it("totalDue, allocated, excess, selectedCount", () => {
    const rows = [row("a", 100.1), row("b", 200.2, "0.1"), row("c", 50, "0.2"), row("d", 10, "")];
    const t = computeTotals("0.3", rows);
    expect(t.totalDuePaise).toBe(36030);
    expect(t.allocatedPaise).toBe(30); // 0.1 + 0.2 === 0.3 exactly
    expect(t.excessPaise).toBe(0);
    expect(t.selectedCount).toBe(2);
    expect(t.hasInvalidAmount).toBe(false);
  });

  it("malformed amount is flagged and excluded; invalid Amount Paid → excess null", () => {
    const t = computeTotals("abc", [row("a", 10, "1.234"), row("b", 10, "2")]);
    expect(t).toMatchObject({ allocatedPaise: 200, hasInvalidAmount: true, amountPaidPaise: null, excessPaise: null });
  });
});

describe("validateAllocation (client)", () => {
  it("valid allocation → ok, only rows with amount > 0, summary empty", () => {
    const r = validateAllocation(header("150.50"), [row("a", 100, "100"), row("b", 80, "50.5"), row("c", 30, "")]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toEqual([]);
    expect(r.value.rows.map((x) => [x.payment_request_id, x.amountPaise])).toEqual([["a", 10000], ["b", 5050]]);
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

  it("more than 2 decimals / negative → row error", () => {
    const r = validateAllocation(header("1"), [row("a", 100, "1.005"), row("b", 100, "-1")]);
    expect(r.errors.rows[0].amount).toBe(MESSAGES.amountFormat);
    expect(r.errors.rows[1].amount).toBe(MESSAGES.amountFormat);
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
    recordedAmount: 100,
    notRecordedAmount: 50,
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
