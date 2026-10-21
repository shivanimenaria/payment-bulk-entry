"use client";
import { apiFetch } from "@/lib/api-fetch";

import React, { useState, useMemo, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { useRouter } from "next/navigation";
import { useAuth, useCurrency } from "@/lib/auth-context";
import { formatMoney } from "@/lib/currency";
import { useFeatures } from "@/features/use-features";
import Link from "next/link";
import {
  MoreVertical,
  Pencil,
  Copy,
  Bell,
  XCircle,
  CheckCircle2,
  Clock,
  FileText,
  Send,
  ExternalLink,
  X,
  Loader2,
  MessageSquare,
  Power,
} from "lucide-react";
import { RfqListRow, ProjectRevisionRequestRow } from "@/types/db";
import { useUI, flashToast } from "@/components/ui/toast-confirm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";

// --------------- helpers ---------------

// `YYYY-MM-DD` in the user's local timezone — matches what <input type="date">
// emits and what the user sees in the formatted column. Using toISOString()
// here would drift by a day for any row close to midnight UTC.
function toLocalDateKey(iso: string | Date | null | undefined): string {
  if (iso === null || iso === undefined) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDate(iso: string | Date | null | undefined): string {
  if (iso === null || iso === undefined) return "—";
  // Accept both ISO strings (browser/JSON) and Date objects (pg returns these
  // and React Server Components can pass them through unchanged).
  let d: Date;
  if (iso instanceof Date) {
    d = iso;
  } else if (typeof iso === "string") {
    if (!iso.trim()) return "—";
    d = new Date(iso);
  } else {
    return "—";
  }
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatRfqType(type: string): string {
  return type === "open" ? "Open Book" : "Closed Book";
}

const STATUS_MAP: Record<string, { label: string; className: string; dot: string }> = {
  draft: { label: "Draft", className: "bg-gray-50 text-gray-600 border-gray-200", dot: "bg-gray-400" },
  sent: { label: "Sent", className: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  in_progress: { label: "In Progress", className: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  under_review: { label: "Under Review", className: "bg-teal-50 text-teal-700 border-teal-200", dot: "bg-teal-500" },
  shortlisted: { label: "Shortlisted", className: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  pending_approval: { label: "Pending Approval", className: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  approved: { label: "Approved", className: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
  awarded: { label: "Awarded", className: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
  closed: { label: "Closed", className: "bg-gray-50 text-gray-600 border-gray-200", dot: "bg-gray-400" },
};

function statusInfo(status: string) {
  return STATUS_MAP[status] ?? { label: status, className: "bg-gray-50 text-gray-600 border-gray-200", dot: "bg-gray-400" };
}

function deadlineDisplay(deadline: string | Date | null | undefined): { text: string; className: string; icon?: boolean } {
  if (deadline === null || deadline === undefined) return { text: "-", className: "text-gray-400" };

  const now = new Date();
  const dl = deadline instanceof Date ? deadline : new Date(deadline);
  if (isNaN(dl.getTime())) return { text: "-", className: "text-gray-400" };
  const diffMs = dl.getTime() - now.getTime();

  // Always show the date itself; vary colour by urgency.
  const text = formatDate(deadline);
  if (diffMs <= 0) return { text, className: "text-red-600 font-medium", icon: true };

  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 1) return { text, className: "text-red-600 font-medium", icon: true };
  if (diffDays < 3) return { text, className: "text-orange-600 font-medium", icon: true };
  return { text, className: "text-gray-500" };
}

// --------------- component ---------------

export default function RfqListClient({ rfqs, revisionRequests: initialRevisionRequests, canDuplicate = true, errorCode = null }: { rfqs: RfqListRow[]; revisionRequests: ProjectRevisionRequestRow[]; canDuplicate?: boolean; errorCode?: string | null }) {
  const router = useRouter();
  const { buildUrl } = useAuth();
  const { currency } = useCurrency();
  // Compact, project-currency amounts (no decimals) for the list/cards.
  const formatINR = (amount: number) =>
    formatMoney(amount, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const features = useFeatures();
  const { toast, confirm } = useUI();
  const [globalSearch] = useState("");
  const [mounted, setMounted] = useState(false);

  // Surface a toast when /rfp/create redirected here because the user lacks
  // an rDash permission required by the duplicate flow. Fires once per mount;
  // the URL param sticks but the toast doesn't replay on a re-render.
  const errorShownRef = useRef(false);
  useEffect(() => {
    if (errorShownRef.current) return;
    if (errorCode === "no_order_access") {
      errorShownRef.current = true;
      toast(
        "You don't have permission to access vendor orders. Ask your admin for vendor order access.",
        "error"
      );
    } else if (errorCode === "no_vendor_access") {
      errorShownRef.current = true;
      toast(
        "You don't have permission to manage vendors. Ask your admin for vendor management access.",
        "error"
      );
    }
  }, [errorCode, toast]);

  useEffect(() => setMounted(true), []);

  // Revision requests state
  const [showRevisionPanel, setShowRevisionPanel] = useState(false);
  const [revisionRequests, setRevisionRequests] = useState(initialRevisionRequests);
  const [revisionActionLoading, setRevisionActionLoading] = useState<string | null>(null);
  const [revStatusTab, setRevStatusTab] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [revFilterRfq, setRevFilterRfq] = useState<string[]>([]);
  const [revFilterVendor, setRevFilterVendor] = useState<string[]>([]);
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);

  const pendingRevCount = useMemo(() => revisionRequests.filter((r) => r.status === "pending").length, [revisionRequests]);

  const revRfqOptions = useMemo(() => Array.from(new Set(revisionRequests.map((r) => r.rfq_no))).sort(), [revisionRequests]);
  const revVendorOptions = useMemo(() => Array.from(new Set(revisionRequests.map((r) => r.vendor_name))).sort(), [revisionRequests]);

  const filteredRevisionRequests = useMemo(() => {
    return revisionRequests.filter((r) => {
      if (revStatusTab !== "all" && r.status !== revStatusTab) return false;
      if (revFilterRfq.length > 0 && !revFilterRfq.includes(r.rfq_no)) return false;
      if (revFilterVendor.length > 0 && !revFilterVendor.includes(r.vendor_name)) return false;
      return true;
    });
  }, [revisionRequests, revStatusTab, revFilterRfq, revFilterVendor]);

  async function handleRevisionAction(requestId: string, rfqId: string, action: "approve" | "reject") {
    setRevisionActionLoading(requestId);
    try {
      const res = await apiFetch(`/api/rfq/${rfqId}/revision-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error || "Action failed", "error"); return; }
      toast(action === "approve" ? "Revision approved — vendor can now resubmit" : "Revision request rejected", "success");
      setRevisionRequests((prev) => prev.map((r) => r.id === requestId ? { ...r, status: action === "approve" ? "approved" : "rejected", resolved_at: new Date().toISOString() } : r));
    } catch { toast("Action failed", "error"); } finally { setRevisionActionLoading(null); }
  }

  // Column filters
  const [fRfqNo, setFRfqNo] = useState<string[]>([]);
  const [fName, setFName] = useState<string[]>([]);
  const [fType, setFType] = useState<string[]>([]);
  const [fOrderType, setFOrderType] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fCreatedFrom, setFCreatedFrom] = useState("");
  const [fDeadlineTo, setFDeadlineTo] = useState("");
  const [activeStatusTab, setActiveStatusTab] = useState("all");

  // Sorting
  const rfqNoOptions = useMemo(() => Array.from(new Set(rfqs.map((r) => r.rfq_no))).sort(), [rfqs]);
  const nameOptions = useMemo(() => Array.from(new Set(rfqs.map((r) => r.rfq_name))).sort(), [rfqs]);
  const typeOptions = useMemo(() => Array.from(new Set(rfqs.map((r) => formatRfqType(r.rfq_type)))), [rfqs]);
  const orderTypeOptions = useMemo(() => Array.from(new Set(rfqs.map((r) => r.rfq_order_type).filter(Boolean) as string[])), [rfqs]);
  const statusOptions = useMemo(() => Array.from(new Set(rfqs.map((r) => statusInfo(r.status).label))), [rfqs]);

  async function handleSendRfq(rfqId: string) {
    if (!(await confirm({ title: "Send RFQ", message: "Send this RFQ to all vendors? This starts the deadline countdown." }))) return;
    try {
      const res = await apiFetch(`/api/rfq/${rfqId}/send`, { method: "POST" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast(d.error || "Failed", "error"); return; }
      flashToast("RFQ sent to vendors", "success");
      window.location.reload();
    } catch { toast("Failed to send", "error"); }
  }

  async function handleSendReminder(rfqId: string, rfqName: string) {
    if (!(await confirm({ title: "Send Reminder", message: `Send reminder to all pending vendors for "${rfqName}"?` }))) return;
    try {
      const res = await apiFetch(`/api/rfq/${rfqId}/reminder`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast(data.error || "Failed to send", "error"); return; }
      toast(`Reminders sent to ${data.sent} vendor(s)`, "success");
    } catch { toast("Failed to send reminders", "error"); }
  }

  function handleDuplicate(rfqId: string) {
    router.push(buildUrl(`/rfp/create?duplicate=${rfqId}`));
  }

  async function handleCloseRfq(rfqId: string, rfqName: string) {
    if (!(await confirm({ title: "Close RFQ", message: `Close "${rfqName}"? All pending vendors will be expired and no more bids will be accepted.`, confirmLabel: "Close RFQ", variant: "danger" }))) return;
    try {
      const res = await apiFetch(`/api/rfq/${rfqId}`, { method: "PUT" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast(d.error || "Failed to close", "error"); return; }
      flashToast("RFQ closed", "success");
      window.location.reload();
    } catch { toast("Failed to close RFQ", "error"); }
  }

  async function handleDeleteRfq(rfqId: string, rfqName: string) {
    if (!(await confirm({ title: "Delete RFQ", message: `Permanently delete "${rfqName}"? This cannot be undone.`, confirmLabel: "Delete", variant: "danger" }))) return;
    try {
      const res = await apiFetch(`/api/rfq/${rfqId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast(d.error || "Failed to delete", "error"); return; }
      // Persist toast across the reload — plain toast() would be wiped
      // when window.location.reload() fires.
      flashToast("RFQ deleted successfully", "success");
      window.location.reload();
    } catch { toast("Failed to delete RFQ", "error"); }
  }

  // Stats — value based
  const stats = useMemo(() => {
    const allRfqs = rfqs;
    const floated = allRfqs.filter((r) => ["sent", "in_progress", "under_review", "shortlisted"].includes(r.status));
    const pending = allRfqs.filter((r) => ["shortlisted", "under_review"].includes(r.status));
    const awarded = allRfqs.filter((r) => ["approved", "awarded"].includes(r.status));

    const sumTarget = (list: typeof rfqs) => list.reduce((s, r) => s + Number(r.target_amount || 0), 0);
    // Awarded value uses the approved vendors' actual bid totals
    // (rfq_approvals.selected_vendor_id → rfq_vendor_submissions.total_amount),
    // not the pre-bid target_amount, so the chip shows what the buyer
    // committed to rather than what they hoped to spend.
    const sumAwarded = (list: typeof rfqs) => list.reduce((s, r) => s + Number(r.awarded_amount || 0), 0);

    return {
      totalCount: allRfqs.length,
      totalValue: sumTarget(allRfqs),
      floatedCount: floated.length,
      floatedValue: sumTarget(floated),
      pendingCount: pending.length,
      pendingValue: sumTarget(pending),
      awardedCount: awarded.length,
      awardedValue: sumAwarded(awarded),
    };
  }, [rfqs]);

  // Esc to close panels
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && showRevisionPanel) setShowRevisionPanel(false);
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [showRevisionPanel]);

  const filtered = useMemo((): RfqListRow[] => {
    return rfqs.filter((r) => {
      // Global search
      if (globalSearch) {
        const q = globalSearch.toLowerCase();
        if (!(r.rfq_no.toLowerCase().includes(q) || r.rfq_name.toLowerCase().includes(q) || statusInfo(r.status).label.toLowerCase().includes(q) || formatRfqType(r.rfq_type).toLowerCase().includes(q))) return false;
      }
      // Status tab filter
      if (activeStatusTab !== "all") {
        const statusMap: Record<string, string[]> = {
          draft: ["draft"],
          sent: ["sent"],
          in_progress: ["in_progress"],
          shortlisted: ["shortlisted", "under_review"],
          approved: ["approved"],
          awarded: ["awarded"],
        };
        if (statusMap[activeStatusTab] && !statusMap[activeStatusTab].includes(r.status)) return false;
      }
      // Column filters
      if (fRfqNo.length > 0 && !fRfqNo.includes(r.rfq_no)) return false;
      if (fName.length > 0 && !fName.includes(r.rfq_name)) return false;
      if (fType.length > 0 && !fType.includes(formatRfqType(r.rfq_type))) return false;
      if (fOrderType.length > 0 && (!r.rfq_order_type || !fOrderType.includes(r.rfq_order_type))) return false;
      if (fStatus.length > 0 && !fStatus.includes(statusInfo(r.status).label)) return false;
      // Exact-date match for both filters: pick "10 May" → show only RFQs
      // created (or due) on 10 May, not "from then on" or "up to then".
      // The <input type="date"> emits the user's *local* calendar date, but
      // toISOString() converts to UTC — in IST (+5:30) that shifts late-evening
      // rows back a day and the filter silently matches nothing. Compare in
      // local time on both sides instead.
      if (fCreatedFrom) {
        if (!r.created_at) return false;
        if (toLocalDateKey(r.created_at) !== fCreatedFrom) return false;
      }
      if (fDeadlineTo) {
        if (!r.deadline) return false;
        if (toLocalDateKey(r.deadline) !== fDeadlineTo) return false;
      }
      return true;
    });
  }, [rfqs, globalSearch, activeStatusTab, fRfqNo, fName, fType, fOrderType, fStatus, fCreatedFrom, fDeadlineTo]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* ===== Stat Cards (fixed) ===== */}
      <div className="flex-shrink-0 w-full px-3 sm:px-6 pt-3 sm:pt-4 pb-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          <ValueCard label="Total RFQ Value" count={stats.totalCount} value={stats.totalValue} icon={<FileText className="h-4 w-4" />} info="Sum of target amounts across all RFQs (Draft + Sent + Active + Completed)" />
          <ValueCard label="Floated RFQ Value" count={stats.floatedCount} value={stats.floatedValue} icon={<Send className="h-4 w-4" />} info="Sum of target amounts for RFQs that have been sent to vendors and are actively collecting bids" />
          <ValueCard label="Pending Approval" count={stats.pendingCount} value={stats.pendingValue} icon={<Clock className="h-4 w-4" />} info="Sum of target amounts for RFQs that are shortlisted or under review, waiting for final approval" />
          <ValueCard label="Awarded Value" count={stats.awardedCount} value={stats.awardedValue} icon={<CheckCircle2 className="h-4 w-4" />} info="Sum of approved vendors' bid totals across awarded RFQs" />

          {/* Revision Requests Card */}
          <button
            onClick={() => { setShowRevisionPanel(true); setRevStatusTab(pendingRevCount > 0 ? "pending" : "all"); }}
            className={`bg-white rounded-xl border px-5 py-4 shadow-sm text-left transition-colors ${pendingRevCount > 0 ? "border-orange-200 hover:border-orange-300 hover:shadow-md cursor-pointer" : "border-gray-200 hover:border-gray-300 hover:shadow-md cursor-pointer"}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-orange-400"><MessageSquare className="h-4 w-4" /></span>
              <span className="text-xs font-medium tracking-wide uppercase text-gray-500">Revision Requests</span>
              <span className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-medium rounded-full ${pendingRevCount > 0 ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-400"}`}>
                {pendingRevCount}
              </span>
            </div>
            <p className="text-xl font-semibold text-gray-900">
              {pendingRevCount > 0 ? (
                <span className="text-orange-600">{pendingRevCount} pending</span>
              ) : (
                <span className="text-gray-400">None</span>
              )}
            </p>
          </button>
        </div>
      </div>

      {/* ===== Revision Requests Panel ===== */}
      {showRevisionPanel && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4" onClick={() => setShowRevisionPanel(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white rounded-xl shadow-2xl border w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">Revision Requests</h2>
                {pendingRevCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-medium rounded-full bg-orange-500 text-white">
                    {pendingRevCount} pending
                  </span>
                )}
              </div>
              <button onClick={() => setShowRevisionPanel(false)} className="p-1 rounded hover:bg-gray-100">
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>

            {/* Status Tabs + Filters */}
            <div className="flex items-center justify-between px-6 py-2 border-b flex-shrink-0">
              <div className="flex items-center gap-0">
                {([
                  ["all", "All", revisionRequests.length],
                  ["pending", "Pending", revisionRequests.filter((r) => r.status === "pending").length],
                  ["approved", "Approved", revisionRequests.filter((r) => r.status === "approved").length],
                  ["rejected", "Rejected", revisionRequests.filter((r) => r.status === "rejected").length],
                ] as [string, string, number][]).map(([key, label, count]) => (
                  <button
                    key={key}
                    onClick={() => setRevStatusTab(key as typeof revStatusTab)}
                    className={`px-3 py-2 text-xs font-medium tracking-wide border-b-2 -mb-px transition-colors ${
                      revStatusTab === key
                        ? "border-[#E53935] text-[#E53935]"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {label} <span className="text-xs text-gray-400 ml-0.5">({count})</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto min-h-0">
              <Table className="min-w-max">
                <TableHeader className="sticky top-0 z-10 bg-gray-50">
                  {/* Merged header — column label + filter chip in the same cell. */}
                  <TableRow className="border-b border-gray-200 [&>th]:bg-gray-50 [&>th]:border-0 [&>th]:py-2 [&>th]:px-2 [&>th]:align-top">
                    <TableHead className="w-10 pl-6">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Sr</div>
                        {(() => {
                          const filtersActive = revFilterRfq.length > 0 || revFilterVendor.length > 0;
                          const cls = filtersActive ? "text-[#E53935]" : "text-gray-400";
                          const fill = filtersActive ? "currentColor" : "none";
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                if (!filtersActive) return;
                                setRevFilterRfq([]); setRevFilterVendor([]);
                              }}
                              title={filtersActive ? "Clear all filters" : "Filters"}
                              className={`inline-flex items-center justify-center h-7 ${filtersActive ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                            >
                              <svg className={`h-3.5 w-3.5 ${cls}`} fill={fill} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                              </svg>
                            </button>
                          );
                        })()}
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[140px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">RFQ No</div>
                        <MultiSelectFilter options={revRfqOptions} selected={revFilterRfq} onChange={setRevFilterRfq} />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[160px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Vendor</div>
                        <MultiSelectFilter options={revVendorOptions} selected={revFilterVendor} onChange={setRevFilterVendor} />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[90px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Version</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[100px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Status</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[130px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Requested</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right min-w-[110px]">
                      <div className="flex flex-col gap-1.5 items-end">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Last Bid</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[60px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Message</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right min-w-[180px] pr-6">
                      <div className="flex flex-col gap-1.5 items-end">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Actions</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRevisionRequests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-gray-400 py-12">
                        {revisionRequests.length === 0 ? "No revision requests yet" : "No requests match the selected filters"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRevisionRequests.map((req, idx) => (
                      <React.Fragment key={req.id}>
                        <TableRow className={`${req.status === "pending" ? "bg-orange-50/20" : ""} hover:bg-gray-50/50`}>
                          <TableCell className="pl-6 text-xs text-gray-400">{idx + 1}</TableCell>
                          <TableCell>
                            <Link href={buildUrl(`/rfp/${req.rfq_id}?tab=submissions`)} className="text-xs font-medium text-blue-600 hover:text-blue-800" onClick={() => setShowRevisionPanel(false)}>
                              {req.rfq_no}
                            </Link>
                            <div className="text-xs text-gray-400 truncate max-w-[120px]">{req.rfq_name}</div>
                          </TableCell>
                          <TableCell className="text-sm font-normal">{req.vendor_name}</TableCell>
                          <TableCell>
                            {req.latest_version ? <Badge variant="secondary" className="text-xs font-medium">{req.latest_version}</Badge> : <span className="text-xs text-gray-400">—</span>}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={
                              req.status === "pending" ? "bg-orange-100 text-orange-700 border-orange-200" :
                              req.status === "approved" ? "bg-green-100 text-green-700 border-green-200" :
                              "bg-red-100 text-red-700 border-red-200"
                            }>
                              {req.status === "pending" ? "Pending" : req.status === "approved" ? "Approved" : "Rejected"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {new Date(req.requested_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            <div className="text-xs text-gray-400">{new Date(req.requested_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
                          </TableCell>
                          <TableCell className="text-xs text-right font-medium tabular-nums">
                            {req.total_amount != null ? formatINR(req.total_amount) : "—"}
                          </TableCell>
                          <TableCell>
                            {req.vendor_message ? (
                              <button
                                onClick={() => setExpandedMessage(expandedMessage === req.id ? null : req.id)}
                                className="text-blue-500 hover:text-blue-700"
                                title="View message"
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            {req.status === "pending" ? (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs font-medium tracking-wide px-2.5 text-red-600 border-red-200 hover:bg-red-50"
                                  disabled={revisionActionLoading === req.id}
                                  onClick={() => handleRevisionAction(req.id, req.rfq_id, "reject")}
                                >
                                  {revisionActionLoading === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reject"}
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs font-medium tracking-wide px-2.5 bg-green-600 hover:bg-green-700 text-white"
                                  disabled={revisionActionLoading === req.id}
                                  onClick={() => handleRevisionAction(req.id, req.rfq_id, "approve")}
                                >
                                  {revisionActionLoading === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Allow Revision"}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">
                                {req.status === "approved" ? "Approved" : "Rejected"}{req.resolved_at ? ` · ${new Date(req.resolved_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : ""}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                        {/* Expanded message row */}
                        {expandedMessage === req.id && req.vendor_message && (
                          <TableRow className="bg-blue-50/30">
                            <TableCell />
                            <TableCell colSpan={8} className="py-2 pr-6">
                              <div className="text-sm text-gray-700 bg-white rounded border px-3 py-2 max-w-2xl">
                                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-0.5">Vendor Message</span>
                                {req.vendor_message}
                              </div>
                              {req.buyer_message && req.status !== "pending" && (
                                <div className="text-sm text-gray-600 bg-gray-50 rounded border px-3 py-2 mt-1.5 max-w-2xl">
                                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 block mb-0.5">Your Response</span>
                                  {req.buyer_message}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-6 py-3 border-t bg-gray-50/50 text-xs text-gray-500">
              Showing {filteredRevisionRequests.length} of {revisionRequests.length} requests
            </div>
          </div>
        </div>
      )}

      {/* ===== Status Tabs ===== */}
      <div className="flex-shrink-0 w-full px-6">
        <div className="flex items-center border-b border-gray-200">
          <div className="flex items-center gap-0">
            {([
              ["all", "All RFQs"],
              ["draft", "Draft"],
              ["sent", "Sent"],
              ["in_progress", "In Progress"],
              ["shortlisted", "Shortlisted"],
              ["approved", "Approved"],
              ["awarded", "Awarded"],
            ] as [string, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveStatusTab(key)}
                className={`px-4 py-2.5 text-sm font-medium tracking-wide border-b-2 -mb-px transition-colors ${
                  activeStatusTab === key
                    ? "border-[#E53935] text-[#E53935]"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <DeadlineLegend />
        </div>
      </div>

      {/* ===== Table Card (scrollable middle) ===== */}
      <div className="flex-1 min-h-0 w-full px-3 sm:px-6 pt-3">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col h-full overflow-hidden">

          {/* Table — every column has an explicit width. Below the table's
              min-width the parent wrapper kicks in horizontal scroll so the
              layout stays consistent on narrow screens (mobile/tablet); on
              wide monitors the table fills the viewport while still honouring
              column proportions. */}
          <div className="flex-1 min-h-0 [&>div]:h-full [&>div]:overflow-auto">
            <Table className={`w-full table-fixed border-collapse [&_th]:overflow-hidden ${features.has("rfq_order_type") ? "min-w-[1330px]" : "min-w-[1380px]"}`}>
              <TableHeader className="sticky top-0 z-10 bg-gray-50">
                {/* Single merged header row — column label stacked above its filter input,
                    inside one light-gray cell (matches the vendor-order list style). */}
                <TableRow className="border-b border-gray-200 [&>th]:bg-gray-50 [&>th]:border-0 [&>th]:py-2 [&>th]:px-2 [&>th]:align-top">
                  <TableHead className="w-[60px] pl-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="text-[11px] font-semibold tracking-wide text-gray-700">S.No</div>
                      {(() => {
                        const filtersActive = fRfqNo.length > 0 || fName.length > 0 || fType.length > 0 || fOrderType.length > 0 || fStatus.length > 0 || !!fCreatedFrom || !!fDeadlineTo;
                        const cls = filtersActive ? "text-[#E53935]" : "text-gray-400";
                        const fill = filtersActive ? "currentColor" : "none";
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              if (!filtersActive) return;
                              setFRfqNo([]); setFName([]); setFType([]); setFOrderType([]); setFStatus([]); setFCreatedFrom(""); setFDeadlineTo("");
                            }}
                            title={filtersActive ? "Clear all filters" : "Filters"}
                            className={`inline-flex items-center justify-center h-7 ${filtersActive ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
                          >
                            <svg className={`h-3.5 w-3.5 ${cls}`} fill={fill} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                            </svg>
                          </button>
                        );
                      })()}
                    </div>
                  </TableHead>
                  <TableHead className="w-[150px]">
                    <div className="flex flex-col gap-1.5">
                      <div className="text-[11px] font-semibold tracking-wide text-gray-700">RFQ No</div>
                      <MultiSelectFilter options={rfqNoOptions} selected={fRfqNo} onChange={setFRfqNo} />
                    </div>
                  </TableHead>
                  <TableHead className="w-[240px]">
                    <div className="flex flex-col gap-1.5">
                      <div className="text-[11px] font-semibold tracking-wide text-gray-700">Package Name</div>
                      <MultiSelectFilter options={nameOptions} selected={fName} onChange={setFName} />
                    </div>
                  </TableHead>
                  <TableHead className="w-[120px]">
                    <div className="flex flex-col gap-1.5">
                      <div className="text-[11px] font-semibold tracking-wide text-gray-700">Type</div>
                      <MultiSelectFilter options={typeOptions} selected={fType} onChange={setFType} />
                    </div>
                  </TableHead>
                  {features.has("rfq_order_type") && (
                    <TableHead className="w-[130px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Order Type</div>
                        <MultiSelectFilter options={orderTypeOptions} selected={fOrderType} onChange={setFOrderType} />
                      </div>
                    </TableHead>
                  )}
                  <TableHead className="w-[140px]">
                    <div className="flex flex-col gap-1.5">
                      <div className="text-[11px] font-semibold tracking-wide text-gray-700">Deadline</div>
                      <Input type="date" value={fDeadlineTo} onChange={(e) => setFDeadlineTo(e.target.value)} className="h-7 text-xs border-gray-200 rounded bg-white px-2" />
                    </div>
                  </TableHead>
                  <TableHead className="w-[130px]">
                    <div className="flex flex-col gap-1.5">
                      <div className="text-[11px] font-semibold tracking-wide text-gray-700">Created</div>
                      <Input type="date" value={fCreatedFrom} onChange={(e) => setFCreatedFrom(e.target.value)} className="h-7 text-xs border-gray-200 rounded bg-white px-2" />
                    </div>
                  </TableHead>
                  <TableHead className="w-[120px]">
                    <div className="flex flex-col gap-1.5">
                      <div className="text-[11px] font-semibold tracking-wide text-gray-700 flex items-center gap-1">Status <StatusInfoTooltip /></div>
                      <MultiSelectFilter options={statusOptions} selected={fStatus} onChange={setFStatus} />
                    </div>
                  </TableHead>
                  {!features.has("rfq_order_type") && (
                    <TableHead className="text-center w-[100px]">
                      <div className="flex flex-col gap-1.5 items-center">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Submissions</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                  )}
                  <TableHead className="text-right w-[200px] pr-2">
                    <div className="flex flex-col gap-1.5 items-end">
                      <div className="text-[11px] font-semibold tracking-wide text-gray-700">Target Amount</div>
                      <div className="h-7" />
                    </div>
                  </TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={features.has("rfq_order_type") ? 10 : 10} className="h-48 text-center">
                      <div className="flex flex-col items-center gap-3 text-gray-400">
                        <div className="h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center">
                          <FileText className="h-7 w-7 stroke-[1.2] text-gray-300" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-500">{rfqs.length === 0 ? "No RFQs yet" : "No RFQs match your filters"}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{rfqs.length === 0 ? "Create your first RFQ to start collecting vendor bids" : "Try adjusting your filters or status tab"}</p>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((rfq, idx) => {
                    const st = statusInfo(rfq.status);
                    const dl = mounted ? deadlineDisplay(rfq.deadline) : { text: formatDate(rfq.deadline || ""), className: "text-gray-500" };
                    const typeBadgeClass =
                      rfq.rfq_type === "open"
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-amber-200 bg-amber-50 text-amber-700";
                    // Deadline urgency border
                    const dlMs = rfq.deadline ? new Date(rfq.deadline).getTime() - Date.now() : Infinity;
                    const urgencyBorder = dlMs <= 0 ? "border-l-4 border-l-red-400" : dlMs < 24 * 60 * 60 * 1000 ? "border-l-4 border-l-red-300" : dlMs < 3 * 24 * 60 * 60 * 1000 ? "border-l-4 border-l-orange-300" : "";

                    return (
                      <React.Fragment key={rfq.id}>
                      <TableRow
                        className={`cursor-pointer hover:bg-gray-50/80 transition-colors group ${urgencyBorder}`}
                        onClick={() => router.push(buildUrl(`/rfp/${rfq.id}`))}
                      >
                        <TableCell className="text-xs text-gray-400 font-normal pl-5">
                          {String(idx + 1).padStart(2, "0")}
                        </TableCell>
                        <TableCell className="whitespace-normal align-top">
                          <span className="text-xs font-medium text-gray-800 break-words">{rfq.rfq_no}</span>
                        </TableCell>
                        <TableCell className="whitespace-normal align-top">
                          <div>
                            <p
                              title={rfq.rfq_name}
                              className="text-sm font-semibold text-gray-900 group-hover:text-[#E53935] transition-colors break-words whitespace-normal leading-snug"
                            >
                              {rfq.rfq_name}
                            </p>
                            {rfq.source_order_number && (
                              <p className="text-xs text-gray-400 mt-0.5 break-words whitespace-normal">
                                {rfq.source_order_number}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs font-medium whitespace-nowrap px-2 py-0.5 ${typeBadgeClass}`}>
                            {formatRfqType(rfq.rfq_type)}
                          </Badge>
                        </TableCell>
                        {features.has("rfq_order_type") && (
                          <TableCell>
                            {rfq.rfq_order_type ? (
                              <Badge variant="outline" className={`text-xs font-medium whitespace-nowrap ${rfq.rfq_order_type === "GC RFQ" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-orange-50 text-orange-700 border-orange-200"}`}>{rfq.rfq_order_type}</Badge>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {dl.icon && <Clock className="h-3.5 w-3.5 flex-shrink-0" />}
                            <span className={`text-xs ${dl.className}`} suppressHydrationWarning>{dl.text}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-gray-500">{formatDate(rfq.created_at)}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs font-medium gap-1.5 whitespace-nowrap ${st.className}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            {rfq.status === "awarded" && <CheckCircle2 className="h-3 w-3" />}
                            {st.label}
                          </Badge>
                        </TableCell>
                        {!features.has("rfq_order_type") && (
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="text-sm font-normal text-gray-700">{rfq.submissions_count}</span>
                              <span className="text-xs text-gray-400">/ {rfq.vendors_invited}</span>
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="text-right whitespace-normal align-middle">
                          <span className="text-sm font-medium tabular-nums text-gray-900 break-words" suppressHydrationWarning>{formatINR(rfq.target_amount)}</span>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                className="h-7 w-7 p-0 text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              {rfq.status === "draft" && (
                                <>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); router.push(buildUrl(`/rfp/create?edit=${rfq.id}`)); }}>
                                    <Pencil className="mr-2 h-4 w-4" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleSendRfq(rfq.id); }}>
                                    <Send className="mr-2 h-4 w-4" /> Send to Vendors
                                  </DropdownMenuItem>
                                </>
                              )}
                              {(rfq.status === "sent" || rfq.status === "in_progress") && (
                                <>
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleSendReminder(rfq.id, rfq.rfq_name); }}>
                                    <Bell className="mr-2 h-4 w-4" /> Send Reminder
                                  </DropdownMenuItem>
                                </>
                              )}
                              {canDuplicate && (
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicate(rfq.id); }}>
                                  <Copy className="mr-2 h-4 w-4" /> Duplicate
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {rfq.status === "draft" && (
                                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={(e) => { e.stopPropagation(); handleDeleteRfq(rfq.id, rfq.rfq_name); }}>
                                  <XCircle className="mr-2 h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              )}
                              {!["approved", "awarded", "closed", "draft"].includes(rfq.status) && (
                                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={(e) => { e.stopPropagation(); handleCloseRfq(rfq.id, rfq.rfq_name); }}>
                                  <Power className="mr-2 h-4 w-4" /> Close RFQ
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Footer — Create RFQ + Summary Sheet */}
          <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <Link href={buildUrl("/rfp/create")} className="text-sm font-semibold text-[#E53935] hover:text-[#C62828] transition-colors">
              + Create RFQ
            </Link>
            {features.has("summary_sheet") && (
              <Link
                href={buildUrl("/rfp/summary-sheet")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium tracking-wide text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                Summary Sheet
              </Link>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

// --------------- deadline legend ---------------

function DeadlineLegend() {
  const [hover, setHover] = React.useState<"red" | "orange" | null>(null);
  const redRef = React.useRef<HTMLSpanElement>(null);
  const orangeRef = React.useRef<HTMLSpanElement>(null);
  const [tipPos, setTipPos] = React.useState({ top: 0, right: 0 });

  React.useEffect(() => {
    const ref = hover === "red" ? redRef.current : hover === "orange" ? orangeRef.current : null;
    if (ref) {
      const r = ref.getBoundingClientRect();
      setTipPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
  }, [hover]);

  return (
    <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
      <span
        ref={redRef}
        className="flex items-center gap-1 cursor-default"
        onMouseEnter={() => setHover("red")}
        onMouseLeave={() => setHover(null)}
      >
        <span className="w-1 h-2.5 rounded-sm bg-red-400" /> &lt;24h
      </span>
      <span
        ref={orangeRef}
        className="flex items-center gap-1 cursor-default"
        onMouseEnter={() => setHover("orange")}
        onMouseLeave={() => setHover(null)}
      >
        <span className="w-1 h-2.5 rounded-sm bg-orange-300" /> &lt;3 days
      </span>
      {hover && typeof document !== "undefined" && ReactDOM.createPortal(
        <div
          className="fixed bg-white text-gray-600 text-xs px-3 py-2 rounded-xl border border-gray-200 shadow-xl pointer-events-none whitespace-nowrap"
          style={{ top: tipPos.top, right: tipPos.right, zIndex: 9999 }}
        >
          {hover === "red" ? "Deadline expired or less than 24 hours left" : "Less than 3 days until deadline"}
        </div>,
        document.body
      )}
    </div>
  );
}

// --------------- status info tooltip ---------------

function StatusInfoTooltip() {
  const [show, setShow] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });

  React.useEffect(() => {
    if (show && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: Math.max(8, r.left - 140) });
    }
  }, [show]);

  const statuses = [
    { dot: "bg-gray-400", label: "Draft", desc: "RFQ created but not sent to vendors" },
    { dot: "bg-blue-500", label: "Sent", desc: "RFQ sent to vendors, awaiting first bid" },
    { dot: "bg-orange-500", label: "In Progress", desc: "At least one vendor has submitted a bid" },
    { dot: "bg-teal-500", label: "Under Review", desc: "All vendors submitted or deadline expired" },
    { dot: "bg-purple-500", label: "Shortlisted", desc: "Buyer has shortlisted one or more vendors" },
    { dot: "bg-green-500", label: "Approved", desc: "Vendor selected and approved by buyer" },
    { dot: "bg-green-500", label: "Awarded", desc: "Award email sent, order confirmed" },
    { dot: "bg-gray-400", label: "Closed", desc: "RFQ manually closed without award" },
  ];

  return (
    <>
      <button
        ref={btnRef}
        className="h-5 w-5 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        <svg className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {show && typeof document !== "undefined" && ReactDOM.createPortal(
        <div
          className="fixed w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-4 pointer-events-none"
          style={{ top: pos.top, left: pos.left, zIndex: 9999 }}
        >
          <p className="text-xs font-semibold text-gray-700 mb-2.5">RFQ Status Flow</p>
          <div className="space-y-2">
            {statuses.map((s) => (
              <div key={s.label} className="flex items-start gap-2">
                <span className={`h-2 w-2 rounded-full mt-1 shrink-0 ${s.dot}`} />
                <div>
                  <span className="text-xs font-medium text-gray-700">{s.label}</span>
                  <p className="text-xs text-gray-400 leading-tight">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t">
            <p className="text-xs text-gray-400 leading-relaxed">Statuses advance automatically.</p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// --------------- stat card ---------------

function ValueCard({
  label,
  count,
  value,
  icon,
  info,
}: {
  label: string;
  count: number;
  value: number;
  icon: React.ReactNode;
  info: string;
}) {
  const { currency } = useCurrency();
  const [showInfo, setShowInfo] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = React.useState({ top: 0, left: 0 });

  React.useEffect(() => {
    if (showInfo && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setTipPos({ top: r.bottom + 6, left: r.left });
    }
  }, [showInfo]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-gray-400">{icon}</span>
        <span className="text-xs font-medium tracking-wide text-gray-500">{label}</span>
        <button
          ref={btnRef}
          className="h-5 w-5 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          onMouseEnter={() => setShowInfo(true)}
          onMouseLeave={() => setShowInfo(false)}
        >
          <svg className="h-3 w-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        {showInfo && typeof document !== "undefined" && ReactDOM.createPortal(
          <div
            className="fixed w-64 bg-white border border-gray-200 rounded-xl shadow-xl p-3 pointer-events-none"
            style={{ top: tipPos.top, left: tipPos.left, zIndex: 9999 }}
          >
            <p className="text-xs text-gray-600 leading-relaxed">{info}</p>
          </div>,
          document.body
        )}
        <span className="text-xs font-medium text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5 ml-auto">{count}</span>
      </div>
      {(() => {
        const formatted = Number(value).toLocaleString(currency.locale, { maximumFractionDigits: 0 });
        // Step the value-text size down as the digit count grows so a very
        // large amount (e.g. ₹ 32,00,00,00,04,15,632) doesn't wrap or overflow
        // the summary card.
        const len = formatted.length;
        const sizeClass =
          len <= 12 ? "text-xl"
          : len <= 16 ? "text-lg"
          : len <= 20 ? "text-base"
          : len <= 24 ? "text-sm"
          : "text-xs";
        return (
          <p
            className={`${sizeClass} font-semibold tabular-nums text-gray-900 whitespace-nowrap`}
            title={`${currency.symbol} ${formatted}`}
            suppressHydrationWarning
          >
            {currency.symbol} {formatted}
          </p>
        );
      })()}
    </div>
  );
}
