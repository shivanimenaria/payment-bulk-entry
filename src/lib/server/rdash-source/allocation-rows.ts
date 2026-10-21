import "server-only";
import type { AllocationRow } from "@/types/payments";
import type { PaymentRequestDetails, VendorPaymentRequestConfigItem } from "@/types/rdash";
import { AuthError } from "../auth";
import { resolveTempProjectId } from "@/lib/runtime-config";
import type { RdashSource } from "./types";

const DETAILS_CONCURRENCY = 5;
export const DETAILS_ERROR_MESSAGE = "Details could not be loaded";

// Config (all pages) + details → allocation rows, for either source.
//  - Config item WITHOUT project_id: details are NOT called (the details path
//    needs a project) → detailsUnavailable. No guessing, no default project —
//    EXCEPT the explicit, temporary RDASH_TEMP_PROJECT_ID workaround below.
//  - TODO(remove-temp-project-id): if RDASH_TEMP_PROJECT_ID is set, a config
//    item without project_id uses it for the details call and the row is
//    marked projectIdSource "temporary" (UI shows "(temporary)"; never
//    presented as confirmed). The config item itself is not modified. If the
//    request isn't in that project the details call fails → detailsError
//    (row kept). Config project_id always wins (docs/api-notes.md → #15).
//  - Details call failure: the row is kept with detailsError (never dropped);
//    the reason goes to console.error. AuthError propagates (session dead →
//    401 → re-handover) instead of being hidden in rows.
//  - Rows are NOT filtered by default. `opts.keep` lets the caller drop
//    config items BEFORE any details/projects call (e.g. payment_due 0).
// project_id is required in the corrected Swagger (docs/api-notes.md #10, resolved);
// a missing one is still handled defensively above.
export async function loadAllocationRows(
  source: RdashSource,
  vendorId: string,
  opts?: {
    keep?: (item: VendorPaymentRequestConfigItem) => boolean;
    /** Receives the FULL config (before `keep`), e.g. for the page-1 cards. */
    onConfig?: (all: VendorPaymentRequestConfigItem[]) => void;
  },
): Promise<AllocationRow[]> {
  const all = await source.listPaymentRequestConfig(vendorId);
  opts?.onConfig?.(all);
  const config = opts?.keep ? all.filter(opts.keep) : all;

  // TODO(remove-temp-project-id): validated at startup; re-resolved here so an
  // invalid combination still fails closed instead of being used.
  const tempProjectId = resolveTempProjectId(process.env);
  const resolved = config.map((c) => {
    if (c.project_id) return { item: c, projectId: c.project_id, source: "config" as const };
    if (tempProjectId) return { item: c, projectId: tempProjectId, source: "temporary" as const };
    return { item: c, projectId: null, source: null };
  });

  const needsProjects = resolved.some((r) => r.projectId);
  const projectNames = new Map<string, string>();
  if (needsProjects) {
    for (const p of await source.listProjects()) projectNames.set(p.id, p.name);
  }

  const details = new Map<string, PaymentRequestDetails | Error>();
  const withProject = resolved.filter((r) => r.projectId);
  let next = 0;
  const worker = async () => {
    while (next < withProject.length) {
      const { item, projectId, source: idSource } = withProject[next++];
      try {
        details.set(
          item.payment_request_id,
          await source.getPaymentRequestDetails(projectId as string, item.payment_request_id),
        );
      } catch (err) {
        if (err instanceof AuthError) throw err;
        console.error("[allocation-rows] details failed", {
          paymentRequestId: item.payment_request_id,
          projectId,
          projectIdSource: idSource,
          err,
        });
        details.set(item.payment_request_id, err instanceof Error ? err : new Error(String(err)));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAILS_CONCURRENCY, withProject.length) }, worker));

  return resolved.map(({ item: c, projectId, source: projectIdSource }): AllocationRow => {
    const d = projectId ? details.get(c.payment_request_id) : undefined;
    const failed = d instanceof Error;
    return {
      config: c,
      details: d && !failed ? d : null,
      projectName: projectId ? (projectNames.get(projectId) ?? null) : null,
      projectIdSource,
      detailsUnavailable: !projectId,
      detailsError: failed ? DETAILS_ERROR_MESSAGE : null,
      amount: "",
      remark: "",
      remarkOverridden: false,
      rowStatus: "idle",
      rowError: null,
    };
  });
}
