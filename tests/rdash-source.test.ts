import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import Hashids from "hashids";
import { setAuthEnv, TEST_SALT } from "./helpers";
import { createMockSource, resetMockState, MockVendorNotFoundError } from "@/lib/server/rdash-source/mock";
import { createRealSource, buildBulkBody, BULK_BODY_WRAPPER, clearProjectsCache } from "@/lib/server/rdash-source/real";
import { loadAllocationRows, DETAILS_ERROR_MESSAGE } from "@/lib/server/rdash-source/allocation-rows";
import { getRdashSource } from "@/lib/server/rdash-source";
import type { RdashSource } from "@/lib/server/rdash-source/types";
import { AuthError } from "@/lib/server/auth";
import { RdashResponseShapeError, paginateRdash } from "@/lib/server/api";
import { isPayable } from "@/lib/payments/payable";
import projectsJson from "@/lib/server/rdash-source/mock-data/projects.json";
import configJson from "@/lib/server/rdash-source/mock-data/config.mock-vendor.json";
import detailsJson from "@/lib/server/rdash-source/mock-data/details.json";
import type { BulkPaymentEntryInput, VendorPaymentRequestConfigItem } from "@/types/rdash";
import { rdashPaise } from "@/lib/payments/money";
import realConfigPage from "./fixtures/real-config-page.json";

const API = "https://rdash-api.example.com";

// Exact Swagger key sets (CLAUDE.md "Response fields"). project_id is the one
// (now required) addition on config items.
const PROJECT_KEYS = ["created_at", "id", "is_archived", "is_deleted", "job_id", "name"];
const CONFIG_KEYS = ["currency", "paid_amount", "payment_due", "payment_request_id", "project_id", "request_amount", "status"];
const DETAILS_KEYS = [
  "attachments", "client", "due_date", "id", "invoice", "paid_till_date", "payment_due", "purchase_order",
  "remark", "request_amount_without_tax", "request_id", "request_number", "request_status", "request_type",
  "requested_at", "requested_by", "tax_amount", "total_request_amount", "vendor",
];

function entry(id: string, amount: number): BulkPaymentEntryInput {
  return {
    payment_request_id: id,
    amount,
    payment_mode: "bank_transfer",
    payment_date: "2026-10-15",
    transaction_id: "UTR123",
    transaction_proof_file_url: null,
    transaction_proof_file_name: null,
    remark: null,
  };
}

beforeAll(() => {
  setAuthEnv();
  process.env.RDASH_API_URL = API;
});

