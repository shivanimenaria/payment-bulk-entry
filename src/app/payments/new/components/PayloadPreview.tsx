"use client";

import type { BulkPaymentEntryInput } from "@/types/rdash";

// Mock mode only (CLAUDE.md Data Source Mode): the exact entries
// buildBulkEntries produces. The server wraps them per BULK_BODY_WRAPPER
// (TODO(verify): `{ entries }` vs `{ data: { entries } }`).
export function PayloadPreview({ entries }: { entries: BulkPaymentEntryInput[] }) {
  return (
    <details className="rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer select-none px-4 py-2 text-xs font-medium text-gray-700">
        Payload preview (mock) · {entries.length} {entries.length === 1 ? "entry" : "entries"}
      </summary>
      <pre className="max-h-80 overflow-auto border-t border-gray-200 bg-gray-50 px-4 py-3 text-[11px] leading-relaxed text-gray-800">
        {JSON.stringify({ entries }, null, 2)}
      </pre>
    </details>
  );
}
