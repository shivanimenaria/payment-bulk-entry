import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import Hashids from "hashids";
import { setAuthEnv, makeSessionCookie, TEST_SALT } from "./helpers";
import { GET as projectsGET } from "@/app/api/rdash/projects/route";
import { GET as requestsGET } from "@/app/api/rdash/payment-requests/route";
import { POST as bulkPOST } from "@/app/api/rdash/payment-entries/bulk/route";
import { resetMockState } from "@/lib/server/rdash-source/mock";
import { clearProjectsCache } from "@/lib/server/rdash-source/real";
import detailsJson from "@/lib/server/rdash-source/mock-data/details.json";
import { rdashPaise } from "@/lib/payments/money";

const APP = "https://pbe.example.com";
const API = "https://rdash-api.example.com";
const h = new Hashids(TEST_SALT, 16);
const enc = (n: number) => h.encode(n);
const CONFIG_PATH = "/v2/vendor-payment-requests/config/";
const BULK_PATH = "/v2/vendor-payment-requests/payment-entries/bulk/";

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: true, code: status, message: "", errors: null, data }), { status });

// Fresh server-side config for the session vendor (33).
// Real rDash shapes: decimal-string amounts, currency object (see
// tests/fixtures/real-config-page.json). PR3 omits project_id (now required
// by Swagger) to exercise the defensive detailsUnavailable path.
const INR = { id: "9ng3XGvlNqK8oJ4V", name: "Indian National Rupee", symbol: "₹", code: "INR", locale: "en-IN" };
const SERVER_CONFIG = [
  { payment_request_id: "PR1", status: "approved", request_amount: "1000.0000", paid_amount: "0", payment_due: "1000.0000", currency: INR, project_id: "PJ1" },
  { payment_request_id: "PR2", status: "approved", request_amount: "800.0000", paid_amount: "300.0000", payment_due: "500.0000", currency: INR, project_id: "PJ1" },
  { payment_request_id: "PR3", status: "approved", request_amount: "200.5000", paid_amount: "0", payment_due: "200.5000", currency: INR },
  { payment_request_id: "PR0", status: "approved", request_amount: "50.0000", paid_amount: "50.0000", payment_due: "0", currency: INR, project_id: "PJ1" },
];

// Config the rDash stub serves (reset per test).
let serverConfig: Record<string, unknown>[] = SERVER_CONFIG;
let fetchMock: ReturnType<typeof vi.fn>;
let bulkResponse: () => Response;
let cookie: string;

function rdashStub(url: string, init?: RequestInit): Response {
  const u = new URL(url);
  // DRF pagination (single page here; multi-page paging is tested in rdash-source.test.ts).
  if (u.pathname === CONFIG_PATH) return ok({ count: serverConfig.length, next: null, previous: null, results: serverConfig });
  if (u.pathname === "/v2/projects")
    return ok({ count: 1, next: null, previous: null, results: [{ id: "PJ1", job_id: "J", name: "Tower One", created_at: "", is_archived: false, is_deleted: false }] });
  if (u.pathname === "/v2/projects/PJ1/vendor-payment-requests/PR2") return new Response("boom", { status: 500 });
  if (u.pathname.startsWith("/v2/projects/PJ1/vendor-payment-requests/")) {
    return ok({ ...detailsJson[0], id: u.pathname.split("/").pop() });
  }
  if (u.pathname === BULK_PATH && init?.method === "POST") return bulkResponse();
  return new Response("unexpected", { status: 404 });
}

const calls = (pathname: string) => fetchMock.mock.calls.filter((c) => new URL(c[0]).pathname === pathname);
const bulkCalls = () => calls(BULK_PATH);

function get(handler: (r: NextRequest) => Promise<Response>, path: string, withCookie = true) {
  return handler(new NextRequest(`${APP}${path}`, withCookie ? { headers: { cookie: `pbe-auth=${cookie}` } } : undefined));
}

