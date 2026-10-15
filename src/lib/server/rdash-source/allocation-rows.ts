import "server-only";
import type { AllocationRow } from "@/types/payments";
import type { PaymentRequestDetails } from "@/types/rdash";
import { AuthError } from "../auth";
import type { RdashSource } from "./types";

const DETAILS_CONCURRENCY = 5;
export const DETAILS_ERROR_MESSAGE = "Details could not be loaded";

// Config (all pages) + details → allocation rows, for either source.
//  - Config item WITHOUT project_id: details are NOT called (the details path
//    needs a project) → detailsUnavailable. No guessing, no default project.
//  - Details call failure: the row is kept with detailsError (never dropped);
//    the reason goes to console.error. AuthError propagates (session dead →
//    401 → re-handover) instead of being hidden in rows.
//  - Rows are NOT filtered here (payment_due 0 is hidden by the caller).
// TODO(verify): project_id on config items (docs/api-notes.md → #10).
export async function loadAllocationRows(source: RdashSource, vendorId: string): Promise<AllocationRow[]> {
  const config = await source.listPaymentRequestConfig(vendorId);

  const needsProjects = config.some((c) => Boolean(c.project_id));
  const projectNames = new Map<string, string>();
  if (needsProjects) {
    for (const p of await source.listProjects()) projectNames.set(p.id, p.name);
  }

  const details = new Map<string, PaymentRequestDetails | Error>();
  const withProject = config.filter((c) => Boolean(c.project_id));
  let next = 0;
  const worker = async () => {
    while (next < withProject.length) {
      const item = withProject[next++];
      try {
        details.set(
          item.payment_request_id,
          await source.getPaymentRequestDetails(item.project_id as string, item.payment_request_id),
        );
      } catch (err) {
        if (err instanceof AuthError) throw err;
        console.error("[allocation-rows] details failed", {
          paymentRequestId: item.payment_request_id,
          projectId: item.project_id,
          err,
        });
        details.set(item.payment_request_id, err instanceof Error ? err : new Error(String(err)));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAILS_CONCURRENCY, withProject.length) }, worker));

  return config.map((c): AllocationRow => {
    const d = c.project_id ? details.get(c.payment_request_id) : undefined;
    const failed = d instanceof Error;
    return {
      config: c,
      details: d && !failed ? d : null,
      projectName: c.project_id ? (projectNames.get(c.project_id) ?? null) : null,
      detailsUnavailable: !c.project_id,
      detailsError: failed ? DETAILS_ERROR_MESSAGE : null,
      amount: "",
      remark: "",
      remarkOverridden: false,
      rowStatus: "idle",
      rowError: null,
    };
  });
}