beforeEach(() => {
  resetMockState();
  clearProjectsCache();
  delete process.env.MOCK_FAIL_IDS;
  for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mock fixtures: strict Swagger shapes", () => {
  it("5 projects with exactly the Swagger keys", () => {
    expect(projectsJson).toHaveLength(5);
    for (const p of projectsJson) expect(Object.keys(p).sort()).toEqual(PROJECT_KEYS);
  });

  it("config: 9 requests across all 5 projects; 5 payable (30k/50k/40k/45k/35k = 200000) + 4 non-payable", () => {
    // Real shapes: DRF page, decimal-string amounts, currency object.
    expect(Object.keys(configJson).sort()).toEqual(["count", "next", "previous", "results"]);
    expect(configJson.next).toBeNull();
    expect(configJson.count).toBe(9);
    expect(configJson.results).toHaveLength(9);
    for (const c of configJson.results) {
      expect(Object.keys(c).sort()).toEqual(CONFIG_KEYS);
      for (const a of [c.request_amount, c.paid_amount, c.payment_due]) expect(typeof a).toBe("string");
      expect(rdashPaise(c.request_amount)).toBe(rdashPaise(c.paid_amount)! + rdashPaise(c.payment_due)!);
      expect(Object.keys(c.currency).sort()).toEqual(["code", "id", "locale", "name", "symbol"]);
    }
    // Only real rDash PAYMENT_REQUEST_STATUS values.
    for (const c of configJson.results) {
      expect(["pending", "approved", "rejected", "cancelled", "hold", "submitted"]).toContain(c.status);
    }
    const payable = configJson.results.filter(isPayable);
    expect(payable.map((c) => [c.payment_request_id, c.status, c.payment_due])).toEqual([
      ["mock-pr-101", "approved", "30000.0000"],
      ["mock-pr-102", "pending", "50000.0000"],
      ["mock-pr-103", "approved", "40000.0000"],
      ["mock-pr-104", "submitted", "45000.0000"],
      ["mock-pr-105", "approved", "35000.0000"],
    ]);
    expect(payable.reduce((a, c) => a + rdashPaise(c.payment_due)!, 0)).toBe(20000000);
    expect(configJson.results.filter((c) => !isPayable(c)).map((c) => [c.status, c.payment_due])).toEqual([
      ["approved", "0"],
      ["rejected", "20000.0000"],
      ["cancelled", "15000.0000"],
      ["hold", "25000.0000"],
    ]);
    expect(new Set(configJson.results.map((c) => c.project_id))).toEqual(new Set(projectsJson.map((p) => p.id)));
  });

  it("details: one per request, Swagger keys, amounts match config, some null number/due date", () => {
    expect(detailsJson).toHaveLength(9);
    for (const d of detailsJson) {
      expect(Object.keys(d).sort()).toEqual(DETAILS_KEYS);
      const c = configJson.results.find((x) => x.payment_request_id === d.id)!;
      expect(d.request_status).toBe(c.status);
      expect(d.payment_due).toBe(c.payment_due);
      expect(d.total_request_amount).toBe(c.request_amount);
      expect(rdashPaise(d.request_amount_without_tax)! + rdashPaise(d.tax_amount)!).toBe(rdashPaise(d.total_request_amount));
      // requested_by = { id, name } | null (corrected Swagger)
      expect(d.requested_by === null || Object.keys(d.requested_by).sort().join() === "id,name").toBe(true);
      for (const a of d.attachments) expect(Object.keys(a).sort()).toEqual(["file", "id", "name", "uploaded_at", "uploaded_by"]);
    }
    expect(detailsJson.some((d) => d.request_number === null)).toBe(true);
    expect(detailsJson.some((d) => d.due_date === null)).toBe(true);
  });
});

