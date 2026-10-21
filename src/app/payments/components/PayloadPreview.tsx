"use client";

import type { BulkPaymentEntryInput } from "@/types/rdash";
import type { BulkSubmitRequest } from "@/types/payments";
import { useState } from "react";
import { rdButtonPrimary, rdCard, rdTextLink } from "@/components/rd/styles";
import { RdModal } from "./RdModal";

// Mock mode only (CLAUDE.md Data Source Mode): the exact JSON sent.
//  - request: body POSTed to /api/rdash/payment-entries/bulk (buildSubmitRequest)
//  - entries: what the server builds for rDash (buildBulkEntries); the server
//    wraps them per BULK_BODY_WRAPPER (TODO(verify): `{ entries }` vs
//    `{ data: { entries } }`).
interface PreviewProps {
  label: string;
  /** null = nothing valid to send yet. */
  request: BulkSubmitRequest | null;
  entries: BulkPaymentEntryInput[] | null;
}

/** "Payload preview" text link (table title row) → the preview in a modal,
 *  so it never takes space under the table. */
export function PayloadPreviewLink(props: PreviewProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={rdTextLink} onClick={() => setOpen(true)}>
        Payload preview (mock)
      </button>
      <RdModal
        open={open}
        title="Payload preview (mock)"
        testId="payload-preview-modal"
        onClose={() => setOpen(false)}
        footer={
          <button type="button" className={rdButtonPrimary} onClick={() => setOpen(false)}>
            Close
          </button>
        }
      >
        <PayloadPreview {...props} open />
      </RdModal>
    </>
  );
}

export function PayloadPreview({ label, request, entries, open }: PreviewProps & { open?: boolean }) {
  return (
    <details className={rdCard} data-testid="payload-preview" open={open}>
      <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold text-rd-text">
        Payload preview (mock) · {label}
        {request ? ` · ${request.rows.length} ${request.rows.length === 1 ? "row" : "rows"}` : ""}
      </summary>
      <div className="grid border-t border-rd-divider md:grid-cols-2 md:divide-x md:divide-rd-divider">
        <div>
          <p className="px-4 pt-2 text-[11px] font-semibold text-rd-muted">POST /api/rdash/payment-entries/bulk</p>
          <pre data-testid="payload-request" className="max-h-80 overflow-auto px-4 py-2 text-[11px] leading-relaxed text-rd-text">
            {request ? JSON.stringify(request, null, 2) : "—"}
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
