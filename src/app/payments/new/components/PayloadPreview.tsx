"use client";

import type { BulkPaymentEntryInput } from "@/types/rdash";
import type { BulkSubmitRequest } from "@/types/payments";

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
    <details className="rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer select-none px-4 py-2 text-xs font-medium text-gray-700">
        Payload preview (mock) · {label} · {request.rows.length} {request.rows.length === 1 ? "row" : "rows"}
      </summary>
      <div className="grid gap-px border-t border-gray-200 bg-gray-200 md:grid-cols-2">
        <div className="bg-gray-50">
          <p className="px-4 pt-2 text-[11px] font-semibold text-gray-600">POST /api/rdash/payment-entries/bulk</p>
          <pre data-testid="payload-request" className="max-h-80 overflow-auto px-4 py-2 text-[11px] leading-relaxed text-gray-800">
            {JSON.stringify(request, null, 2)}
          </pre>
        </div>
        <div className="bg-gray-50">
          <p className="px-4 pt-2 text-[11px] font-semibold text-gray-600">Entries sent to rDash bulk API</p>
          <pre data-testid="payload-entries" className="max-h-80 overflow-auto px-4 py-2 text-[11px] leading-relaxed text-gray-800">
            {entries ? JSON.stringify({ entries }, null, 2) : "—"}
          </pre>
        </div>
      </div>
    </details>
  );
}
