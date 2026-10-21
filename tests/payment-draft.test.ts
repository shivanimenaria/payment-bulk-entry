import { describe, it, expect } from "vitest";
import {
  applyDraftRows,
  buildDraft,
  clearDraft,
  draftKey,
  parseDraft,
  saveDraft,
  takeDraft,
  type PaymentDraft,
} from "@/lib/payments/draft";
import type { AllocationRow, PaymentHeader } from "@/types/payments";
import type { VendorPaymentRequestConfigItem } from "@/types/rdash";

// Unsaved Create Payment state (form + table amounts / remarks + page)
// across a re-handover: saved before leaving, restored once into rows that
// still exist, then deleted.

const INR = { id: "cur-inr", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
function cfg(id: string, due: string): VendorPaymentRequestConfigItem {
  return { payment_request_id: id, status: "approved", request_amount: due, paid_amount: "0", payment_due: due, currency: INR, project_id: "p" };
}
function row(id: string, due = "100.0000", over: Partial<AllocationRow> = {}): AllocationRow {
  return {
    config: cfg(id, due),
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
const HEADER: PaymentHeader = {
  amountPaid: "150",
  paymentDate: "2026-10-15",
  paymentMode: "bank_transfer",
  reference: "UTR-9",
  remark: "Oct",
};
const EMPTY: PaymentHeader = { amountPaid: "", paymentDate: "", paymentMode: null, reference: "", remark: "" };

class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe("buildDraft", () => {
  it("keeps the form + rows with an amount or their own remark (by payment_request_id) + the page", () => {
    const d = buildDraft("v1", "INR", HEADER, [
      row("a", "100", { amount: "100", remark: "Oct" }),
      row("b", "100", { remark: "own", remarkOverridden: true }),
      row("c", "100", { remark: "Oct" }),
    ], 2)!;
    expect(d).toEqual({
      vendorId: "v1",
      currency: "INR",
      header: HEADER,
      rows: [
        { payment_request_id: "a", amount: "100", remark: "Oct", remarkOverridden: false },
        { payment_request_id: "b", amount: "", remark: "own", remarkOverridden: true },
      ],
      page: 2,
    });
  });

  it("form alone is kept (no amounts yet); round-trip through storage", () => {
    const d = buildDraft("v1", "INR", HEADER, [row("a")])!;
    expect(d).toEqual({ vendorId: "v1", currency: "INR", header: HEADER, rows: [], page: 1 });
    const s = new MemoryStorage();
    saveDraft(s, d);
    expect(takeDraft(s, "v1")).toEqual(d);
  });

  it("an invalid page falls back to 1; a stored invalid page is rejected", () => {
    expect(buildDraft("v1", "INR", HEADER, [], 0)!.page).toBe(1);
    expect(buildDraft("v1", "INR", HEADER, [], 2.5)!.page).toBe(1);
    expect(parseDraft({ vendorId: "v1", currency: "INR", header: HEADER, rows: [], page: 0 })).toBeNull();
  });

  it("older draft shapes (details / modalOpen, no page) are discarded", () => {
    expect(parseDraft({ vendorId: "v1", currency: "INR", details: HEADER, rows: [] })).toBeNull();
    expect(parseDraft({ vendorId: "v1", currency: "INR", header: HEADER, rows: [], modalOpen: true })).toBeNull();
  });

  it("nothing entered → null (nothing saved); no vendor → null", () => {
    expect(buildDraft("v1", "INR", EMPTY, [row("a")])).toBeNull();
    expect(buildDraft("", "INR", HEADER, [row("a", "100", { amount: "1" })])).toBeNull();
  });
});

describe("applyDraftRows", () => {
  const draft: PaymentDraft = {
    vendorId: "v1",
    currency: "INR",
    header: HEADER,
    rows: [
      { payment_request_id: "a", amount: "100", remark: "Oct", remarkOverridden: false },
      { payment_request_id: "b", amount: "50", remark: "own", remarkOverridden: true },
      { payment_request_id: "gone", amount: "999", remark: "x", remarkOverridden: true },
    ],
    page: 1,
  };

  it("restores only into rows that still exist; the header Remark goes to the rest", () => {
    const out = applyDraftRows([row("a"), row("b"), row("new")], draft);
    expect(out.map((r) => r.config.payment_request_id)).toEqual(["a", "b", "new"]);
    expect(out[0]).toMatchObject({ amount: "100", remark: "Oct", remarkOverridden: false });
    expect(out[1]).toMatchObject({ amount: "50", remark: "own", remarkOverridden: true });
    expect(out[2]).toMatchObject({ amount: "", remark: "Oct", remarkOverridden: false });
    expect(JSON.stringify(out)).not.toContain("999");
  });

  it("a row that is now locked keeps no restored amount", () => {
    const out = applyDraftRows([row("a", "100", { detailsError: "Could not load details" })], draft);
    expect(out[0].amount).toBe("");
  });
});

describe("storage: save → take (deleted) → clear", () => {
  it("round-trips, deletes on take, only for the same vendor", () => {
    const s = new MemoryStorage();
    const d = buildDraft("v1", "INR", HEADER, [row("a", "100", { amount: "100" })])!;
    saveDraft(s, d);
    expect(takeDraft(s, "v2")).toBeNull();
    expect(takeDraft(s, "v1")).toEqual(d);
    expect(s.getItem(draftKey("v1"))).toBeNull();
    expect(takeDraft(s, "v1")).toBeNull();
  });

  it("clearDraft removes it (after a successful submit)", () => {
    const s = new MemoryStorage();
    saveDraft(s, buildDraft("v1", null, HEADER, [])!);
    clearDraft(s, "v1");
    expect(s.getItem(draftKey("v1"))).toBeNull();
  });

  it("malformed or tampered drafts are discarded (and deleted)", () => {
    const s = new MemoryStorage();
    s.setItem(draftKey("v1"), "{not json");
    expect(takeDraft(s, "v1")).toBeNull();
    s.setItem(draftKey("v1"), JSON.stringify({ vendorId: "v1", currency: "INR", header: { ...HEADER, paymentMode: "crypto" }, rows: [] }));
    expect(takeDraft(s, "v1")).toBeNull();
    expect(s.getItem(draftKey("v1"))).toBeNull();
    s.setItem(draftKey("v1"), JSON.stringify({ vendorId: "v2", currency: null, header: HEADER, rows: [] }));
    expect(takeDraft(s, "v1")).toBeNull();
  });

  it("storage that throws never breaks the page", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const orig = console.error;
    console.error = () => {};
    try {
      expect(() => saveDraft(broken, buildDraft("v1", null, HEADER, [])!)).not.toThrow();
      expect(takeDraft(broken, "v1")).toBeNull();
      expect(() => clearDraft(broken, "v1")).not.toThrow();
    } finally {
      console.error = orig;
    }
  });

  it("parseDraft accepts what buildDraft produces", () => {
    const d = buildDraft("v1", "INR", HEADER, [row("a", "100", { amount: "1" })])!;
    expect(parseDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
});
