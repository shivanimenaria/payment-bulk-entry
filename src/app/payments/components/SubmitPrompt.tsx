"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { SubmitPrompt as Prompt } from "@/lib/payments/submit";
import { paymentDetailsLine, tallyLine } from "@/lib/payments/payment-form";
import { formatCardUnits, formatMoneyUnits } from "@/lib/format";
import { cn } from "@/lib/utils";

// rDash result prompts after Submit on /payments/new, rebuilt from
// docs/ui-reference/rdash-popups/ (RDPrompt / RDButton are a private rDash
// package):
//   success-prompt/style.css — paper: no padding, 12px radius; upper section
//   centred, gap 12px, padding-top 35px, padding-bottom 20px; 52px icon;
//   title 20px Gilroy bold #101828; grey info box (#f4f4f4, 6px radius, 8px
//   padding, full width): 12px #101828 line + 10px #5d5d5d line, small red OK
//   (RDButton small: 6px 18px, 12px); bottom section: 6px 30px padding,
//   border-top #d0d5dd.
//   confirmation-prompt — the warning variant (showIcon): same shell with
//   /rdash/warning-icon.svg.
// TODO(verify): RDPrompt's paper width / side padding are not in the
// reference CSS — 400px (success) / 560px (with the failed-rows table) and
// 30px sides (as the bottom section) are ours.
// Focus is trapped (Radix Dialog); Esc = OK; outside click = OK on the
// success prompt only; while `busy` nothing dismisses it.
const okButton =
  "inline-flex shrink-0 items-center justify-center rounded-rd bg-rd-red px-[18px] py-[6px] text-[12px] font-semibold leading-[16px] text-white outline-none hover:bg-[#d41f24] focus-visible:ring-2 focus-visible:ring-rd-red focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const infoBox = "w-full rounded-[6px] bg-[#f4f4f4] p-2 text-left";
const th = "sticky top-0 whitespace-nowrap bg-[#f4f4f4] px-2 py-1.5 text-left text-[11px] font-semibold text-[#101828]";
const td = "px-2 py-1.5 align-top text-[12px] text-[#101828]";

export const UNCONFIRMED_TITLE = "Could not confirm which payments were recorded";
export const UNCONFIRMED_TEXT = "Please check Payment Entries in rDash before trying again.";

const TITLES: Record<Prompt["kind"], string> = {
  success: "Payment entries recorded successfully",
  partial: "Some payments could not be recorded",
  unconfirmed: UNCONFIRMED_TITLE,
};

export function SubmitPrompt({
  prompt,
  symbol,
  busy = false,
  onOk,
}: {
  prompt: Prompt | null;
  symbol: string | null;
  /** A submit is in flight: OK disabled, Esc / outside click ignored. */
  busy?: boolean;
  onOk: () => void;
}) {
  const ok = () => {
    if (!busy) onOk();
  };
  const success = prompt?.kind === "success";
  const OkButton = (
    <button type="button" data-testid="prompt-ok" className={okButton} disabled={busy} onClick={ok}>
      OK
    </button>
  );
  return (
    <Dialog.Root open={prompt !== null} onOpenChange={(o) => (o ? undefined : ok())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="submit-prompt"
          data-kind={prompt?.kind}
          onOpenAutoFocus={(e) => {
            // Focus OK (not the first table cell / nothing).
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("[data-testid=prompt-ok]")?.focus();
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            ok();
          }}
          onPointerDownOutside={(e) => {
            e.preventDefault();
            if (success) ok();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[12px] bg-white p-0 font-gilroy shadow-xl outline-none",
            prompt?.kind === "partial" ? "max-w-[560px]" : "max-w-[400px]",
          )}
        >
          {prompt ? (
            <>
              <div className="flex min-h-0 flex-col items-center gap-3 px-[30px] pb-5 pt-[35px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- static svg, as rDash's <img> */}
                <img
                  src={success ? "/rdash/project-create-success-tick-icon.svg" : "/rdash/warning-icon.svg"}
                  alt={success ? "Payments recorded" : "Warning"}
                  className="w-[52px] shrink-0"
                />
                <Dialog.Title className="text-center text-[20px] font-bold leading-[1.2] text-[#101828]">
                  {TITLES[prompt.kind]}
                </Dialog.Title>

                {prompt.kind === "success" ? (
                  <div data-testid="prompt-info" className={cn(infoBox, "flex items-center justify-between gap-3")}>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-[#101828]" title={tallyLine(prompt.recorded, symbol)}>
                        {tallyLine(prompt.recorded, symbol)}
                      </div>
                      <div className="truncate text-[10px] text-[#5d5d5d]" title={paymentDetailsLine(prompt.header)}>
                        {paymentDetailsLine(prompt.header)}
                      </div>
                    </div>
                    {OkButton}
                  </div>
                ) : null}

                {prompt.kind === "partial" ? (
                  <>
                    <div data-testid="prompt-info" className={cn(infoBox, "text-[12px] font-medium text-[#101828]")}>
                      <div className="truncate">
                        Recorded: {prompt.recorded.count} · {formatCardUnits(prompt.recorded.amountUnits, symbol)}
                      </div>
                      <div className="truncate">
                        Not recorded: {prompt.notRecorded.count} · {formatCardUnits(prompt.notRecorded.amountUnits, symbol)}
                      </div>
                    </div>
                    <div className="max-h-[200px] w-full overflow-auto rounded-[6px] border border-[#d0d5dd]">
                      <table className="w-full border-collapse" data-testid="failed-table">
                        <thead>
                          <tr>
                            <th className={th}>Request ID</th>
                            <th className={th}>Project</th>
                            <th className={cn(th, "text-right")}>Amount</th>
                            <th className={th}>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {prompt.lines.map((l) => (
                            <tr key={l.paymentRequestId} className="border-t border-[#d0d5dd]">
                              <td className={cn(td, "whitespace-nowrap")}>{l.requestId}</td>
                              <td className={td}>{l.projectName}</td>
                              <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>{formatMoneyUnits(l.amountUnits, symbol)}</td>
                              <td className={cn(td, "text-rd-red")}>{l.error}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}

                {prompt.kind === "unconfirmed" ? (
                  <p data-testid="unconfirmed-message" className="text-center text-[14px] text-[#5d5d5d]">
                    {UNCONFIRMED_TEXT}
                  </p>
                ) : null}
              </div>

              {prompt.kind !== "success" ? (
                <div className="flex shrink-0 items-center justify-end border-t border-[#d0d5dd] px-[30px] py-[6px]">{OkButton}</div>
              ) : null}
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