function post(body: unknown, path = "/api/rdash/payment-entries/bulk") {
  return bulkPOST(
    new NextRequest(`${APP}${path}`, {
      method: "POST",
      headers: { cookie: `pbe-auth=${cookie}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const header = (amountPaid: string) => ({
  amountPaid,
  paymentDate: "2026-10-15",
  paymentMode: "bank_transfer",
  reference: "UTR-1",
  remark: "Oct payment",
});

beforeAll(() => {
  setAuthEnv();
  process.env.RDASH_API_URL = API;
});

beforeEach(async () => {
  process.env.RDASH_DATA_SOURCE = "real";
  delete process.env.MOCK_FAIL_IDS;
  resetMockState();
  clearProjectsCache();
  cookie = await makeSessionCookie({ vendorId: "33" });
  serverConfig = SERVER_CONFIG;
  bulkResponse = () => ok({ count: 0, created: [], failed: [] });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => rdashStub(url, init));
  vi.stubGlobal("fetch", fetchMock);
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/rdash/payment-requests (real)", () => {
  it("session vendor only; due-0 hidden before details; no project_id → detailsUnavailable; failed details → detailsError", async () => {
    const res = await get(requestsGET, "/api/rdash/payment-requests");
    expect(res.status).toBe(200);
    const { rows } = await res.json();
    expect(new URL(calls(CONFIG_PATH)[0][0]).searchParams.get("vendor_id")).toBe(enc(33));

    expect(rows.map((r: { config: { payment_request_id: string } }) => r.config.payment_request_id)).toEqual(["PR1", "PR2", "PR3"]);
    expect(calls("/v2/projects/PJ1/vendor-payment-requests/PR0")).toHaveLength(0);
    expect(rows[0]).toMatchObject({ projectName: "Tower One", detailsError: null, detailsUnavailable: false, rowError: null });
    expect(rows[1]).toMatchObject({ details: null, detailsError: "Details could not be loaded", rowError: null });
    expect(rows[2]).toMatchObject({ detailsUnavailable: true, details: null, projectName: null });
  });

  it("a different vendor in the query is never used (session is refused → 401, no rDash call)", async () => {
    const res = await get(requestsGET, `/api/rdash/payment-requests?vendor_id=${enc(99)}`);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rDash 403 → 403 with the fixed permission message", async () => {
    fetchMock.mockImplementation(async () => new Response("no", { status: 403 }));
    const res = await get(requestsGET, "/api/rdash/payment-requests");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You do not have access to perform this action" });
  });

  it("other upstream failure → 502 generic, never an empty list", async () => {
    fetchMock.mockImplementation(async () => new Response("db host leaked", { status: 500 }));
    const res = await get(requestsGET, "/api/rdash/payment-requests");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.rows).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("leaked");
  });

  it("no session → 401", async () => {
    const res = await get(requestsGET, "/api/rdash/payment-requests", false);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/rdash/payment-entries/bulk (real)", () => {
  it("uses the session vendor + server payment_due; client vendor / payment_due are ignored", async () => {
    bulkResponse = () =>
      ok({ count: 2, created: [{ id: "E1", payment_request_id: "PR1" }, { id: "E2", payment_request_id: "PR2" }], failed: [] });
    const res = await post({
      vendor_id: enc(99),
      header: { ...header("1500"), vendor_id: enc(99) },
      rows: [
        { payment_request_id: "PR1", amount: "1000", remark: "r1", payment_due: 1, vendor_id: enc(99) },
        { payment_request_id: "PR2", amount: 500, remark: null },
      ],
    });
    expect(res.status).toBe(200);
    expect(new URL(calls(CONFIG_PATH)[0][0]).searchParams.get("vendor_id")).toBe(enc(33));
    const sent = JSON.parse(bulkCalls()[0][1].body);
    expect(sent).toEqual({
      entries: [
        { payment_request_id: "PR1", amount: 1000, payment_mode: "bank_transfer", payment_date: "2026-10-15", transaction_id: "UTR-1", transaction_proof_file_url: null, transaction_proof_file_name: null, remark: "r1" },
        { payment_request_id: "PR2", amount: 500, payment_mode: "bank_transfer", payment_date: "2026-10-15", transaction_id: "UTR-1", transaction_proof_file_url: null, transaction_proof_file_name: null, remark: null },
      ],
    });
    expect(JSON.stringify(sent)).not.toContain(enc(99));
    expect(await res.json()).toEqual({
      count: 2,
      created: [{ id: "E1", payment_request_id: "PR1" }, { id: "E2", payment_request_id: "PR2" }],
      failed: [],
      recordedAmount: 1500,
      notRecordedAmount: 0,
    });
  });

  it("unknown id → 400, bulk not called", async () => {
    const res = await post({ header: header("10"), rows: [{ payment_request_id: "NOPE", amount: "10", remark: null }] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors.rows[0].payment_request_id).toMatch(/Unknown/);
    expect(bulkCalls()).toHaveLength(0);
  });

  it("amount > SERVER payment_due → 400 even if the client claims a bigger due", async () => {
    const res = await post({
      header: header("500.01"),
      rows: [{ payment_request_id: "PR2", amount: "500.01", remark: null, payment_due: 99999 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.rows[0].amount).toMatch(/more than the payment due/);
    expect(bulkCalls()).toHaveLength(0);
  });

  it("duplicate id → 400", async () => {
    const res = await post({
      header: header("20"),
      rows: [
        { payment_request_id: "PR1", amount: "10", remark: null },
        { payment_request_id: "PR1", amount: "10", remark: null },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.rows[1].payment_request_id).toMatch(/Duplicate/);
    expect(bulkCalls()).toHaveLength(0);
  });

  it("sum ≠ amountPaid → 400", async () => {
    const res = await post({ header: header("100"), rows: [{ payment_request_id: "PR1", amount: "99.99", remark: null }] });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.form).toContain("Allocated total must equal Amount Paid");
    expect(bulkCalls()).toHaveLength(0);
  });

  it.each([
    ["zero-due row", { payment_request_id: "PR0", amount: "1", remark: null }, "payment_request_id"],
    ["3 decimals", { payment_request_id: "PR1", amount: "1.005", remark: null }, "amount"],
    ["zero amount", { payment_request_id: "PR1", amount: "0", remark: null }, "amount"],
    ["negative", { payment_request_id: "PR1", amount: -5, remark: null }, "amount"],
  ])("%s → 400", async (_l, row, field) => {
    const res = await post({ header: header("1"), rows: [row] });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.rows[0][field]).toBeTruthy();
    expect(bulkCalls()).toHaveLength(0);
  });

  it("invalid header → 400 with header field errors", async () => {
    const res = await post({
      header: { amountPaid: "10", paymentDate: "2026-02-30", paymentMode: "wire", reference: "", remark: "" },
      rows: [{ payment_request_id: "PR1", amount: "10", remark: null }],
    });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).fieldErrors.header).sort()).toEqual(["paymentDate", "paymentMode"]);
  });

  it("malformed JSON → 400", async () => {
    expect((await post("{not json")).status).toBe(400);
  });

  it("partial failure maps created / failed to recorded / not-recorded amounts", async () => {
    bulkResponse = () =>
      ok({
        count: 1,
        created: [{ id: "E1", payment_request_id: "PR1" }],
        failed: [{ payment_request_id: "PR3", error: "Rejected" }],
      });
    const res = await post({
      header: header("1200.5"),
      rows: [
        { payment_request_id: "PR1", amount: "1000", remark: null },
        { payment_request_id: "PR3", amount: "200.50", remark: null },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recordedAmount: 1000, notRecordedAmount: 200.5, count: 1 });
  });

  it("bulk output that doesn't account for every entry → 502 (never reported as not recorded)", async () => {
    bulkResponse = () => ok({ count: 1, created: [{ id: "E1", payment_request_id: "PR1" }], failed: [] });
    const res = await post({
      header: header("1500"),
      rows: [
        { payment_request_id: "PR1", amount: "1000", remark: null },
        { payment_request_id: "PR2", amount: "500", remark: null },
      ],
    });
    expect(res.status).toBe(502);
    expect((await res.json()).notRecordedAmount).toBeUndefined();
  });
});

describe("payable-status filter (lib/payments/payable.ts)", () => {
  const item = (id: string, status: unknown, due: number) => {
    const c: Record<string, unknown> = {
      payment_request_id: id,
      request_amount: "100.0000",
      paid_amount: `${100 - due}.0000`,
      payment_due: due === 0 ? "0" : `${due}.0000`,
      currency: INR,
      project_id: "PJ1",
    };
    if (status !== undefined) c.status = status;
    return c;
  };
  const MIXED = [
    item("P-PENDING", "pending", 10),
    item("P-APPROVED", "approved", 20),
    item("P-SUBMITTED", "submitted", 30),
    item("X-REJECTED", "rejected", 40),
    item("X-CANCELLED", "cancelled", 50),
    item("X-HOLD", "hold", 60),
    item("X-UNKNOWN", "partially_paid", 70),
    item("X-CASE", "Approved", 80),
    item("X-MISSING", undefined, 90),
    item("X-DUE0", "approved", 0),
  ];

  it("GET keeps only pending/approved/submitted with due > 0; the rest never get a details call", async () => {
    serverConfig = MIXED;
    const res = await get(requestsGET, "/api/rdash/payment-requests");
    expect(res.status).toBe(200);
    const { rows } = await res.json();
    expect(rows.map((r: { config: { payment_request_id: string } }) => r.config.payment_request_id)).toEqual([
      "P-PENDING",
      "P-APPROVED",
      "P-SUBMITTED",
    ]);
    const detailIds = fetchMock.mock.calls
      .map((c) => new URL(c[0]).pathname)
      .filter((p) => p.startsWith("/v2/projects/PJ1/vendor-payment-requests/"))
      .map((p) => p.split("/").pop());
    expect(detailIds.sort()).toEqual(["P-APPROVED", "P-PENDING", "P-SUBMITTED"]);
  });

  it("a payable row whose amount is too large is returned (with the page intact), not dropped", async () => {
    const huge = "2000000000000000000000000000.0000";
    serverConfig = [
      ...MIXED.slice(0, 1),
      { ...item("P-HUGE", "approved", 1), request_amount: huge, payment_due: huge },
    ];
    const res = await get(requestsGET, "/api/rdash/payment-requests");
    expect(res.status).toBe(200);
    const { rows } = await res.json();
    expect(rows.map((r: { config: { payment_request_id: string } }) => r.config.payment_request_id)).toEqual(["P-PENDING", "P-HUGE"]);
    expect(rows[1].config.payment_due).toBe(huge); // passed through exactly, as a string
  });

  it.each(["X-REJECTED", "X-CANCELLED", "X-HOLD", "X-UNKNOWN", "X-CASE", "X-MISSING"])(
    "bulk: %s (non-payable status) → 400, bulk API not called",
    async (id) => {
      serverConfig = MIXED;
      const res = await post({ header: header("1"), rows: [{ payment_request_id: id, amount: "1", remark: null }] });
      expect(res.status).toBe(400);
      expect((await res.json()).fieldErrors.rows[0].payment_request_id).toBe(
        "This payment request can't be paid in its current status",
      );
      expect(bulkCalls()).toHaveLength(0);
    },
  );

  it("bulk: one non-payable row rejects the whole submission (payable row not sent either)", async () => {
    serverConfig = MIXED;
    const res = await post({
      header: header("11"),
      rows: [
        { payment_request_id: "P-PENDING", amount: "10", remark: null },
        { payment_request_id: "X-HOLD", amount: "1", remark: null },
      ],
    });
    expect(res.status).toBe(400);
    expect(bulkCalls()).toHaveLength(0);
  });

  it("bulk: pending + submitted rows are accepted", async () => {
    serverConfig = MIXED;
    bulkResponse = () =>
      ok({ count: 2, created: [{ id: "E1", payment_request_id: "P-PENDING" }, { id: "E2", payment_request_id: "P-SUBMITTED" }], failed: [] });
    const res = await post({
      header: header("40"),
      rows: [
        { payment_request_id: "P-PENDING", amount: "10", remark: null },
        { payment_request_id: "P-SUBMITTED", amount: "30", remark: null },
      ],
    });
    expect(res.status).toBe(200);
    expect(bulkCalls()).toHaveLength(1);
  });
});

describe("RDASH_TEMP_PROJECT_ID (TODO(remove-temp-project-id))", () => {
  afterEach(() => {
    delete process.env.RDASH_TEMP_PROJECT_ID;
  });

  it("row without project_id uses the temp project for details and is marked temporary; bulk unaffected", async () => {
    process.env.RDASH_TEMP_PROJECT_ID = "PJ1";
    const { rows } = await (await get(requestsGET, "/api/rdash/payment-requests")).json();
    const pr3 = rows.find((r: { config: { payment_request_id: string } }) => r.config.payment_request_id === "PR3");
    expect(pr3).toMatchObject({ projectIdSource: "temporary", projectName: "Tower One", detailsUnavailable: false });
    expect(pr3.config.project_id).toBeUndefined();
    expect(calls("/v2/projects/PJ1/vendor-payment-requests/PR3")).toHaveLength(1);
    expect(rows.find((r: { config: { payment_request_id: string } }) => r.config.payment_request_id === "PR1").projectIdSource).toBe("config");

    bulkResponse = () => ok({ count: 1, created: [{ id: "E3", payment_request_id: "PR3" }], failed: [] });
    const res = await post({ header: header("200.5"), rows: [{ payment_request_id: "PR3", amount: "200.5", remark: null }] });
    expect(res.status).toBe(200);
    expect(Object.keys(JSON.parse(bulkCalls()[0][1].body).entries[0]).sort()).toEqual([
      "amount", "payment_date", "payment_mode", "payment_request_id", "remark",
      "transaction_id", "transaction_proof_file_name", "transaction_proof_file_url",
    ]);
  });
});

describe("mock mode", () => {
  beforeEach(() => {
    process.env.RDASH_DATA_SOURCE = "mock";
  });

  it("projects → 5 { id, name }", async () => {
    const { projects } = await (await get(projectsGET, "/api/rdash/projects", false)).json();
    expect(projects).toHaveLength(5);
    expect(Object.keys(projects[0]).sort()).toEqual(["id", "name"]);
  });

  it("payment-requests → 5 rows (due-0 request hidden), total due 200000", async () => {
    const { rows } = await (await get(requestsGET, "/api/rdash/payment-requests", false)).json();
    expect(rows).toHaveLength(5);
    expect(rows.reduce((s: number, r: { config: { payment_due: string } }) => s + rdashPaise(r.config.payment_due)!, 0)).toBe(20000000);
    expect(rows.some((r: { config: { payment_request_id: string } }) => r.config.payment_request_id === "mock-pr-106")).toBe(false);
  });

  it("bulk with MOCK_FAIL_IDS → partial failure amounts; refetch shows reduced due", async () => {
    process.env.MOCK_FAIL_IDS = "mock-pr-103";
    const res = await bulkPOST(
      new NextRequest(`${APP}/api/rdash/payment-entries/bulk`, {
        method: "POST",
        body: JSON.stringify({
          header: header("70000"),
          rows: [
            { payment_request_id: "mock-pr-101", amount: "30000", remark: null },
            { payment_request_id: "mock-pr-103", amount: "40000", remark: null },
          ],
        }),
      }),
    );
    expect(await res.json()).toMatchObject({ count: 1, recordedAmount: 30000, notRecordedAmount: 40000 });
    const { rows } = await (await get(requestsGET, "/api/rdash/payment-requests", false)).json();
    expect(rows.map((r: { config: { payment_request_id: string } }) => r.config.payment_request_id)).not.toContain("mock-pr-101");
  });
});
