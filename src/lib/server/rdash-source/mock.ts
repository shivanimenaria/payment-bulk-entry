import "server-only";
import type {
  BulkPaymentEntryCreateOutput,
  BulkPaymentEntryInput,
  PaginatedVendorPaymentRequestConfig,
  PaymentRequestDetails,
  RdashProject,
  VendorPaymentRequestConfigItem,
} from "@/types/rdash";
import type { RdashSource } from "./types";
import projectsJson from "./mock-data/projects.json";
import mockVendorConfigJson from "./mock-data/config.mock-vendor.json";
import detailsJson from "./mock-data/details.json";

// RDASH_DATA_SOURCE=mock. Data comes from mock-data/*.json (strict Swagger
// shapes). Only reachable through index.ts when mock mode is selected.
//
// Bulk creates mutate an in-process copy of the config/details so a refetch
// after submit shows the reduced payment_due (resetMockState() restores the
// fixtures). TODO(verify): project_id on config items exists in mock data only
// (docs/api-notes.md → #10).

const CONFIG_BY_VENDOR: Record<string, PaginatedVendorPaymentRequestConfig> = {
  "mock-vendor": mockVendorConfigJson as PaginatedVendorPaymentRequestConfig,
};

/** Mock has no data for this vendor — an error, never an empty list. */
export class MockVendorNotFoundError extends Error {
  constructor(vendorId: string) {
    super(`No mock data for vendor ${vendorId}`);
    this.name = "MockVendorNotFoundError";
  }
}

/** Unknown request / project mismatch in mock details. */
export class MockNotFoundError extends Error {
  constructor(what: string) {
    super(`Mock ${what} not found`);
    this.name = "MockNotFoundError";
  }
}

type State = {
  config: Record<string, VendorPaymentRequestConfigItem[]>;
  details: PaymentRequestDetails[];
  nextEntryId: number;
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function freshState(): State {
  return {
    config: Object.fromEntries(Object.entries(CONFIG_BY_VENDOR).map(([v, page]) => [v, clone(page.data)])),
    details: clone(detailsJson as PaymentRequestDetails[]),
    nextEntryId: 1,
  };
}

let state = freshState();

/** Test helper: restore the JSON fixtures. */
export function resetMockState(): void {
  state = freshState();
}

// MOCK_FAIL_IDS: comma-separated payment_request_ids that always fail in bulk.
function mockFailIds(): Set<string> {
  return new Set(
    (process.env.MOCK_FAIL_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function findConfigItem(requestId: string): VendorPaymentRequestConfigItem | undefined {
  for (const items of Object.values(state.config)) {
    const hit = items.find((i) => i.payment_request_id === requestId);
    if (hit) return hit;
  }
  return undefined;
}

// Money arithmetic in paise to avoid float drift.
const toPaise = (n: number) => Math.round(n * 100);
const fromPaise = (p: number) => p / 100;

export function createMockSource(): RdashSource {
  return {
    async listProjects(): Promise<RdashProject[]> {
      return clone(projectsJson as RdashProject[]);
    },

    async listPaymentRequestConfig(vendorId: string): Promise<VendorPaymentRequestConfigItem[]> {
      const items = state.config[vendorId];
      if (!items) throw new MockVendorNotFoundError(vendorId);
      return clone(items);
    },

    async getPaymentRequestDetails(projectId: string, requestId: string): Promise<PaymentRequestDetails> {
      const cfg = findConfigItem(requestId);
      if (!cfg || cfg.project_id !== projectId) throw new MockNotFoundError(`request ${requestId} in ${projectId}`);
      const details = state.details.find((d) => d.id === requestId);
      if (!details) throw new MockNotFoundError(`details ${requestId}`);
      return clone(details);
    },

    async createBulkPaymentEntries(entries: BulkPaymentEntryInput[]): Promise<BulkPaymentEntryCreateOutput> {
      const failIds = mockFailIds();
      const out: BulkPaymentEntryCreateOutput = { count: 0, created: [], failed: [] };
      for (const entry of entries) {
        const cfg = findConfigItem(entry.payment_request_id);
        if (!cfg) {
          out.failed.push({ payment_request_id: entry.payment_request_id, error: "Payment request not found" });
          continue;
        }
        if (failIds.has(entry.payment_request_id)) {
          out.failed.push({ payment_request_id: entry.payment_request_id, error: "Forced failure (MOCK_FAIL_IDS)" });
          continue;
        }
        if (!(entry.amount > 0)) {
          out.failed.push({ payment_request_id: entry.payment_request_id, error: "Invalid amount" });
          continue;
        }
        if (toPaise(entry.amount) > toPaise(cfg.payment_due)) {
          out.failed.push({ payment_request_id: entry.payment_request_id, error: "Amount exceeds payment due" });
          continue;
        }
        cfg.paid_amount = fromPaise(toPaise(cfg.paid_amount) + toPaise(entry.amount));
        cfg.payment_due = fromPaise(toPaise(cfg.payment_due) - toPaise(entry.amount));
        const details = state.details.find((d) => d.id === entry.payment_request_id);
        if (details) {
          details.paid_till_date = cfg.paid_amount;
          details.payment_due = cfg.payment_due;
        }
        out.created.push({ id: `mock-entry-${state.nextEntryId++}`, payment_request_id: entry.payment_request_id });
      }
      out.count = out.created.length;
      return out;
    },
  };
}
