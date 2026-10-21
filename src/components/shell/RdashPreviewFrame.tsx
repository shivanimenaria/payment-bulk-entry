"use client";

import {
  Bell,
  BriefcaseBusiness,
  ChartLine,
  ChevronDown,
  CircleCheck,
  CircleCheckBig,
  CircleHelp,
  Columns3,
  Factory,
  FileChartColumn,
  Layers,
  MonitorDot,
  Settings,
  UserRound,
  UserSearch,
  type LucideIcon,
} from "lucide-react";
import { RdStepper } from "@/components/rd/RdStepper";
import { useSession } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

// MOCK MODE ONLY — a static, non-interactive copy of rDash's chrome around the
// page (03-rdash-sidebar.png, 02-rdash-header-tabs.png), so the mock preview
// looks like PBE inside rDash's Manage Vendor → Vendor Payments screen. In real
// mode it never renders: rDash itself draws all of this around the iframe.
// Purely visual: no links, no handlers, aria-hidden.
//
// Mock vendor name = the mock fixtures' vendor ("Shree Ganesh Builders").
const MOCK_VENDOR_NAME = "Shree Ganesh Builders";

const SIDEBAR: { Icon: LucideIcon; active?: boolean }[] = [
  { Icon: MonitorDot },
  { Icon: ChartLine },
  { Icon: Columns3 },
  { Icon: BriefcaseBusiness },
  { Icon: CircleCheckBig },
  { Icon: FileChartColumn },
  { Icon: Layers },
  { Icon: UserSearch },
  { Icon: Factory, active: true },
  { Icon: UserRound },
  { Icon: Settings },
];

const VENDOR_TABS = ["Basic Details", "Billing Entity", "Vendor Users", "Vendor Invoices", "Vendor Payments"];
const SUB_TABS = ["All Requests", "Pending Requests", "Approved Requests", "Payment Due", "Payment Entries", "Bulk Payment Entry"];

function RdashLogo() {
  return (
    <div className="relative h-[42px] w-[44px]">
      <span className="absolute bottom-0 left-0 text-[38px] font-extrabold italic leading-none text-[#1d1d1b]">R</span>
      <svg viewBox="0 0 12 20" className="absolute right-0 top-0 h-[26px] w-[15px]" fill="var(--rd-red)">
        <path d="M8 0L1 11h4.5L3 20l8-12H6.5L9 0z" />
      </svg>
    </div>
  );
}

export function RdashPreviewFrame({ children }: { children: React.ReactNode }) {
  const { dataSource, displayName } = useSession();
  if (dataSource !== "mock") return <>{children}</>;

  return (
    <div data-rdash-preview-frame="" className="flex min-h-0 flex-1 overflow-hidden bg-rd-page">
      {/* Left icon sidebar (static) */}
      <aside aria-hidden="true" className="flex h-full w-[72px] shrink-0 flex-col items-center self-stretch overflow-hidden border-r border-rd-border bg-white">
        <div className="flex h-[58px] items-center">
          <RdashLogo />
        </div>
        <div className="mt-[14px] flex flex-col items-center gap-[11px]">
          {SIDEBAR.map(({ Icon, active }, i) => (
            <span
              key={i}
              className={cn("flex h-[39px] w-[39px] items-center justify-center rounded-rd", active ? "bg-rd-red text-white" : "text-rd-text")}
            >
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
            </span>
          ))}
        </div>
        <div className="sticky bottom-0 mt-auto flex flex-col items-center gap-[18px] bg-white pb-[18px]">
          <span className="h-px w-[27px] bg-rd-border" />
          <CircleHelp className="h-[22px] w-[22px] text-rd-text" strokeWidth={1.75} />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div aria-hidden="true" className="shrink-0">
          {/* Header: breadcrumb + icons + user pill */}
          <header className="flex h-[58px] items-center justify-between border-b border-rd-border bg-white px-5">
            <p className="truncate text-rd-black">
              <span className="text-[17px]">All Vendors/</span>
              <span className="text-[18px] font-bold">{MOCK_VENDOR_NAME}</span>
            </p>
            <div className="flex items-center gap-[14px]">
              <CircleCheck className="h-6 w-6 text-black" strokeWidth={2} />
              <Bell className="h-6 w-6 text-black" strokeWidth={1.75} />
              <span className="flex h-[34px] items-center gap-2 rounded-full border border-rd-border py-1 pl-1 pr-3">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[#d27f64] text-[14px] text-white">
                  {(displayName || "U").charAt(0).toUpperCase()}
                </span>
                <span className="text-[16px] font-semibold text-black">{displayName || "User"}</span>
                <ChevronDown className="h-3 w-3 text-black" strokeWidth={3} />
              </span>
            </div>
          </header>
          {/* Vendor tabs + currency */}
          {/* rDash's own "Currency : …" selector is omitted here: PBE has its
              own currency filter (top-right of the page). */}
          <RdStepper items={VENDOR_TABS.map((t) => ({ key: t, label: t, active: t === "Vendor Payments" }))} />
          {/* Vendor Payments sub-tabs, Bulk Payment Entry active */}
          <div className="px-5 pt-5">
            <div className="overflow-hidden rounded-rd border border-rd-border bg-white">
              <RdStepper
                items={SUB_TABS.map((t) => ({ key: t, label: t, active: t === "Bulk Payment Entry" }))}
                className="shadow-none"
                right={
                  <span
                    className="rounded-[3px] border border-rd-pending px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-rd-pending"
                    title="RDASH_DATA_SOURCE=mock — data is not from rDash"
                  >
                    Mock data
                  </span>
                }
              />
            </div>
          </div>
        </div>
        {/* The PBE page = what the iframe shows in real mode */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
