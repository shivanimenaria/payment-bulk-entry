import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Browser side of session expiry (src/lib/api-fetch.ts): on 401 save the
// unsaved form, then navigate to /embedded/bootstrap?force=1&next=<path>;
// never re-send a request; a 401 right after a fresh handover stops with an
// error instead of looping. `window` is stubbed (vitest runs in node).

type ApiFetchModule = typeof import("@/lib/api-fetch");

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let mod: ApiFetchModule;
let storage: MemoryStorage;
let replace: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let now: number;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const expiredRes = () => json(401, { error: "session_expired" });

// Fresh module per page load (module state = one page in the iframe).
async function loadPage() {
  vi.resetModules();
  replace.mockClear();
  mod = await import("@/lib/api-fetch");
}

beforeEach(async () => {
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  storage = new MemoryStorage();
  replace = vi.fn();
  vi.stubGlobal("window", {
    sessionStorage: storage,
    location: { pathname: "/payments/new", search: "?orgId=o1&vendorId=v1", replace },
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await loadPage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch: 401 session_expired", () => {
  it("saves the form, then redirects to bootstrap with force=1 and next=<current path>", async () => {
    const order: string[] = [];
    mod.onBeforeRehandover(() => order.push("save"));
    replace.mockImplementation(() => order.push("navigate"));
    fetchMock.mockResolvedValue(expiredRes());

    const res = await mod.apiFetch("/api/rdash/payment-requests");

    expect(res.status).toBe(401);
    expect(order).toEqual(["save", "navigate"]);
    expect(replace).toHaveBeenCalledWith(
      `/embedded/bootstrap?force=1&next=${encodeURIComponent("/payments/new?orgId=o1&vendorId=v1")}`,
    );
    expect(storage.getItem(mod.REHANDOVER_MARKER_KEY)).toBe(String(now));
  });

  it("a burst of 401s on one page navigates once", async () => {
    const save = vi.fn();
    mod.onBeforeRehandover(save);
    fetchMock.mockImplementation(async () => expiredRes());
    await Promise.all([mod.apiFetch("/a"), mod.apiFetch("/b"), mod.apiFetch("/c")]);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a failing save hook does not block the re-handover", async () => {
    mod.onBeforeRehandover(() => {
      throw new Error("boom");
    });
    fetchMock.mockResolvedValue(expiredRes());
    await mod.apiFetch("/x");
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^\/embedded\/bootstrap\?force=1&next=/));
  });

  it("an unregistered hook is not called", async () => {
    const save = vi.fn();
    const off = mod.onBeforeRehandover(save);
    off();
    fetchMock.mockResolvedValue(expiredRes());
    await mod.apiFetch("/x");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("apiFetch: submit is never re-sent", () => {
  it("a bulk POST that gets 401 is sent once — not before, not after the re-handover", async () => {
    fetchMock.mockResolvedValue(expiredRes());
    const res = await mod.apiFetch("/api/rdash/payment-entries/bulk", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Back on the page after the handover: nothing is replayed on load.
    await loadPage();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("apiFetch: loop guard", () => {
  it("401 right after a fresh handover → error page, no second handover", async () => {
    fetchMock.mockResolvedValue(expiredRes());
    await mod.apiFetch("/api/rdash/payment-requests");
    expect(replace).toHaveBeenLastCalledWith(expect.stringMatching(/force=1/));

    // The fresh session dies again immediately.
    await loadPage();
    const save = vi.fn();
    mod.onBeforeRehandover(save);
    now += 5_000;
    await mod.apiFetch("/api/rdash/payment-requests");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(mod.SESSION_RENEW_FAILED_URL);
    expect(save).toHaveBeenCalledTimes(1); // the form is still kept for a manual reload
    expect(storage.getItem(mod.REHANDOVER_MARKER_KEY)).toBeNull();
  });

  it("a successful call after the handover clears the guard; a later expiry re-handovers normally", async () => {
    fetchMock.mockResolvedValueOnce(expiredRes());
    await mod.apiFetch("/api/rdash/payment-requests");

    await loadPage();
    fetchMock.mockResolvedValueOnce(json(200, { rows: [] }));
    await mod.apiFetch("/api/rdash/payment-requests");
    expect(storage.getItem(mod.REHANDOVER_MARKER_KEY)).toBeNull();

    now += 5_000;
    fetchMock.mockResolvedValueOnce(expiredRes());
    await mod.apiFetch("/api/rdash/payment-requests");
    expect(replace).toHaveBeenLastCalledWith(expect.stringMatching(/^\/embedded\/bootstrap\?force=1/));
  });

  it("a stale guard (older than the loop window) does not block a re-handover", async () => {
    storage.setItem(mod.REHANDOVER_MARKER_KEY, String(now - mod.LOOP_WINDOW_MS - 1));
    fetchMock.mockResolvedValue(expiredRes());
    await mod.apiFetch("/x");
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/force=1/));
  });

  it("blocked storage: still re-handovers (no crash)", async () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
      location: { pathname: "/payments/new", search: "", replace },
    });
    await loadPage();
    fetchMock.mockResolvedValue(expiredRes());
    await mod.apiFetch("/x");
    expect(replace).toHaveBeenCalledWith(`/embedded/bootstrap?force=1&next=${encodeURIComponent("/payments/new")}`);
  });
});
