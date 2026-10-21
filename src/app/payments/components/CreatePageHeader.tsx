"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-context";

// Page header like the RFQ "Create RFQ" page (docs/ui-reference/rfq-create/
// CreateRfqClient.tsx): white bar, bottom border + shadow, `px-6 h-14`; left
// "←" (ghost icon button) + `text-lg font-bold text-gray-950` title; right
// `gap-3` actions — outlined "Save as Draft" style → Cancel, red "Create &
// Send" style → Submit (brand red from the rDash tokens, not RFQ's #E53935).
// Not sticky: the page has a fixed-height layout (only the table rows
// scroll), so the header never scrolls away. Shows the DEV badge in
// static-token mode.
export function CreatePageHeader({
  title,
  onBack,
  backDisabled,
  actions,
}: {
  title: string;
  onBack: () => void;
  backDisabled?: boolean;
  actions: React.ReactNode;
}) {
  const { authMode } = useSession();
  return (
    <div data-testid="create-header" className="z-20 shrink-0 border-b border-gray-200 bg-white shadow-sm">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            className="-ml-1.5 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
            aria-label="Back to payment requests"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold text-gray-950">{title}</h1>
        </div>
        <div className="flex items-center gap-3">
          {authMode === "static_token" ? (
            <span
              className="rounded-[3px] border border-rd-red bg-white px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-rd-red"
              title="RDASH_AUTH_MODE=static_token — dev only, real rDash data with a static token"
            >
              DEV — REAL DATA
            </span>
          ) : null}
          {actions}
        </div>
      </div>
    </div>
  );
}

/** Outlined header button ("Save as Draft" look). */
CreatePageHeader.Cancel = function Cancel({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="outline" className="h-9 px-4 text-xs font-semibold" disabled={disabled} onClick={onClick}>
      Cancel
    </Button>
  );
};

/** Red header button ("Create & Send" look); spinner while sending. */
CreatePageHeader.Submit = function Submit({
  onClick,
  sending,
  disabled,
}: {
  onClick: () => void;
  sending: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      className={`h-9 bg-rd-red px-4 text-xs font-semibold text-white hover:bg-[#d41f24] ${sending ? "disabled:opacity-100" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      {sending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
      Submit
    </Button>
  );
};