describe("mock source", () => {
  it("unknown vendor → error, never an empty list", async () => {
    await expect(createMockSource().listPaymentRequestConfig("other")).rejects.toBeInstanceOf(MockVendorNotFoundError);
  });

  it("details require the matching project", async () => {
    const src = createMockSource();
    await expect(src.getPaymentRequestDetails("mock-project-1", "mock-pr-101")).resolves.toMatchObject({ id: "mock-pr-101" });
    await expect(src.getPaymentRequestDetails("mock-project-2", "mock-pr-101")).rejects.toThrow();
  });

  it("bulk: amount > payment_due fails, valid entries succeed and reduce payment_due", async () => {
    const src = createMockSource();
    const res = await src.createBulkPaymentEntries([entry("mock-pr-101", 30000.01), entry("mock-pr-102", 20000.5)]);
    expect(res.count).toBe(1);
    expect(res.created).toEqual([{ id: expect.stringMatching(/^mock-entry-/), payment_request_id: "mock-pr-102" }]);
    expect(res.failed).toEqual([{ payment_request_id: "mock-pr-101", error: "Amount exceeds payment due" }]);
    const after = (await src.listPaymentRequestConfig("mock-vendor")).find((c) => c.payment_request_id === "mock-pr-102")!;
    // Written back in rDash's decimal-string form.
    expect(after.payment_due).toBe("29999.5000");
    expect(after.paid_amount).toBe("50000.5000");
  });

  it("two separate module instances share ONE store (next dev compiles each route separately)", async () => {
    vi.resetModules();
    const bulkRouteCopy = await import("@/lib/server/rdash-source/mock");
    vi.resetModules();
    const requestsRouteCopy = await import("@/lib/server/rdash-source/mock");
    expect(bulkRouteCopy).not.toBe(requestsRouteCopy); // genuinely different instances
    bulkRouteCopy.resetMockState();

    const res = await bulkRouteCopy
      .createMockSource()
      .createBulkPaymentEntries([entry("mock-pr-101", 30000), entry("mock-pr-103", 40000)]);
    expect(res.created).toHaveLength(2);

    const rows = await requestsRouteCopy.createMockSource().listPaymentRequestConfig("mock-vendor");
    const payable = rows.filter(isPayable);
    expect(payable.map((r) => r.payment_request_id)).toEqual(["mock-pr-102", "mock-pr-104", "mock-pr-105"]);
    expect(payable.reduce((t, r) => t + rdashPaise(r.payment_due)!, 0)).toBe(13000000);

    // Entry ids continue across instances (same store, not two counters).
    const next = await requestsRouteCopy.createMockSource().createBulkPaymentEntries([entry("mock-pr-102", 1)]);
    expect(next.created[0].id).toBe("mock-entry-3");
    requestsRouteCopy.resetMockState();
  });

  it("bulk: ids in MOCK_FAIL_IDS fail; unknown ids fail", async () => {
    process.env.MOCK_FAIL_IDS = " mock-pr-103 , mock-pr-104";
    const res = await createMockSource().createBulkPaymentEntries([
      entry("mock-pr-103", 100),
      entry("mock-pr-105", 100),
      entry("nope", 1),
    ]);
    expect(res.created.map((c) => c.payment_request_id)).toEqual(["mock-pr-105"]);
    expect(res.failed).toEqual([
      { payment_request_id: "mock-pr-103", error: "Forced failure (MOCK_FAIL_IDS)" },
      { payment_request_id: "nope", error: "Payment request not found" },
    ]);
  });
});

