"use client";

import { useSession } from "@/lib/auth-context";

// Optional actions row above the page content. rDash shows the breadcrumb,
// tabs and currency above the iframe, so there is no page title. The MOCK DATA
// badge lives in the mock-only preview frame (RdashPreviewFrame). A session
// error is surfaced as a banner (no silent fallback).
// `left`: optional content on the left. `bannerOnly`: only the session error
// banner (pages with their own header, e.g. /payments/new's Create header,
// which shows the DEV badge itself).
export function PageHeader({
  actions,
  left,
  bannerOnly = false,
}: {
  actions?: React.ReactNode;
  left?: React.ReactNode;
  bannerOnly?: boolean;
}) {
  const { error, authMode } = useSession();
  const dev = authMode === "static_token" && !bannerOnly;
  if (bannerOnly) {
    return error ? (
      <div className="shrink-0 px-6 pt-5">
        <div role="alert" className="rounded-rd border border-rd-border bg-white p-[15px] text-[14px] font-semibold text-rd-red">
          Your session could not be verified. Reopen Bulk Payment from the vendor&apos;s Vendor Payments page in rDash.
        </div>
      </div>
    ) : null;
  }
  if (!actions && !left && !error && !dev) return null;
  return (
    <div className="shrink-0 px-5 pt-5">
      {actions || left || dev ? (
        <div className="flex items-center justify-end gap-3">
          {left ? <div className="mr-auto">{left}</div> : null}
          {actions}
          {dev ? (
            <span
              className="rounded-[3px] border border-rd-red bg-white px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-rd-red"
              title="RDASH_AUTH_MODE=static_token — dev only, real rDash data with a static token"
            >
              DEV — REAL DATA
            </span>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mt-2 rounded-rd border border-rd-border bg-white p-[15px] text-[14px] font-semibold text-rd-red">
          Your session could not be verified. Reopen Bulk Payment from the vendor&apos;s Vendor Payments page in rDash.
        </div>
      ) : null}
    </div>
  );
}
