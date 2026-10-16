"use client";

import type { BulkPaymentEntryInput } from "@/types/rdash";
import type { BulkSubmitRequest } from "@/types/payments";
import { rdCard } from "@/components/rd/styles";

// Mock mode only (CLAUDE.md Data Source Mode): the exact JSON sent.
//  - request: body POSTed to /api/rdash/payment-entries/bulk (buildSubmitRequest)
//  - entries: what the server builds for rDash (buildBulkEntries); the server
//    wraps them per BULK_BODY_WRAPPER (TODO(verify): `{ entries }` vs
//    `{ data: { entries } }`).
export function PayloadPreview({
  label,
  request,
  entries,
}: {
  label: string;
  request: BulkSubmitRequest;
  entries: BulkPaymentEntryInput[] | null;
}) {
  return (
    <details className={rdCard}>
      <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold text-rd-text">
        Payload preview (mock) · {label} · {request.rows.length} {request.rows.length === 1 ? "row" : "rows"}
      </summary>
      <div className="grid border-t border-rd-divider md:grid-cols-2 md:divide-x md:divide-rd-divider">
        <div>
          <p className="px-4 pt-2 text-[11px] font-semibold text-rd-muted">POST /api/rdash/payment-entries/bulk</p>
          <pre data-testid="payload-request" className="max-h-80 overflow-auto px-4 py-2 text-[11px] leading-relaxed text-rd-text">
            {JSON.stringify(request, null, 2)}
          </pre>
        </div>
        <div>
          <p className="px-4 pt-2 text-[11px] font-semibold text-rd-muted">Entries sent to rDash bulk API</p>
          <pre data-testid="payload-entries" className="max-h-80 overflow-auto px-4 py-2 text-[11px] leading-relaxed text-rd-text">
            {entries ? JSON.stringify({ entries }, null, 2) : "—"}
          </pre>
        </div>
      </div>
    </details>
  );
}
