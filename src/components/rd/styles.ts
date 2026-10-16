// Shared rDash-look class strings (Manage Vendor → Vendor Payments).
// Values come from docs/ui-reference (global-style.css, payment-request
// components) and pixel samples of the reference screenshots — see the
// --rd-* tokens in globals.css and CLAUDE.md "UI Layout".
import { cn } from "@/lib/utils";

/** .bg-white .border .rounded-6 — white box, 1px #c7c8c9 border, 6px radius. */
export const rdCard = "rounded-rd border border-rd-border bg-white";

/** rDash table filter input: #f4f6f9 fill, no border, 22px tall, 3px radius,
 *  12px text, #98a2b3 placeholder. */
export const rdInput =
  "h-[22px] w-full rounded-[3px] border-0 bg-rd-fill px-2 text-[12px] leading-[22px] text-rd-black placeholder:text-rd-placeholder " +
  "outline-none focus:ring-1 focus:ring-rd-red " +
  "disabled:cursor-not-allowed disabled:text-rd-placeholder";

/** Invalid filter input: red ring (rDash .border-red colour). */
export const rdInputError = "ring-1 ring-rd-red";

/** Field label: 12px semibold, like rDash table header labels. */
export const rdLabel = "text-[12px] font-semibold text-rd-black";

/** rDash "text-red" button (e.g. "+ Create Payment Request"): 14px semibold red. */
export const rdTextLink =
  "text-[14px] font-semibold text-rd-red hover:underline underline-offset-2 disabled:cursor-not-allowed disabled:text-rd-disabled disabled:no-underline";

/** Same, 12px — inside table rows next to 22px inputs ("Pay in full"). */
export const rdTextLinkSm = cn(rdTextLink, "text-[12px]");

/** RDLabel variant="contained" color="grey" (.payment-request-count). */
export const rdCountLabel = "inline-flex items-center rounded-[3px] bg-rd-label px-[5px] py-[2px] text-[12px] leading-[15px] text-rd-text";

/** rDash buttons: contained red / outlined red, 14px semibold, 6px radius. */
export const rdButtonPrimary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-rd bg-rd-red px-4 text-[14px] font-semibold text-white hover:bg-[#d41f24] disabled:cursor-not-allowed disabled:opacity-50";
export const rdButtonOutline =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-rd border border-rd-red bg-white px-4 text-[14px] font-semibold text-rd-red hover:bg-rd-row-error disabled:cursor-not-allowed disabled:opacity-50";

export const rdInputCls = (invalid?: boolean, extra?: string) => cn(rdInput, invalid && rdInputError, extra);

/** rDash status text colour (getStatusColor in payment-request-table/row). */
export function rdStatusClass(status: string | null | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "approved":
      return "text-rd-approved";
    case "rejected":
      return "text-rd-rejected";
    case "cancelled":
      return "text-rd-red";
    case "pending":
      return "text-rd-pending";
    case "hold":
      return "text-rd-hold";
    default:
      return "text-rd-black";
  }
}
