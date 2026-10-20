"use client";

import { CheckCircle2, AlertTriangle, Loader2, XCircle } from "lucide-react";
import type { BulkSubmitResult } from "@/types/payments";
import { decimalUnits, type Units } from "@/lib/payments/money";
import { formatMoneyUnits, textOrDash } from "@/lib/format";
import { rdButtonPrimary, rdCard, rdCountLabel } from "@/components/rd/styles";
import { cn } from "@/lib/utils";

/** How a submitted row is identified in the lists (from the table at submit time). */
export interface RowLabel {
  requestNumber: string | null;
  projectName: string | null;
}

export type SubmitOutcome =
  | {
      kind: "result";
      result: BulkSubmitResult;
      amounts: Map<string, Units>;
      labels: Map<string, RowLabel>;
      /** Rows' currency symbol at submit time (null = none / mixed). */
      symbol: string | null;
    }
  | { kind: "rejected"; summary: string[] }
  | { kind: "error"; message: string };

function Lines({
  items,
  amounts,
  labels,
  removed,
  tone,
  symbol,
}: {
  symbol: string | null;
  items: { payment_request_id: string; error?: string }[];
  amounts: Map<string, Units>;
  labels: Map<string, RowLabel>;
  removed?: Set<string>;
  tone: "ok" | "fail";
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-rd-muted">
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
            <tr key={it.payment_request_id} className="border-t border-rd-divider">
              <td className="py-1.5 pr-4 font-semibold text-rd-text">{textOrDash(labels.get(it.payment_request_id)?.requestNumber)}</td>
              <td className="py-1.5 pr-4 text-rd-text">{textOrDash(labels.get(it.payment_request_id)?.projectName)}</td>
              <td className="py-1.5 pr-4 text-right tabular-nums text-rd-text">{formatMoneyUnits(p ?? null, symbol)}</td>
              {tone === "fail" ? (
                <td className="py-1.5 text-rd-red">
                  {it.error || "Not recorded"}
                  {removed?.has(it.payment_request_id) ? (
                    <span className={cn(rdCountLabel, "ml-2")}>Removed — won&apos;t be retried</span>
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
      <section role="alert" aria-label="Submit result" className={cn(rdCard, "flex items-start gap-2 p-[15px] text-[14px] font-semibold text-rd-red")}>
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{outcome.message}</p>
      </section>
    );
  }
  if (outcome.kind === "rejected") {
    return (
      <section role="alert" aria-label="Submit result" className={cn(rdCard, "p-[15px] text-[14px] text-rd-red")}>
        <p className="flex items-center gap-2 font-semibold">
          <XCircle className="h-4 w-4" /> Nothing was recorded — the server rejected this submission.
        </p>
        {outcome.summary.length > 0 ? (
          <ul className="mt-1 list-disc pl-6 text-xs text-rd-text">
            {outcome.summary.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  const { result, amounts, labels, symbol: currencySymbol } = outcome;
  if (result.failed.length === 0) {
    return (
      <section role="status" aria-label="Submit result" className={cn(rdCard, "flex items-center gap-2 p-[15px] text-[14px] text-rd-text")}>
        <CheckCircle2 className="h-4 w-4 shrink-0 text-rd-approved" />
        <p className="font-semibold">
          {result.created.length} {result.created.length === 1 ? "payment" : "payments"} recorded · {formatMoneyUnits(decimalUnits(result.recordedAmount), currencySymbol)}
        </p>
      </section>
    );
  }
  return (
    <section role="alert" aria-label="Submit result" className={cn(rdCard, "p-[15px]")}>
      <div className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-rd-text">
          <AlertTriangle className="h-4 w-4 text-rd-pending" />
          {formatMoneyUnits(decimalUnits(result.recordedAmount), currencySymbol)} recorded, {formatMoneyUnits(decimalUnits(result.notRecordedAmount), currencySymbol)} NOT recorded
        </p>
        <button
          type="button"
          onClick={onRetryFailed}
          disabled={busy || !canRetry}
          className={rdButtonPrimary}
        >
          {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Retry failed
        </button>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className={cn(rdCard, "p-3")}>
          <p className="mb-1 text-xs font-semibold text-rd-approved">Recorded ({result.created.length})</p>
          {result.created.length ? (
            <Lines items={result.created} amounts={amounts} labels={labels} tone="ok" symbol={currencySymbol} />
          ) : (
            <p className="text-xs text-rd-muted">None</p>
          )}
        </div>
        <div className={cn(rdCard, "p-3")}>
          <p className="mb-1 text-xs font-semibold text-rd-red">Not recorded ({result.failed.length})</p>
          <Lines items={result.failed} amounts={amounts} labels={labels} removed={removed} tone="fail" symbol={currencySymbol} />
        </div>
      </div>
    </section>
  );
}
