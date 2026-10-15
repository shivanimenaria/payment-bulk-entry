import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import Hashids from "hashids";
import { setAuthEnv, TEST_SALT } from "./helpers";
import { createMockSource, resetMockState, MockVendorNotFoundError } from "@/lib/server/rdash-source/mock";
import { createRealSource, buildBulkBody, BULK_BODY_WRAPPER } from "@/lib/server/rdash-source/real";
import { loadAllocationRows, DETAILS_ERROR_MESSAGE } from "@/lib/server/rdash-source/allocation-rows";
import { getRdashSource } from "@/lib/server/rdash-source";
import type { RdashSource } from "@/lib/server/rdash-source/types";
import { AuthError } from "@/lib/server/auth";
import { RdashResponseShapeError, paginateRdash } from "@/lib/server/api";
import projectsJson from "@/lib/server/rdash-source/mock-data/projects.json";
import configJson from "@/lib/server/rdash-source/mock-data/config.mock-vendor.json";
import detailsJson from "@/lib/server/rdash-source/mock-data/details.json";
import type { BulkPaymentEntryInput, VendorPaymentRequestConfigItem } from "@/types/rdash";

const API = "https://rdash-api.example.com";

// Exact Swagger key sets (CLAUDE.md "Response fields"). project_id is the one
// TODO(verify) addition on config items (mock only).
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

  it("config: 6 requests across all 5 projects; dues 30k/50k/40k/45k/35k (=200000) + one 0", () => {
    expect(configJson.count).toBe(6);
    expect(configJson.data).toHaveLength(6);
    for (const c of configJson.data) {
      expect(Object.keys(c).sort()).toEqual(CONFIG_KEYS);
      expect(c.request_amount).toBe(c.paid_amount + c.payment_due);
    }
    const dues = configJson.data.map((c) => c.payment_due);
    expect(dues.filter((d) => d > 0)).toEqual([30000, 50000, 40000, 45000, 35000]);
    expect(dues.reduce((a, b) => a + b, 0)).toBe(200000);
    expect(dues.filter((d) => d === 0)).toHaveLength(1);
    expect(new Set(configJson.data.map((c) => c.project_id))).toEqual(new Set(projectsJson.map((p) => p.id)));
  });

  it("details: one per request, Swagger keys, amounts match config, some null number/due date", () => {
    expect(detailsJson).toHaveLength(6);
    for (const d of detailsJson) {
      expect(Object.keys(d).sort()).toEqual(DETAILS_KEYS);
      const c = configJson.data.find((x) => x.payment_request_id === d.id)!;
      expect(d.payment_due).toBe(c.payment_due);
      expect(d.total_request_amount).toBe(c.request_amount);
      expect(d.request_amount_without_tax + d.tax_amount).toBeCloseTo(d.total_request_amount, 2);
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
    expect(after.payment_due).toBe(29999.5);
    expect(after.paid_amount).toBe(50000.5);
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
  const cfg = (id: string, project_id?: string): VendorPaymentRequestConfigItem => ({
    payment_request_id: id,
    status: "approved",
    request_amount: 100,
    paid_amount: 0,
    payment_due: 100,
    currency: {},
    ...(project_id ? { project_id } : {}),
  });

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

  it("mock: all 6 rows with project names and details; zero-due row kept for the caller to hide", async () => {
    const rows = await loadAllocationRows(createMockSource(), "mock-vendor");
    expect(rows).toHaveLength(6);
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
  const item = (i: number) => ({
    payment_request_id: `pr${i}`,
    status: "approved",
    request_amount: 1,
    paid_amount: 0,
    payment_due: 1,
    currency: {},
  });

  it("config: session vendor re-encoded, paged until count (offset advances by items received)", async () => {
    // Server caps the page at 2 items regardless of limit=200.
    fetchMock.mockImplementation(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return ok({ count: 5, data: [item(offset), item(offset + 1)].filter((x) => Number(x.payment_request_id.slice(2)) < 5) });
    });
    const rows = await createRealSource("tok").listPaymentRequestConfig("33");
    expect(rows.map((r) => r.payment_request_id)).toEqual(["pr0", "pr1", "pr2", "pr3", "pr4"]);
    const first = new URL(fetchMock.mock.calls[0][0]);
    expect(first.pathname).toBe("/v2/vendor-payment-requests/config/");
    expect(first.searchParams.get("vendor_id")).toBe(new Hashids(TEST_SALT, 16).encode(33));
    expect(fetchMock.mock.calls.map((c) => new URL(c[0]).searchParams.get("offset"))).toEqual(["0", "2", "4"]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("config: missing count → error; empty page before count → error (never partial)", async () => {
    fetchMock.mockResolvedValueOnce(ok({ data: [item(0)] }));
    await expect(createRealSource("tok").listPaymentRequestConfig("33")).rejects.toBeInstanceOf(RdashResponseShapeError);
    fetchMock.mockResolvedValueOnce(ok({ count: 3, data: [item(0)] })).mockResolvedValueOnce(ok({ count: 3, data: [] }));
    await expect(createRealSource("tok").listPaymentRequestConfig("33")).rejects.toBeInstanceOf(RdashResponseShapeError);
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
          data: [{ payment_request_id: PR, status: "approved", request_amount: 10, paid_amount: 0, payment_due: 10, currency: {}, project_id: P5 }],
        });
      }
      if (u.pathname === "/v2/projects") {
        return ok([
          { id: P6, job_id: "J6", name: "Other Project", created_at: "", is_archived: false, is_deleted: false },
          { id: P5, job_id: "J5", name: "Tower Five", created_at: "", is_archived: false, is_deleted: false },
        ]);
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
    expect(rows).toHaveLength(6);
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