describe("loadAllocationRows", () => {
  function stubSource(config: VendorPaymentRequestConfigItem[], over: Partial<RdashSource> = {}) {
    const src: RdashSource = {
      listProjects: vi.fn(async () => [
        { id: "p1", job_id: "J1", name: "Project One", created_at: "", is_archived: false, is_deleted: false },
      ]),
      listPaymentRequestConfig: vi.fn(async () => config),
      getPaymentRequestDetails: vi.fn(async (_p: string, id: string) => ({ ...detailsJson[0], id })),
      createBulkPaymentEntries: vi.fn(),
      ...over,
    };
    return src;
  }
  // project_id is required by the corrected Swagger; omitting it here tests
  // the defensive runtime path (detailsUnavailable / temp id).
  const cfg = (id: string, project_id?: string): VendorPaymentRequestConfigItem =>
    ({
      payment_request_id: id,
      status: "approved",
      request_amount: "100.0000",
      paid_amount: "0",
      payment_due: "100.0000",
      currency: { id: "c", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" },
      ...(project_id ? { project_id } : {}),
    }) as VendorPaymentRequestConfigItem;

  describe("RDASH_TEMP_PROJECT_ID (TODO(remove-temp-project-id))", () => {
    afterEach(() => {
      delete process.env.RDASH_TEMP_PROJECT_ID;
      delete process.env.ALLOW_TEMP_PROJECT_ID;
    });

    it("config project_id wins; the temp id is ignored for that row", async () => {
      process.env.RDASH_TEMP_PROJECT_ID = "pTEMP";
      const src = stubSource([cfg("a", "p1")]);
      const [row] = await loadAllocationRows(src, "v");
      expect(src.getPaymentRequestDetails).toHaveBeenCalledWith("p1", "a");
      expect(src.getPaymentRequestDetails).not.toHaveBeenCalledWith("pTEMP", expect.anything());
      expect(row).toMatchObject({ projectIdSource: "config", projectName: "Project One", detailsUnavailable: false });
    });

    it("no project_id + temp id set → details via temp id, row marked temporary, config untouched", async () => {
      process.env.RDASH_TEMP_PROJECT_ID = "p1";
      const src = stubSource([cfg("a")]);
      const [row] = await loadAllocationRows(src, "v");
      expect(src.getPaymentRequestDetails).toHaveBeenCalledWith("p1", "a");
      expect(row).toMatchObject({
        projectIdSource: "temporary",
        projectName: "Project One",
        detailsUnavailable: false,
        detailsError: null,
      });
      expect(row.details?.id).toBe("a");
      expect(row.config.project_id).toBeUndefined();
    });

    it("temp id but the request is in another project → details fail → detailsError, row kept", async () => {
      process.env.RDASH_TEMP_PROJECT_ID = "p1";
      const src = stubSource([cfg("a"), cfg("b", "p1")], {
        getPaymentRequestDetails: vi.fn(async (_p: string, id: string) => {
          if (id === "a") throw new Error("404 not in project");
          return { ...detailsJson[0], id };
        }),
      });
      const rows = await loadAllocationRows(src, "v");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ projectIdSource: "temporary", details: null, detailsError: DETAILS_ERROR_MESSAGE });
    });

    it("neither project_id nor temp id → detailsUnavailable, no details call", async () => {
      const src = stubSource([cfg("a")]);
      const [row] = await loadAllocationRows(src, "v");
      expect(src.getPaymentRequestDetails).not.toHaveBeenCalled();
      expect(row).toMatchObject({ projectIdSource: null, detailsUnavailable: true, projectName: null });
    });

    it("invalid combination at request time fails closed (no details with an unapproved temp id)", async () => {
      process.env.RDASH_TEMP_PROJECT_ID = "p1";
      process.env.ALLOW_TEMP_PROJECT_ID = "yes";
      const src = stubSource([cfg("a")]);
      await expect(loadAllocationRows(src, "v")).rejects.toThrow(/ALLOW_TEMP_PROJECT_ID/);
      expect(src.getPaymentRequestDetails).not.toHaveBeenCalled();
    });
  });

  it("mock: all 9 rows with project names and details; nothing filtered unless the caller asks", async () => {
    const rows = await loadAllocationRows(createMockSource(), "mock-vendor");
    expect(rows).toHaveLength(9);
    for (const r of rows) {
      expect(r.detailsUnavailable).toBe(false);
      expect(r.details?.id).toBe(r.config.payment_request_id);
      expect(r.projectName).toBeTruthy();
      expect(r).toMatchObject({ amount: "", remark: "", remarkOverridden: false, rowStatus: "idle", rowError: null });
    }
  });

  it("no project_id → details NOT called, detailsUnavailable, no project guessed", async () => {
    const src = stubSource([cfg("a"), cfg("b", "p1")]);
    const rows = await loadAllocationRows(src, "v");
    expect(src.getPaymentRequestDetails).toHaveBeenCalledTimes(1);
    expect(src.getPaymentRequestDetails).toHaveBeenCalledWith("p1", "b");
    expect(rows[0]).toMatchObject({ detailsUnavailable: true, details: null, projectName: null, detailsError: null });
    expect(rows[1]).toMatchObject({ detailsUnavailable: false, projectName: "Project One" });
  });

  it("no row has project_id → projects not even fetched", async () => {
    const src = stubSource([cfg("a"), cfg("b")]);
    await loadAllocationRows(src, "v");
    expect(src.listProjects).not.toHaveBeenCalled();
    expect(src.getPaymentRequestDetails).not.toHaveBeenCalled();
  });

  it("details failure marks the row (generic message), never drops it", async () => {
    const src = stubSource([cfg("a", "p1"), cfg("b", "p1")], {
      getPaymentRequestDetails: vi.fn(async (_p: string, id: string) => {
        if (id === "a") throw new Error("upstream detail");
        return { ...detailsJson[0], id };
      }),
    });
    const rows = await loadAllocationRows(src, "v");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ details: null, detailsError: DETAILS_ERROR_MESSAGE, detailsUnavailable: false });
    expect(rows[1].detailsError).toBeNull();
  });

  it("AuthError from details propagates (session dead), not hidden in a row", async () => {
    const src = stubSource([cfg("a", "p1")], {
      getPaymentRequestDetails: vi.fn(async () => {
        throw new AuthError("Session expired");
      }),
    });
    await expect(loadAllocationRows(src, "v")).rejects.toBeInstanceOf(AuthError);
  });

  it("details run with at most 5 in flight", async () => {
    let inFlight = 0;
    let max = 0;
    const src = stubSource(
      Array.from({ length: 12 }, (_, i) => cfg(`r${i}`, "p1")),
      {
        getPaymentRequestDetails: vi.fn(async (_p: string, id: string) => {
          max = Math.max(max, ++inFlight);
          await new Promise((r) => setTimeout(r, 2));
          inFlight--;
          return { ...detailsJson[0], id };
        }),
      },
    );
    await loadAllocationRows(src, "v");
    expect(max).toBe(5);
  });
});

