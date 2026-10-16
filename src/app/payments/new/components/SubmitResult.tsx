"use client";

import { CheckCircle2, AlertTriangle, Loader2, XCircle } from "lucide-react";
import type { BulkSubmitResult } from "@/types/payments";
import { fromPaise } from "@/lib/payments/money";
import { formatINR, textOrDash } from "@/lib/format";

/** How a submitted row is identified in the lists (from the table at submit time). */
export interface RowLabel {
  requestNumber: string | null;
  projectName: string | null;
}

export type SubmitOutcome =
  | { kind: "result"; result: BulkSubmitResult; amounts: Map<string, number>; labels: Map<string, RowLabel> }
  | { kind: "rejected"; summary: string[] }
  | { kind: "error"; message: string };

function Lines({
  items,
  amounts,
  labels,
  removed,
  tone,
}: {
  items: { payment_request_id: string; error?: string }[];
  amounts: Map<string, number>;
  labels: Map<string, RowLabel>;
  removed?: Set<string>;
  tone: "ok" | "fail";
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1 pr-4 font-medium">Request ID</th>
          <th className="py-1 pr-4 font-medium">Project</th>
          <th className="py-1 pr-4 text-right font-medium">Amount</th>
          {tone === "fail" ? <th className="py-1 font-medium">Error</th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const p = amounts.get(it.payment_request_id);
          return (
            <tr key={it.payment_request_id} className="border-t border-gray-100">
              <td className="py-1 pr-4 font-medium text-gray-900">{textOrDash(labels.get(it.payment_request_id)?.requestNumber)}</td>
              <td className="py-1 pr-4 text-gray-700">{textOrDash(labels.get(it.payment_request_id)?.projectName)}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{formatINR(p === undefined ? null : fromPaise(p))}</td>
              {tone === "fail" ? (
                <td className="py-1 text-red-700">
                  {it.error || "Not recorded"}
                  {removed?.has(it.payment_request_id) ? (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">Removed — won&apos;t be retried</span>
                  ) : null}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Result panel under the table.
export function SubmitResult({
  outcome,
  retrying,
  busy,
  canRetry,
  removed,
  onRetryFailed,
}: {
  outcome: SubmitOutcome;
  retrying: boolean;
  /** Any submit in flight. */
  busy: boolean;
  /** At least one failed entry is still retryable (not removed). */
  canRetry: boolean;
  removed: Set<string>;
  onRetryFailed: () => void;
}) {
  if (outcome.kind === "error") {
    return (
      <section role="alert" aria-label="Submit result" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{outcome.message}</p>
      </section>
    );
  }
  if (outcome.kind === "rejected") {
    return (
      <section role="alert" aria-label="Submit result" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <p className="flex items-center gap-2 font-semibold">
          <XCircle className="h-4 w-4" /> Nothing was recorded — the server rejected this submission.
        </p>
        {outcome.summary.length > 0 ? (
          <ul className="mt-1 list-disc pl-6 text-xs">
            {outcome.summary.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  const { result, amounts, labels } = outcome;
  if (result.failed.length === 0) {
    return (
      <section role="status" aria-label="Submit result" className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <p className="font-semibold">
          {result.created.length} {result.created.length === 1 ? "payment" : "payments"} recorded · {formatINR(result.recordedAmount)}
        </p>
      </section>
    );
  }
  return (
    <section role="alert" aria-label="Submit result" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          {formatINR(result.recordedAmount)} recorded, {formatINR(result.notRecordedAmount)} NOT recorded
        </p>
        <button
          type="button"
          onClick={onRetryFailed}
          disabled={busy || !canRetry}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Retry failed
        </button>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <p className="mb-1 text-xs font-semibold text-green-800">Recorded ({result.created.length})</p>
          {result.created.length ? (
            <Lines items={result.created} amounts={amounts} labels={labels} tone="ok" />
          ) : (
            <p className="text-xs text-gray-500">None</p>
          )}
        </div>
        <div className="rounded-md border border-red-200 bg-white p-3">
          <p className="mb-1 text-xs font-semibold text-red-800">Not recorded ({result.failed.length})</p>
          <Lines items={result.failed} amounts={amounts} labels={labels} removed={removed} tone="fail" />
        </div>
      </div>
    </section>
  );
}