describe("real source", () => {
  const ok = (data: unknown) =>
    new Response(JSON.stringify({ success: true, code: 200, message: "", errors: null, data }), { status: 200 });
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  const INR = { id: "c", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
  const item = (i: number) => ({
    payment_request_id: `pr${i}`,
    project_id: "PJ1",
    status: "approved",
    request_amount: "1.0000",
    paid_amount: "0",
    payment_due: "1.0000",
    currency: INR,
  });
  const CONFIG = "/v2/vendor-payment-requests/config/";
  const drf = (count: number, results: unknown[], next: string | null) => ok({ count, next, previous: null, results });

  it("config: DRF pages — follows `next` exactly until null; total must equal count; vendor re-encoded", async () => {
    const enc33 = new Hashids(TEST_SALT, 16).encode(33);
    const nextUrl = (offset: number) => `${API}${CONFIG}?limit=2&offset=${offset}&vendor_id=${enc33}`;
    fetchMock
      .mockResolvedValueOnce(drf(5, [item(0), item(1)], nextUrl(2)))
      .mockResolvedValueOnce(drf(5, [item(2), item(3)], nextUrl(4)))
      .mockResolvedValueOnce(drf(5, [item(4)], null));
    const rows = await createRealSource("tok").listPaymentRequestConfig("33");
    expect(rows.map((r) => r.payment_request_id)).toEqual(["pr0", "pr1", "pr2", "pr3", "pr4"]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    const first = new URL(urls[0]);
    expect(first.pathname).toBe(CONFIG);
    expect(first.searchParams.get("vendor_id")).toBe(enc33);
    expect([first.searchParams.get("limit"), first.searchParams.get("offset")]).toEqual(["200", "0"]);
    expect(urls.slice(1)).toEqual([nextUrl(2), nextUrl(4)]); // `next` followed as given
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("config: the captured production page (tests/fixtures/real-config-page.json) is read via results/next", async () => {
    const saved = process.env.RDASH_API_URL;
    process.env.RDASH_API_URL = "https://api.rdash.io"; // fixture's `next` host
    try {
      const page1 = realConfigPage; // count 89, 1 result, next → offset=10
      const first = page1.data.results[0];
      // Serve the remaining 88 rows over further `next` pages (11 + 77).
      const rest = Array.from({ length: 88 }, (_, i) => ({ ...first, payment_request_id: `${first.payment_request_id}-${i}` }));
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
        .mockResolvedValueOnce(drf(89, rest.slice(0, 11), "https://api.rdash.io/v2/vendor-payment-requests/config/?limit=77&offset=12&vendor_id=x"))
        .mockResolvedValueOnce(drf(89, rest.slice(11), null));
      const rows = await createRealSource("tok").listPaymentRequestConfig("33");
      expect(rows).toHaveLength(89);
      expect(String(fetchMock.mock.calls[1][0])).toBe(new URL(page1.data.next as string).toString());
      const r = rows[0];
      expect(r).toMatchObject({ payment_request_id: "6MWy2q21ZJxj7aJY", project_id: "1o9M5v3NGWPbx2Q4", status: "approved" });
      expect(rdashPaise(r.payment_due)).toBe(2950000); // "29500.0000" → exact paise
      expect(rdashPaise(r.paid_amount)).toBe(0);
      expect(r.currency).toEqual({ id: "9ng3XGvlNqK8oJ4V", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" });
      expect(isPayable(r)).toBe(true);
    } finally {
      process.env.RDASH_API_URL = saved;
    }
  });

  it.each([
    ["old { count, data } shape", () => [ok({ count: 1, data: [item(0)] })]],
    ["missing count", () => [ok({ next: null, previous: null, results: [item(0)] })]],
    ["total ≠ count when next is null", () => [drf(3, [item(0)], null)]],
    ["count changes between pages", () => [drf(3, [item(0)], `${API}${CONFIG}?offset=1`), drf(4, [item(1)], null)]],
    ["empty page while next is set", () => [drf(3, [], `${API}${CONFIG}?offset=1`)]],
    ["next is not a URL", () => [drf(3, [item(0)], "not a url")]],
  ])("config: %s → RdashResponseShapeError (never a partial list)", async (_l, pages) => {
    for (const p of pages()) fetchMock.mockResolvedValueOnce(p);
    await expect(createRealSource("tok").listPaymentRequestConfig("33")).rejects.toBeInstanceOf(RdashResponseShapeError);
  });

  it("config: `next` on another origin or path is refused — the token is never sent there", async () => {
    for (const evil of ["https://evil.example.com/v2/vendor-payment-requests/config/?offset=1", `${API}/v2/other/?offset=1`]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(drf(2, [item(0)], evil));
      await expect(createRealSource("tok").listPaymentRequestConfig("33")).rejects.toBeInstanceOf(RdashResponseShapeError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("details: project and request ids go into the path unchanged", async () => {
    fetchMock.mockResolvedValue(ok({ ...detailsJson[0], id: "PRhash" }));
    const d = await createRealSource("tok").getPaymentRequestDetails("PJhash", "PRhash");
    expect(d.id).toBe("PRhash");
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe("/v2/projects/PJhash/vendor-payment-requests/PRhash");
  });

  it("bulk: POSTs the body built by BULK_BODY_WRAPPER", async () => {
    fetchMock.mockResolvedValue(ok({ count: 1, created: [{ id: "e1", payment_request_id: "pr1" }], failed: [] }));
    const entries = [entry("pr1", 10)];
    const out = await createRealSource("tok").createBulkPaymentEntries(entries);
    expect(out.created).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/v2/vendor-payment-requests/payment-entries/bulk/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(buildBulkBody(entries));
    expect(JSON.parse(init.body)).toEqual(BULK_BODY_WRAPPER === "entries" ? { entries } : { data: { entries } });
  });
});

describe("real source: project names with hashid ids", () => {
  const ok = (data: unknown) =>
    new Response(JSON.stringify({ success: true, code: 200, message: "", errors: null, data }), { status: 200 });

  it("config project_id and /v2/projects id stay in the same (hashid) form → projectName found", async () => {
    const h = new Hashids(TEST_SALT, 16);
    const P5 = h.encode(5);
    const P6 = h.encode(6);
    const PR = h.encode(901);
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/v2/vendor-payment-requests/config/") {
        return ok({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              payment_request_id: PR,
              status: "approved",
              request_amount: "10.0000",
              paid_amount: "0",
              payment_due: "10.0000",
              currency: { id: "c", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" },
              project_id: P5,
            },
          ],
        });
      }
      // Real /v2/projects shape: DRF, 2 pages — the needed project is on page 2.
      if (u.pathname === "/v2/projects") {
        if (u.searchParams.get("offset") === "0") {
          return ok({
            count: 2,
            next: `${API}/v2/projects?limit=1&offset=1`,
            previous: null,
            results: [{ id: P6, job_id: "J6", name: "Other Project", created_at: "", is_archived: false, is_deleted: false }],
          });
        }
        return ok({
          count: 2,
          next: null,
          previous: `${API}/v2/projects?limit=1&offset=0`,
          results: [{ id: P5, job_id: "J5", name: "Tower Five", created_at: "", is_archived: false, is_deleted: false }],
        });
      }
      if (u.pathname === `/v2/projects/${P5}/vendor-payment-requests/${PR}`) return ok({ ...detailsJson[0], id: PR });
      return new Response("unexpected " + u.pathname, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await loadAllocationRows(createRealSource("tok"), "33");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projectName: "Tower Five", detailsUnavailable: false, detailsError: null });
    expect(rows[0].config.project_id).toBe(P5);
    expect(rows[0].details?.id).toBe(PR);
    // Both DRF pages were read (`next` followed).
    const projectCalls = fetchMock.mock.calls.map((c) => new URL(c[0])).filter((u) => u.pathname === "/v2/projects");
    expect(projectCalls.map((u) => u.searchParams.get("offset"))).toEqual(["0", "1"]);
  });
});

describe("real source: /v2/projects cache (5 min, per token, server-side)", () => {
  const ok = (data: unknown) =>
    new Response(JSON.stringify({ success: true, code: 200, message: "", errors: null, data }), { status: 200 });
  const projectsPage = () => ok({ count: 1, next: null, previous: null, results: [{ id: "PJ1", job_id: "J", name: "Tower", created_at: "", is_archived: false, is_deleted: false }] });
  let fetchMock: ReturnType<typeof vi.fn>;
  const projectCalls = () => fetchMock.mock.calls.filter((c) => new URL(c[0]).pathname === "/v2/projects").length;

  beforeEach(() => {
    clearProjectsCache();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    fetchMock = vi.fn(async () => projectsPage());
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("second load within 5 minutes makes no /v2/projects call; after 5 minutes it refetches", async () => {
    expect((await createRealSource("tok-A").listProjects())[0].name).toBe("Tower");
    expect(projectCalls()).toBe(1);
    vi.setSystemTime(new Date("2026-10-16T10:04:59Z"));
    expect((await createRealSource("tok-A").listProjects())[0].name).toBe("Tower");
    expect(projectCalls()).toBe(1); // cached
    vi.setSystemTime(new Date("2026-10-16T10:05:01Z"));
    await createRealSource("tok-A").listProjects();
    expect(projectCalls()).toBe(2); // expired → refetched
  });

  it("cache is per token (another token never sees it); failures are not cached", async () => {
    await createRealSource("tok-A").listProjects();
    await createRealSource("tok-B").listProjects();
    expect(projectCalls()).toBe(2);
    fetchMock.mockImplementationOnce(async () => new Response("boom", { status: 500 }));
    await expect(createRealSource("tok-C").listProjects()).rejects.toThrow();
    await createRealSource("tok-C").listProjects();
    expect(projectCalls()).toBe(4); // the failed attempt left nothing behind
  });

  it("through loadAllocationRows: a second load within 5 min doesn't call /v2/projects", async () => {
    const cfgPage = ok({
      count: 1,
      next: null,
      previous: null,
      results: [{ payment_request_id: "PR1", project_id: "PJ1", status: "approved", request_amount: "1.0000", paid_amount: "0", payment_due: "1.0000", currency: { id: "c", name: "INR", symbol: "₹", code: "INR" } }],
    });
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/v2/vendor-payment-requests/config/") return cfgPage.clone();
      if (u.pathname === "/v2/projects") return projectsPage();
      return ok({ ...detailsJson[0], id: "PR1" });
    });
    const first = await loadAllocationRows(createRealSource("tok-A"), "33");
    const second = await loadAllocationRows(createRealSource("tok-A"), "33");
    expect(first[0].projectName).toBe("Tower");
    expect(second[0].projectName).toBe("Tower");
    expect(projectCalls()).toBe(1);
  });
});

describe("paginateRdash page cap", () => {
  const page = (offset: number, n: number) =>
    new Response(
      JSON.stringify({ success: true, data: Array.from({ length: n }, (_, i) => ({ id: `x${offset + i}` })) }),
      { status: 200 },
    );

  it("200 full pages without a normal stop → RdashResponseShapeError (no silent truncation)", async () => {
    const fetchMock = vi.fn(async (url: string) => page(Number(new URL(url).searchParams.get("offset")), 200));
    vi.stubGlobal("fetch", fetchMock);
    await expect(paginateRdash("/v2/projects", "tok")).rejects.toBeInstanceOf(RdashResponseShapeError);
    expect(fetchMock).toHaveBeenCalledTimes(200);
  });

  it("a DRF-shaped response (e.g. /v2/vendors) is paged via next — page 1 not requested twice; unknown shapes still throw", async () => {
    const drfPage = (results: unknown[], next: string | null) =>
      new Response(JSON.stringify({ success: true, data: { count: 3, next, previous: null, results } }), { status: 200 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(drfPage([{ id: "V1" }, { id: "V2" }], `${API}/v2/vendors?limit=2&offset=2`))
      .mockResolvedValueOnce(drfPage([{ id: "V3" }], null));
    vi.stubGlobal("fetch", fetchMock);
    expect((await paginateRdash<{ id: string }>("/v2/vendors", "tok")).map((v) => v.id)).toEqual(["V1", "V2", "V3"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: { items: [] } }), { status: 200 })));
    await expect(paginateRdash("/v2/vendors", "tok")).rejects.toBeInstanceOf(RdashResponseShapeError);
  });

  it("normal stops still return: short last page, and ignored-pagination detection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const offset = Number(new URL(url).searchParams.get("offset"));
        return page(offset, offset === 0 ? 200 : 7);
      }),
    );
    expect(await paginateRdash("/v2/projects", "tok")).toHaveLength(207);

    // Same 200 ids on every page → rDash ignores offset → stop after page 2.
    const same = vi.fn(async () => page(0, 200));
    vi.stubGlobal("fetch", same);
    expect(await paginateRdash("/v2/projects", "tok")).toHaveLength(200);
    expect(same).toHaveBeenCalledTimes(2);
  });
});

describe("getRdashSource", () => {
  it("mock mode → mock data", async () => {
    process.env.RDASH_DATA_SOURCE = "mock";
    const rows = await getRdashSource({ accessToken: "mock-access-token" }).listPaymentRequestConfig("mock-vendor");
    expect(rows).toHaveLength(9);
  });

  it("missing / invalid RDASH_DATA_SOURCE → throws", () => {
    delete process.env.RDASH_DATA_SOURCE;
    expect(() => getRdashSource({ accessToken: "t" })).toThrow(/RDASH_DATA_SOURCE/);
    process.env.RDASH_DATA_SOURCE = "fake";
    expect(() => getRdashSource({ accessToken: "t" })).toThrow(/RDASH_DATA_SOURCE/);
  });

  it("real mode: an rDash failure propagates — never falls back to mock data", async () => {
    process.env.RDASH_DATA_SOURCE = "real";
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getRdashSource({ accessToken: "t" }).listProjects()).rejects.toThrow("rDash request failed");
    expect(fetchMock).toHaveBeenCalled();
  });
});
