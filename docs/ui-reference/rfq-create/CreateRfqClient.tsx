"use client";
import { apiFetch } from "@/lib/api-fetch";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useUI, flashToast } from "@/components/ui/toast-confirm";
import { useAuth, useCurrency } from "@/lib/auth-context";
import { formatAmount } from "@/lib/currency";
import { useFeatures } from "@/features/use-features";
import { RfqTypeInfo } from "@/components/shared/RfqTypeInfo";
import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  Search,
  MoreVertical,
  FileText,
  Bold,
  Italic,
  Underline,
  Type,
  AlignLeft,
  List,
  ListOrdered,
  LinkIcon,
  ImageIcon,
  Package,
  Clock,
  MapPin,
  Mail,
  RefreshCw,
} from "lucide-react";
import { VendorOrderElementDetail } from "@/types/api";

/* ─── types ─── */

// Revise-mode prefill bundle. The /rfp/[id]/revise server page fetches all
// of this and hands it to CreateRfqClient so the form can render without
// any client-side loading state. Only used when `mode === "revise"`.
export interface RevisePrefill {
  rfq: {
    id: string;
    rfq_no: string;
    rfq_name: string;
    rfq_type: string;
    rfq_order_type: string | null;
    shipping_address: string | null;
    deadline: string | null;
    deadline_hours: number;
    email_subject: string | null;
    email_message: string | null;
    terms_conditions: string | null;
    source_order_id: string | null;
    source_order_number: string | null;
    cc_emails?: string[] | null;
    bcc_emails?: string[] | null;
    show_target_rate: boolean;
  };
  items: { id: string; sr_no: number; item_name: string; description: string | null; code: string | null; brand_make: string | null; hsn_code: string | null; category: string | null; item_type: string | null; quantity: number; uom: string | null; target_rate: number; amount: number; original_quantity?: number; source_changed?: boolean }[];
  invitations: { id: string; vendor_id: string; vendor_name: string; poc_name: string | null; poc_email: string | null; status: string }[];
  submissions: { vendor_id: string; status: string }[];
  // New items in the source rDash order that aren't yet on this RFQ.
  // Already filtered by the server via /api/rfq/[id]/source-order-diff
  // shape — only the fields the revise endpoint accepts in `addItems`.
  newSourceItems: { id: string; name: string; description?: string; code?: string; category?: { name?: string } | null; item_type?: { name?: string } | null; quantity?: string; uom?: { name?: string } | null; client_rate?: string; budget_rate?: string; brand_make?: string; hsn_code?: string }[];
}

interface Props {
  orders: { id: string; number: string; vendor: string | null; amount: string }[];
  vendors: { id: string; name: string; code: string }[];
  projectId: string;
  duplicateFromId?: string | null;
  editRfqId?: string | null;
  // Server pre-resolves this for edit mode so the Draft Order dropdown renders
  // already-selected on first paint, with no client-side race.
  initialSelectedOrderId?: string;
  // Revise mode wiring. When `mode === "revise"`, `reviseRfqId` + `revisePrefill`
  // must be present; the form locks the source order picker + RFQ name and
  // surfaces revise-specific UI (current vendors with remove/reopen, new items
  // from source diff, portalOption). Submit goes to POST /api/rfq/{id}/revise.
  mode?: "create" | "revise";
  reviseRfqId?: string | null;
  revisePrefill?: RevisePrefill | null;
}

/* ─── helpers ─── */

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function CreateRfqClient({ orders: initialOrders, vendors: initialVendors, projectId, duplicateFromId, editRfqId, initialSelectedOrderId = "", mode = "create", reviseRfqId = null, revisePrefill = null }: Props) {
  // Revise mode is a third flow alongside create/duplicate/edit. It locks the
  // source order picker + RFQ name, hides the "Save Draft" button, exposes
  // revise-specific UI (current vendors with remove/reopen, new items from
  // source-order diff, portalOption), and submits to POST /revise instead of
  // POST /create or PATCH /rfq/{id}. All other inputs use the same form
  // controls as create, so visual parity is automatic.
  const isReviseMode = mode === "revise";
  // Vendors are lazy-loaded via /api/rdash/vendors/search (single-page server
  // search) so orgs with thousands of vendors don't pay a 15+s SSR fetch and
  // a 7000-row DOM. The picker list (`vendors`) holds the latest server
  // results; `vendorDataById` accumulates every vendor we've ever seen so
  // already-selected vendors stay resolvable even when the search list moves
  // on. Calls outside this paragraph still use `vendors` for the picker UI;
  // any "lookup by id" path goes through `vendorDataById`.
  type VendorRec = { id: string; name: string; code: string };
  const [vendors, setVendors] = useState<VendorRec[]>(initialVendors);
  const [vendorDataById, setVendorDataById] = useState<Record<string, VendorRec>>(() =>
    Object.fromEntries(initialVendors.map((v) => [v.id, v]))
  );
  const mergeVendorData = useCallback((list: VendorRec[]) => {
    setVendorDataById((prev) => {
      const next = { ...prev };
      for (const v of list) {
        if (v?.id && !next[v.id]) next[v.id] = v;
      }
      return next;
    });
  }, []);
  const lookupVendor = useCallback(
    (id: string): VendorRec | undefined => vendorDataById[id],
    [vendorDataById]
  );
  const { toast, confirm } = useUI();
  const { buildUrl } = useAuth();
  const { currency } = useCurrency();
  // Bare grouped amount (no symbol) in the project currency locale; the symbol
  // is rendered separately next to totals / in column headers.
  const formatCurrency = (n: number) => formatAmount(n, currency);
  const { has, getConfig } = useFeatures();

  // ── Draft orders — fetched client-side for freshness
  const [orders, setOrders] = useState(initialOrders);
  const [loadingOrders, setLoadingOrders] = useState(true);

  useEffect(() => {
    fetchDraftOrders();
  }, [projectId]);

  async function fetchDraftOrders() {
    setLoadingOrders(true);
    try {
      const res = await apiFetch(`/api/rdash/draft-orders?projectId=${projectId}`);
      const data = await res.json();
      if (res.ok && data.orders) {
        // Preserve any orders already in state that aren't in the fresh list
        // (e.g. in Edit mode the source order is no longer "Not Sent" and won't
        // come back, but prefill has injected a synthetic entry for it).
        // Reading `selectedOrderId` here would race with prefill — instead we
        // just keep any extras present in `prev` that the fetch dropped.
        setOrders((prev) => {
          const fresh = data.orders as typeof prev;
          const freshIds = new Set(fresh.map((o) => o.id));
          const extras = prev.filter((o) => !freshIds.has(o.id));
          return extras.length ? [...extras, ...fresh] : fresh;
        });
      }
    } catch { /* keep initial */ } finally { setLoadingOrders(false); }
  }

  // ── Duplicate / Edit prefill
  // Revise mode doesn't use this API-fetch prefill path — its data is passed
  // in via `revisePrefill` and applied to useState initializers below, so
  // the form renders fully populated on first paint without any client
  // round-trip.
  const prefillId = duplicateFromId || editRfqId;
  const isEditMode = !!editRfqId;
  const [prefillLoading, setPrefillLoading] = useState(!!prefillId);

  // Revise-mode prefill snapshot. Used by useState initializers and the
  // "did this field change from its original value" diff-on-submit.
  const reviseInit = isReviseMode ? revisePrefill : null;

  useEffect(() => {
    if (!prefillId) return;
    // Revise mode pre-fills synchronously via useState initializers from
    // `reviseInit`. Skip the API-fetch prefill path to avoid clobbering
    // those values with a duplicate/edit round-trip.
    if (isReviseMode) return;
    async function prefillFromSource() {
      setPrefillLoading(true);
      try {
        const res = await apiFetch(`/api/rfq/${prefillId}`);
        const data = await res.json();
        if (!res.ok) { toast("Failed to load RFQ data", "error"); return; }
        const { rfq: src, items, vendors: srcVendors } = data;

        // Prefill RFQ config
        setRfqName(src.rfq_name || "");
        setRfqType(src.rfq_type as "open" | "closed");
        if (src.rfq_order_type) setRfqOrderType(src.rfq_order_type);
        if (src.deadline) {
          setDeadlineDate(new Date(src.deadline).toISOString().split("T")[0]);
        } else if (src.deadline_hours) {
          // Draft saved without an explicit deadline — fall back to (created_at + deadline_hours).
          // Server returns deadline_hours; pre-seed the date relative to today so the field isn't blank.
          const fallback = new Date(Date.now() + Number(src.deadline_hours) * 60 * 60 * 1000);
          setDeadlineDate(fallback.toISOString().split("T")[0]);
        }
        setShippingAddress(src.shipping_address || "");
        setTermsContent(src.terms_conditions || "");
        setEmailSubject(src.email_subject || "");
        setEmailMessage(src.email_message || "");
        setCcEmails(src.cc_emails || []);

        // Prefill source order. After the RFQ exists, that order is no longer
        // "Not Sent" so it won't be in the draft-orders list — inject a
        // synthetic entry so the dropdown can display it as the current value.
        // Also queue the id in `pendingSourceOrderId`; the watcher effect above
        // applies it to selectedOrderId once the matching SelectItem is in the
        // tree, regardless of whether prefill or fetchDraftOrders won the race.
        if (src.source_order_id) {
          const sid = String(src.source_order_id);
          const snum = src.source_order_number ? String(src.source_order_number) : sid;
          setOrders((prev) => {
            if (prev.some((o) => o.id === sid)) return prev;
            return [
              { id: sid, number: snum, vendor: null, amount: "0" },
              ...prev,
            ];
          });
          setPendingSourceOrderId(sid);
        }

        // Convert items to element format for the items table
        const fakeElements: VendorOrderElementDetail[] = (items || []).map((item: {
          element_id: string | null; sr_no: number; item_name: string;
          description: string | null; code: string | null; category: string | null;
          item_type: string | null; quantity: number; uom: string | null; target_rate: number;
        }) => ({
          id: item.element_id || `dup-${item.sr_no}`,
          name: item.item_name,
          description: item.description || "",
          code: item.code || "",
          category: item.category ? { id: "", name: item.category } : null,
          item_type: item.item_type ? { id: "", name: item.item_type } : null,
          quantity: String(item.quantity),
          uom: item.uom ? { value: 0, name: item.uom } : null,
          client_rate: String(item.target_rate),
          order_rate: "0",
          budget_rate: String(item.target_rate),
          brand_make: "",
          hsn_code: "",
          tax_percent: "0",
          discount_percent: "0",
          preview_file: null,
          base_amount: 0,
          final_amount: 0,
          amount_without_tax: 0,
        }));
        setElements(fakeElements);

        // Prefill vendors
        if (srcVendors && srcVendors.length > 0) {
          const ids = new Set<string>();
          const users: Record<string, { name: string | null; email: string; phone: string | null }> = {};
          const cached: VendorRec[] = [];
          for (const v of srcVendors) {
            ids.add(v.vendor_id);
            if (v.poc_email) {
              users[v.vendor_id] = { name: v.poc_name || null, email: v.poc_email, phone: null };
            }
            // Seed the lookup cache so the Selected Vendors panel can resolve
            // these ids even before they show up in any search response.
            cached.push({ id: v.vendor_id, name: v.vendor_name || v.vendor_id, code: "" });
          }
          setSelectedVendorIds(ids);
          setVendorUsers(users);
          mergeVendorData(cached);
        }
      } catch { toast("Failed to load RFQ data", "error"); }
      finally { setPrefillLoading(false); }
    }
    prefillFromSource();
  }, [prefillId]);

  // ── Package selection
  // Seeded from the server in edit mode so the dropdown is correctly selected
  // on first paint — no race with fetchDraftOrders or the client prefill.
  const [selectedOrderId, setSelectedOrderId] = useState(initialSelectedOrderId);
  // Defensive sync: if the prefill effect later resolves a different id (e.g.
  // duplicate flow), apply it once `orders` actually contains a matching item.
  const [pendingSourceOrderId, setPendingSourceOrderId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingSourceOrderId) return;
    if (orders.some((o) => o.id === pendingSourceOrderId)) {
      setSelectedOrderId(pendingSourceOrderId);
      setPendingSourceOrderId(null);
    }
  }, [orders, pendingSourceOrderId]);
  const [elements, setElements] = useState<VendorOrderElementDetail[]>([]);
  const [loadingElements, setLoadingElements] = useState(false);
  const [elementError, setElementError] = useState("");

  // ── RFQ configuration
  // Initializers pull from `reviseInit` when in revise mode so every input
  // renders pre-populated. For create/edit/duplicate `reviseInit` is null
  // and the original defaults apply.
  const [rfqName, setRfqName] = useState(reviseInit?.rfq.rfq_name || "");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [rfqType, setRfqType] = useState<"open" | "closed">(
    reviseInit ? (reviseInit.rfq.rfq_type === "open" ? "open" : "closed") : "closed"
  );
  const [rfqOrderType, setRfqOrderType] = useState(() => {
    if (reviseInit) return reviseInit.rfq.rfq_order_type || "";
    if (has("rfq_order_type")) {
      const options = getConfig<{ options: string[] }>("rfq_order_type")?.options || ["GC RFQ", "Direct Order"];
      return options[0] || "";
    }
    return "";
  });
  const [deadlineDate, setDeadlineDate] = useState(() => {
    if (reviseInit?.rfq.deadline) {
      return new Date(reviseInit.rfq.deadline).toISOString().split("T")[0];
    }
    const d = new Date();
    d.setDate(d.getDate() + 5); // default 5 days from now
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
  });
  // Calculate hours from date for API compatibility
  // Deadline = end of selected date (23:59:59).
  // Guard against an empty/invalid date string — clearing the input via the
  // delete key produces "" and `new Date("T23:59:59")` is Invalid Date, which
  // throws on `.toISOString()`. Fall back to nulls so the form keeps rendering
  // and validation surfaces "Deadline is required" instead of crashing.
  const deadlineParsed = deadlineDate ? new Date(deadlineDate + "T23:59:59") : null;
  const deadlineValid = deadlineParsed !== null && !isNaN(deadlineParsed.getTime());
  const deadlineTimestamp = deadlineValid ? deadlineParsed!.toISOString() : null;
  const deadlineHours = deadlineValid
    ? Math.max(1, Math.ceil((deadlineParsed!.getTime() - Date.now()) / (1000 * 60 * 60)))
    : 0;
  const [shippingAddress, setShippingAddress] = useState(reviseInit?.rfq.shipping_address || "");
  // Should the vendor portal display target rate / target amount / deviation
  // columns? Buyer-toggleable in create + revise. Default: open=true, closed=false
  // — preserves the prior implicit-via-rfq_type behavior.
  const [showTargetRate, setShowTargetRate] = useState<boolean>(
    reviseInit ? reviseInit.rfq.show_target_rate : false
  );
  // Org-name shown to vendors as "RFQ From" — captured from rDash vendor-order
  // detail's `order_from` when an order is selected.
  const [createdFromOrg, setCreatedFromOrg] = useState<string | null>(null);
  // Order's billing entity name (also from the vendor-order detail). The server
  // decides whether to use this instead of `order_from` based on a per-org
  // feature flag (sender_from_billing_entity); the client just forwards both.
  const [billingEntityName, setBillingEntityName] = useState<string | null>(null);

  // ── Inline validation errors (shown after first save attempt, vendor-order style)
  const errors = useMemo(() => {
    if (!submitAttempted) return {} as Record<string, string>;
    const e: Record<string, string> = {};
    // RFQ name is locked in revise mode — no validation needed there.
    if (!isReviseMode) {
      if (!rfqName.trim()) e.rfqName = "RFQ name is required";
      else if (rfqName.trim().length > 50) e.rfqName = "RFQ name must be 50 characters or fewer";
    }
    // Draft order picker is hidden in revise mode (source order is locked).
    if (!isReviseMode && !selectedOrderId) e.order = "Draft order is required";
    if (!shippingAddress.trim()) e.shippingAddress = "Shipping address is required";
    if (has("rfq_order_type")) {
      if (!rfqType) e.rfqType = "RFQ type is required";
      if (!deadlineDate) e.deadline = "Deadline is required";
      else if (new Date(deadlineDate) < new Date()) e.deadline = "Deadline must be in the future";
      if (!rfqOrderType) e.rfqOrderType = "Order type is required";
    }
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitAttempted, isReviseMode, rfqName, selectedOrderId, shippingAddress, rfqType, deadlineDate, rfqOrderType]);

  // ── Items
  const [activeSection, setActiveSection] = useState("all");
  const [itemSearch, setItemSearch] = useState("");
  const [itemFilters, setItemFilters] = useState<{ category: string[]; itemType: string[]; uom: string[] }>({ category: [], itemType: [], uom: [] });
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());

  // ── Attachments
  const [attachments, setAttachments] = useState<
    { id: string; name: string; size: string; uploadedAt: string; file?: File }[]
  >([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ── Terms
  const [termsContent, setTermsContent] = useState(reviseInit?.rfq.terms_conditions || "");

  // ── Unsaved-changes guard ─────────────────────────────────
  // Tracks whether the user has touched the form since mount/last save.
  // Used to show a confirmation when navigating away (browser close, back
  // button, or the in-app back arrow). Reset on successful save.
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;
  // Skip the prefill window — initial state mutations (and edit-mode prefill)
  // shouldn't count as user edits. We arm a moment after mount so prefill
  // has time to run.
  const dirtyArmedRef = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { dirtyArmedRef.current = true; }, prefillId ? 1500 : 100);
    return () => clearTimeout(t);
  }, [prefillId]);
  // Browser-level guard (close tab, refresh, external nav).
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── Vendors
  const [selectedVendorIds, setSelectedVendorIds] = useState<Set<string>>(new Set());
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorUsers, setVendorUsers] = useState<Record<string, { name: string | null; email: string; phone: string | null }>>({});
  // True when /api/rdash/vendors/search returned 403 — the user lacks
  // CAN_ACCESS_MANAGE_VENDOR. We use this to clear any pre-selected vendors
  // seeded by the duplicate/edit prefill (otherwise the picker shows "2
  // selected" with an empty list, which is confusing).
  const [vendorsPermissionDenied, setVendorsPermissionDenied] = useState(false);

  // One-shot lazy load on mount. Server returns every vendor (paginated
  // internally); client filters locally in `filteredVendors` below. Replaces
  // the previous SSR pre-fetch so the Create RFQ page renders fast.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setVendorsLoading(true);
      try {
        const res = await apiFetch(`/api/rdash/vendors/search`);
        if (cancelled) return;
        if (res.status === 403) {
          setVendorsPermissionDenied(true);
          return;
        }
        if (!res.ok) return;
        const json = await res.json();
        const list: VendorRec[] = (json.vendors || []) as VendorRec[];
        setVendors(list);
        mergeVendorData(list);
      } catch { /* skip */ }
      finally { if (!cancelled) setVendorsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [mergeVendorData]);

  // When the vendors API reports permission denied, drop any vendors that
  // the duplicate/edit prefill may have already seeded. The prefill and the
  // permission probe race on mount — handling it here covers both orderings.
  useEffect(() => {
    if (!vendorsPermissionDenied) return;
    setSelectedVendorIds((prev) => (prev.size > 0 ? new Set() : prev));
    setVendorUsers((prev) => (Object.keys(prev).length > 0 ? {} : prev));
  }, [vendorsPermissionDenied]);
  const [editingPocVendor, setEditingPocVendor] = useState<string | null>(null);
  const [editPocName, setEditPocName] = useState("");
  const [editPocEmail, setEditPocEmail] = useState("");

  // ── Email config
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState(reviseInit?.rfq.email_subject || "");
  const [emailMessage, setEmailMessage] = useState(reviseInit?.rfq.email_message || "");
  const [ccInput, setCcInput] = useState("");
  const [ccEmails, setCcEmails] = useState<string[]>(reviseInit?.rfq.cc_emails || []);
  const [bccInput, setBccInput] = useState("");
  const [bccEmails, setBccEmails] = useState<string[]>(reviseInit?.rfq.bcc_emails || []);
  // Chrome ignores autocomplete="off" for email-labelled fields and will
  // autofill (and cross-fill) both CC + BCC. Rendering the inputs readonly until
  // focus makes Chrome skip them during autofill detection; we flip to editable
  // the moment the user focuses. Re-armed on blur.
  const [ccReadOnly, setCcReadOnly] = useState(true);
  const [bccReadOnly, setBccReadOnly] = useState(true);

  // ── Revise-mode state — only used when mode === "revise". Tracks vendor
  // adjustments (remove non-submitted, reopen expired) and item additions
  // from the source-order diff. Mirrors what the old inline panel held.
  const [removeVendorIds, setRemoveVendorIds] = useState<Set<string>>(new Set());
  const [reopenVendorIds, setReopenVendorIds] = useState<Set<string>>(new Set());
  const [selectedNewItemIds, setSelectedNewItemIds] = useState<Set<string>>(new Set());
  // BOQ items marked for removal in revise mode. Buyer ticks the trash icon
  // next to a row — the row stays visible (with line-through) so the action
  // is reversible until submit. Submit POSTs `removeItemIds` to /revise.
  const [removeRfqItemIds, setRemoveRfqItemIds] = useState<Set<string>>(new Set());
  const [revisePortalOption, setRevisePortalOption] = useState<"all" | "new_only">("all");

  // Mark the form dirty whenever any user-editable state changes after the
  // initial prefill window. The deps list intentionally covers every field
  // that triggers data loss on navigation away.
  useEffect(() => {
    if (!dirtyArmedRef.current) return;
    if (!isDirtyRef.current) setIsDirty(true);
  }, [
    rfqName, rfqType, rfqOrderType, deadlineDate, shippingAddress,
    selectedOrderId, selectedVendorIds, vendorUsers,
    emailSubject, emailMessage, ccEmails, termsContent,
    attachments, selectedElements, elements,
  ]);

  // ── Derived
  const isOpenBook = rfqType === "open";

  const sections = useMemo(() => {
    const secMap = new Map<string, VendorOrderElementDetail[]>();
    elements.forEach((el) => {
      const sec = el.category?.name || "Unsectioned";
      if (!secMap.has(sec)) secMap.set(sec, []);
      secMap.get(sec)!.push(el);
    });
    return secMap;
  }, [elements]);

  const sectionNames = useMemo(() => Array.from(sections.keys()), [sections]);

  const categoryOptions = useMemo(() => Array.from(new Set(elements.map((el) => el.category?.name).filter(Boolean) as string[])), [elements]);
  const itemTypeOptions = useMemo(() => Array.from(new Set(elements.map((el) => el.item_type?.name).filter(Boolean) as string[])), [elements]);
  const uomOptions = useMemo(() => Array.from(new Set(elements.map((el) => el.uom?.name).filter(Boolean) as string[])), [elements]);

  const displayedElements = useMemo(() => {
    let items = elements;
    // Section-tab narrowing applies *only* when no column filters and no
    // description search are active. Otherwise the column filter wins —
    // intersecting the section tab with a different category filter would
    // silently produce zero results and look like the filter is broken.
    const anyColumnFilterActive =
      !!itemSearch ||
      itemFilters.category.length > 0 ||
      itemFilters.itemType.length > 0 ||
      itemFilters.uom.length > 0;
    if (activeSection !== "all" && !anyColumnFilterActive) {
      items = items.filter((el) => (el.category?.name || "Unsectioned") === activeSection);
    }
    if (itemSearch) {
      const q = itemSearch.toLowerCase();
      items = items.filter(
        (el) =>
          el.name.toLowerCase().includes(q) ||
          (el.description || "").toLowerCase().includes(q) ||
          el.code.toLowerCase().includes(q)
      );
    }
    if (itemFilters.category.length > 0) {
      items = items.filter((el) => itemFilters.category.includes(el.category?.name || ""));
    }
    if (itemFilters.itemType.length > 0) {
      items = items.filter((el) => itemFilters.itemType.includes(el.item_type?.name || ""));
    }
    if (itemFilters.uom.length > 0) {
      items = items.filter((el) => itemFilters.uom.includes(el.uom?.name || ""));
    }
    return items;
  }, [elements, activeSection, itemSearch, itemFilters]);

  const itemTotal = useMemo(
    () =>
      elements.reduce((sum, el) => {
        const qty = parseFloat(el.quantity) || 0;
        const rate = parseFloat(el.budget_rate || "") || parseFloat(el.client_rate) || 0;
        return sum + qty * rate;
      }, 0),
    [elements]
  );

  const groupedElements = useMemo(() => {
    // Map keyed by section name so non-contiguous items still land in a
    // single group. The previous "look at the previous item" approach
    // produced duplicate section headers (e.g. "Miscellaneous (4)" then
    // "Miscellaneous (11)") whenever rDash returned items unsorted, which
    // also made column filters look broken because items were scattered
    // across what appeared to be two different sections with the same name.
    const map = new Map<string, (VendorOrderElementDetail & { globalIdx: number })[]>();
    displayedElements.forEach((el, idx) => {
      const sec = el.category?.name || "Unsectioned";
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push({ ...el, globalIdx: idx + 1 });
    });
    return Array.from(map.entries()).map(([section, items]) => ({ section, items }));
  }, [displayedElements]);

  // ── Element selection helpers ──
  const allDisplayedIds = useMemo(() => displayedElements.map((el) => el.id), [displayedElements]);
  const allDisplayedSelected = allDisplayedIds.length > 0 && allDisplayedIds.every((id) => selectedElements.has(id));

  function toggleSelectAllElements() {
    if (allDisplayedSelected) {
      // Deselect all displayed
      setSelectedElements((prev) => {
        const next = new Set(prev);
        for (const id of allDisplayedIds) next.delete(id);
        return next;
      });
    } else {
      // Select all displayed
      setSelectedElements((prev) => {
        const next = new Set(prev);
        for (const id of allDisplayedIds) next.add(id);
        return next;
      });
    }
  }

  function toggleElement(id: string) {
    setSelectedElements((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSectionElements(sectionItems: VendorOrderElementDetail[]) {
    const sectionIds = sectionItems.map((el) => el.id);
    const allInSection = sectionIds.every((id) => selectedElements.has(id));
    setSelectedElements((prev) => {
      const next = new Set(prev);
      if (allInSection) {
        for (const id of sectionIds) next.delete(id);
      } else {
        for (const id of sectionIds) next.add(id);
      }
      return next;
    });
  }

  // Local filter on the full vendor list. Whitespace-only input is treated
  // as empty so accidentally pressing space doesn't blank the picker.
  const filteredVendors = useMemo(() => {
    const q = (vendorSearch || "").trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) => v.name.toLowerCase().includes(q) || v.code.toLowerCase().includes(q)
    );
  }, [vendors, vendorSearch]);

  const computedSubject = useMemo(() => {
    if (emailSubject) return emailSubject;
    const order = orders.find((o) => o.id === selectedOrderId);
    // Mirror the server's rfq_no formula (RFQ-<orderNumber>) so the preview
    // matches what vendors will actually receive in the email subject.
    return order ? `RFQ for RFQ-${order.number}` : "RFQ for [Package]";
  }, [emailSubject, orders, selectedOrderId]);

  // ── Handlers
  const handleOrderChange = useCallback(
    async (orderId: string) => {
      // No-op when the value isn't actually changing (prefill / Radix Select
      // re-emitting the same value). Otherwise the elements / shipping address
      // / createdFromOrg state we just prefilled would be wiped.
      if (orderId === selectedOrderId) return;
      setSelectedOrderId(orderId);
      setElements([]);
      setActiveSection("all");
      if (!orderId) return;
      // RFQ name is optional — buyer fills it. RFQ number is derived server-side from the order number.
      setLoadingElements(true);
      setElementError("");
      try {
        const res = await apiFetch(`/api/rdash/elements?projectId=${projectId}&orderId=${orderId}`);
        if (!res.ok) {
          setElementError(`API returned ${res.status}`);
          return;
        }
        const json = await res.json();
        const data = (json.data || []) as VendorOrderElementDetail[];
        setElements(data);
        // Prefill shipping address from order detail
        if (json.orderDetail?.shipping_address) {
          setShippingAddress(json.orderDetail.shipping_address);
        }
        // Prefill T&C from the order's payment_tnc + other_tnc when the
        // terms textarea is empty. Don't clobber user-typed content if they
        // switch between orders mid-flow. rDash returns these as either
        // strings or objects ({ id, title, block: [string] }).
        const extractTnc = (raw: unknown): string => {
          if (typeof raw === "string") return raw;
          if (raw && typeof raw === "object") {
            const o = raw as { text?: string; name?: string; title?: string; block?: unknown };
            if (typeof o.text === "string") return o.text;
            if (typeof o.title === "string" && Array.isArray(o.block)) {
              const lines = (o.block as unknown[]).filter((b): b is string => typeof b === "string");
              return [o.title, ...lines].filter(Boolean).join("\n");
            }
            if (typeof o.title === "string") return o.title;
            if (typeof o.name === "string") return o.name;
          }
          return "";
        };
        if (!termsContent.trim()) {
          const paymentTnc = extractTnc(json.orderDetail?.payment_tnc).trim();
          const otherTnc = extractTnc(json.orderDetail?.other_tnc).trim();
          const parts: string[] = [];
          if (paymentTnc) parts.push(`Payment Terms:\n${paymentTnc}`);
          if (otherTnc) parts.push(`Other Terms:\n${otherTnc}`);
          if (parts.length > 0) setTermsContent(parts.join("\n\n"));
        }
        // Capture both the order's buying org (`order_from`) and its billing
        // entity, and forward both to the server. The server picks which one
        // becomes `created_from_org` (the "RFQ From" name) based on the per-org
        // `sender_from_billing_entity` feature flag. rDash returns each as an
        // { id, name } object (older shapes may be a bare string).
        const pickName = (v: unknown): string | null => {
          if (typeof v === "string") return v.trim() || null;
          if (v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string") {
            return ((v as { name: string }).name).trim() || null;
          }
          return null;
        };
        const orderFromName = pickName(json.orderDetail?.order_from);
        if (orderFromName) setCreatedFromOrg(orderFromName);
        setBillingEntityName(pickName(json.orderDetail?.billing_entity));
        if (data.length === 0 && !json.failedCount) {
          setElementError("No elements found for this order");
        } else if (typeof json.failedCount === "number" && json.failedCount > 0) {
          // Either a partial failure (some 403s, most succeeded) or an
          // early-abort (the first batch was mostly 403s — usually means
          // the rDash token is missing permissions and continuing would
          // just rack up more failures). Both surface the same banner.
          // Don't let the user proceed when most items are missing.
          const isPermissionLikely = json.firstError?.status === 403;
          const stem = json.abortedEarly
            ? `Stopped after ${json.totalCount - data.length}+ failures (loaded ${data.length} of ${json.totalCount} items).`
            : `${json.failedCount} of ${json.totalCount} items couldn't load.`;
          setElementError(
            stem +
            (isPermissionLikely ? " Likely a rDash permission issue — ask an admin to check your token." : " Reload to retry.")
          );
        }
      } catch (err) {
        console.error("Failed to fetch order elements:", err);
        setElementError("Failed to fetch elements. Check console for details.");
      } finally {
        setLoadingElements(false);
      }
    },
    [orders, projectId, selectedOrderId]
  );

  // Fetch vendor primary user when selected
  async function fetchVendorUser(vendorId: string) {
    if (vendorUsers[vendorId]) return; // already fetched
    try {
      const res = await apiFetch(`/api/rdash/vendor-users?vendorId=${vendorId}`);
      const json = await res.json();
      const users = json.data || [];
      const primary = users.find((u: { is_primary: boolean }) => u.is_primary) || users[0];
      if (primary) {
        const phone = primary.phone_number
          ? `${primary.phone_number.country_code || ""}${primary.phone_number.number || ""}`
          : primary.phone_number;
        setVendorUsers((prev) => ({
          ...prev,
          [vendorId]: { name: primary.name, email: primary.email, phone },
        }));
      } else {
        // No users found — set empty so UI doesn't show "Loading..." forever
        setVendorUsers((prev) => ({ ...prev, [vendorId]: { name: null, email: "", phone: null } }));
      }
    } catch {
      setVendorUsers((prev) => ({ ...prev, [vendorId]: { name: null, email: "", phone: null } }));
    }
  }

  function toggleVendor(id: string) {
    setSelectedVendorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        fetchVendorUser(id);
      }
      return next;
    });
  }

  // Bulk-select every vendor currently visible (after filter) that isn't already selected
  function selectAllVisibleVendors() {
    const toAdd = filteredVendors.filter((v) => !selectedVendorIds.has(v.id));
    if (toAdd.length === 0) return;
    setSelectedVendorIds((prev) => {
      const next = new Set(prev);
      toAdd.forEach((v) => next.add(v.id));
      return next;
    });
    toAdd.forEach((v) => fetchVendorUser(v.id));
  }

  // Bulk-deselect: remove every currently visible vendor (after filter) from selection
  function deselectAllVisibleVendors() {
    const toRemove = filteredVendors.filter((v) => selectedVendorIds.has(v.id)).map((v) => v.id);
    if (toRemove.length === 0) return;
    setSelectedVendorIds((prev) => {
      const next = new Set(prev);
      toRemove.forEach((id) => next.delete(id));
      return next;
    });
  }

  // Attachment handlers
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      if (file.name.length > 100) {
        rejected.push(file.name);
      } else {
        accepted.push(file);
      }
    }
    if (rejected.length > 0) {
      toast("File name must be 100 characters or fewer", "error");
    }
    const newAttachments = accepted.map((file) => ({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      size: file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      uploadedAt: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      file, // keep actual File for S3 upload after RFQ creation
    }));
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
    e.target.value = "";
  }

  // Upload attachments to S3 after RFQ is created
  async function uploadAttachments(rfqId: string) {
    const filesToUpload = attachments.filter((a) => a.file);
    if (filesToUpload.length === 0) return;
    try {
      const formData = new FormData();
      formData.append("rfqId", rfqId);
      formData.append("vendorId", "buyer"); // buyer-uploaded attachments
      filesToUpload.forEach((a) => { if (a.file) formData.append("files", a.file); });
      await apiFetch("/api/files", { method: "POST", body: formData });
    } catch (err) {
      console.error("Failed to upload attachments:", err);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function savePocDetails(vendorId: string) {
    setVendorUsers((prev) => ({
      ...prev,
      [vendorId]: { ...prev[vendorId], name: editPocName.trim() || prev[vendorId]?.name || null, email: editPocEmail.trim() || prev[vendorId]?.email || "" },
    }));
    setEditingPocVendor(null);
    setEditPocName("");
    setEditPocEmail("");
  }

  const [saving, setSaving] = useState(false);
  // Tracks which action is in flight so only the clicked button shows the spinner.
  const [savingMode, setSavingMode] = useState<"draft" | "sent" | null>(null);

  function addCcEmail() {
    const email = ccInput.trim();
    if (email && !ccEmails.includes(email)) {
      setCcEmails((prev) => [...prev, email]);
      setCcInput("");
    }
  }

  function addBccEmail() {
    const email = bccInput.trim();
    if (email && !bccEmails.includes(email)) {
      setBccEmails((prev) => [...prev, email]);
      setBccInput("");
    }
  }



  async function handleSave(sendStatus: "draft" | "sent") {
    // Mandatory field validation — surface inline errors AND fire a toast so
    // the user gets feedback even if the offending field is scrolled out of
    // view. Collect everything missing first so the toast can name the field.
    setSubmitAttempted(true);
    const missing: string[] = [];
    // RFQ name and Draft Order are locked in revise mode — both are already
    // set on the existing RFQ and the inputs aren't editable. Skip those
    // checks; everything else still applies.
    if (!isReviseMode) {
      if (!rfqName.trim()) missing.push("RFQ name");
      else if (rfqName.trim().length > 50) missing.push("RFQ name (max 50 characters)");
      if (!selectedOrderId) missing.push("Draft order");
    }
    // Shipping address is required by rDash on the underlying vendor-order
    // (the bulk-update endpoints validate it server-side and 400 if blank),
    // so reject empty values up-front instead of waiting for the sync step
    // to fail.
    if (!shippingAddress.trim()) missing.push("Shipping address");
    if (has("rfq_order_type")) {
      if (!rfqType) missing.push("Type");
      if (!deadlineDate) missing.push("Deadline");
      else if (new Date(deadlineDate) < new Date()) missing.push("Deadline (must be in the future)");
      if (!rfqOrderType) missing.push("Order type");
    }
    if (missing.length > 0) {
      toast(`Please fill required fields: ${missing.join(", ")}`, "error");
      return;
    }
    // In revise mode the existing vendors are already on the RFQ — buyer can
    // submit even with zero ADDS (they may just be tweaking T&C, shipping,
    // deadline, etc.). Only enforce vendor-required in create/edit/duplicate.
    if (!isReviseMode && sendStatus === "sent" && selectedVendorIds.size === 0) {
      toast("Please select at least one vendor to send the RFQ", "error");
      return;
    }
    // Every selected vendor must have a POC name + email before we save/send
    const missingPoc = Array.from(selectedVendorIds)
      .map((id) => ({ id, vendor: lookupVendor(id), user: vendorUsers[id] }))
      .filter((x) => !x.user?.name?.trim() || !x.user?.email?.trim());
    if (missingPoc.length > 0) {
      const names = missingPoc.map((x) => x.vendor?.name || x.id).slice(0, 3).join(", ");
      const more = missingPoc.length > 3 ? ` + ${missingPoc.length - 3} more` : "";
      toast(`POC name & email required for: ${names}${more}`, "error");
      return;
    }

    setSaving(true);
    setSavingMode(sendStatus);
    try {
      let res: Response;

      if (isReviseMode && reviseRfqId && reviseInit) {
        // REVISE FLOW — POST to /api/rfq/{id}/revise. Only send fields that
        // actually changed (the server's snapshot summary depends on this:
        // every defined field contributes a line to the change-summary, so
        // sending unchanged values would noise up the audit log).
        const src = reviseInit.rfq;
        const initialDateStr = src.deadline ? new Date(src.deadline).toISOString().split("T")[0] : "";
        const reviseBody: Record<string, unknown> = {
          // RFQ-level metadata (rfqName is intentionally omitted — locked)
          rfqType: rfqType !== (src.rfq_type as string) ? rfqType : undefined,
          rfqOrderType: rfqOrderType !== (src.rfq_order_type || "") ? (rfqOrderType || null) : undefined,
          shippingAddress: shippingAddress.trim() !== (src.shipping_address || "").trim() ? shippingAddress.trim() : undefined,
          showTargetRate: showTargetRate !== Boolean(src.show_target_rate) ? showTargetRate : undefined,
          deadlineHours: deadlineDate !== initialDateStr ? deadlineHours : undefined,
          emailSubject: emailSubject !== (src.email_subject || "") ? emailSubject : undefined,
          emailMessage: emailMessage !== (src.email_message || "") ? emailMessage : undefined,
          termsConditions: termsContent !== (src.terms_conditions || "") ? termsContent : undefined,
          ccEmails: JSON.stringify(ccEmails) !== JSON.stringify(src.cc_emails || []) ? ccEmails : undefined,
          bccEmails: JSON.stringify(bccEmails) !== JSON.stringify(src.bcc_emails || []) ? bccEmails : undefined,
          // Vendor + item changes
          addVendors: Array.from(selectedVendorIds)
            .map((id) => {
              const v = lookupVendor(id);
              if (!v) return null;
              const user = vendorUsers[id];
              return { id: v.id, name: v.name, code: v.code, pocName: user?.name || null, pocEmail: user?.email || null };
            })
            .filter(Boolean),
          removeVendorIds: Array.from(removeVendorIds),
          reopenVendorIds: Array.from(reopenVendorIds),
          addItems: reviseInit.newSourceItems.filter((it) => selectedNewItemIds.has(it.id)),
          removeItemIds: Array.from(removeRfqItemIds),
          portalOption: revisePortalOption,
        };

        res = await apiFetch(`/api/rfq/${reviseRfqId}/revise`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reviseBody),
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data.error || "Failed to revise", "error");
          return;
        }

        // Reopen-bidding side effect — the revise endpoint already wires the
        // tokens for newly-reopened vendors, but the explicit per-vendor
        // action keeps the prior portal session valid for them. Best-effort.
        if (reopenVendorIds.size > 0) {
          await Promise.all(
            Array.from(reopenVendorIds).map((vid) =>
              apiFetch(`/api/rfq/${reviseRfqId}/vendor-action`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vendorId: vid, action: "reopen_bidding" }),
              }).catch(() => undefined),
            ),
          );
        }

        // Upload any newly-staged attachments now that the RFQ row exists.
        if (attachments.some((a) => a.file)) {
          await uploadAttachments(reviseRfqId);
        }

        isDirtyRef.current = false;
        setIsDirty(false);
        flashToast("Revision saved and vendors notified", "success");
        window.location.href = buildUrl(`/rfp/${reviseRfqId}`);
        return;
      }

      if (isEditMode && editRfqId) {
        // Edit mode — PATCH existing draft. Includes terms + vendor list so
        // changes to those fields actually persist (server replaces the
        // vendor invitation set when `vendorIds` is provided).
        res = await apiFetch(`/api/rfq/${editRfqId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rfqName,
            rfqType,
            deadlineHours,
            shippingAddress,
            emailSubject: emailSubject || null,
            emailMessage: emailMessage || null,
            ccEmails,
            bccEmails,
            termsConditions: termsContent || null,
            showTargetRate,
            vendorIds: Array.from(selectedVendorIds),
            vendors: Array.from(selectedVendorIds)
              .map((id) => {
                const v = lookupVendor(id);
                if (!v) return null;
                const user = vendorUsers[id];
                return { id: v.id, name: v.name, code: v.code, pocName: user?.name || null, pocEmail: user?.email || null };
              })
              .filter(Boolean),
          }),
        });
      } else {
        // Create / Duplicate mode — POST new
        res = await apiFetch("/api/rfq/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            rfqName,
            rfqType,
            rfqOrderType: rfqOrderType || null,
            deadlineHours,
            deadlineTimestamp,
            shippingAddress,
            sourceOrderId: selectedOrderId || null,
            sourceOrderNumber: orders.find((o) => o.id === selectedOrderId)?.number || null,
            createdFromOrg,
            billingEntityName,
            status: "draft",
            elements,
            vendorIds: Array.from(selectedVendorIds),
            vendors: Array.from(selectedVendorIds)
              .map((id) => {
                const v = lookupVendor(id);
                if (!v) return null;
                const user = vendorUsers[id];
                return { id: v.id, name: v.name, code: v.code, pocName: user?.name || null, pocEmail: user?.email || null };
              })
              .filter(Boolean),
            emailSubject: emailSubject || null,
            emailMessage: emailMessage || null,
            ccEmails,
            bccEmails,
            termsConditions: termsContent || null,
            showTargetRate,
          }),
        });
      }

      const data = await res.json();

      // Handle duplicate RFQ warning
      if (data.requireConfirm) {
        if (!(await confirm({
          title: "Duplicate RFQ",
          message: `${data.warning} A new RFQ for the same order will be created with a different RFQ number. Continue?`,
          confirmLabel: "Create Anyway",
        }))) {
          return;
        }
        // Retry with confirmDuplicate flag
        const retryRes = await apiFetch("/api/rfq/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmDuplicate: true, projectId, rfqName, rfqType,
            rfqOrderType: rfqOrderType || null, deadlineHours, shippingAddress,
            sourceOrderId: selectedOrderId || null,
            sourceOrderNumber: orders.find((o) => o.id === selectedOrderId)?.number || null,
            createdFromOrg,
            billingEntityName,
            status: "draft", elements, vendorIds: Array.from(selectedVendorIds),
            vendors: Array.from(selectedVendorIds)
              .map((id) => {
                const v = lookupVendor(id);
                if (!v) return null;
                const user = vendorUsers[id];
                return { id: v.id, name: v.name, code: v.code, pocName: user?.name || null, pocEmail: user?.email || null };
              })
              .filter(Boolean),
            emailSubject: emailSubject || null, emailMessage: emailMessage || null,
            ccEmails, bccEmails, termsConditions: termsContent || null,
            showTargetRate,
          }),
        });
        const retryData = await retryRes.json();
        if (!retryRes.ok) { toast(retryData.error || "Failed to save", "error"); return; }
        if (retryData.rfqId && attachments.some((a) => a.file)) await uploadAttachments(retryData.rfqId);
        if (sendStatus === "sent" && retryData.rfqId) {
          try { await apiFetch(`/api/rfq/${retryData.rfqId}/send`, { method: "POST" }); } catch {}
        }
        flashToast(sendStatus === "sent" ? "RFQ created and sent to vendors" : "RFQ saved as draft", "success");
        // Clear dirty so the unsaved-changes guard doesn't fire on the
        // post-save redirect.
        setIsDirty(false);
        isDirtyRef.current = false;
        window.location.href = sendStatus === "sent" ? buildUrl(`/rfp/${retryData.rfqId}`) : buildUrl("/rfp?no_restore=1");
        return;
      }

      if (!res.ok) {
        toast(data.error || "Failed to save", "error");
        return;
      }

      // Upload attachments to S3 after successful save. In edit mode the
      // PATCH response doesn't include rfqId — use editRfqId. Newly-added
      // attachments have a `file` property; existing ones don't.
      const targetRfqId = isEditMode ? editRfqId : data.rfqId;
      if (targetRfqId && attachments.some((a) => a.file)) {
        await uploadAttachments(targetRfqId);
      }

      // If "Create & Send" — trigger the send endpoint to actually send
      // emails. Applies to both fresh creates and edit-mode draft → sent
      // transitions; previously the !isEditMode guard meant clicking
      // "Create & Send" while editing a draft just re-saved it as a draft.
      const sendTargetId = isEditMode ? editRfqId : data.rfqId;
      let sendFailed = false;
      if (sendStatus === "sent" && sendTargetId) {
        try {
          const sendRes = await apiFetch(`/api/rfq/${sendTargetId}/send`, { method: "POST" });
          if (!sendRes.ok) sendFailed = true;
        } catch {
          sendFailed = true;
        }
      }

      // Successful save — clear dirty so the navigation guard doesn't fire
      // on the redirect.
      setIsDirty(false);
      isDirtyRef.current = false;
      // Redirect with a flash toast that the destination page will surface
      if (isEditMode) {
        const msg =
          sendStatus === "sent"
            ? sendFailed
              ? "RFQ updated but failed to send — try Send to Vendors from the detail page"
              : "RFQ sent to vendors"
            : "RFQ updated successfully";
        flashToast(msg, sendFailed ? "error" : "success");
        window.location.href = buildUrl(`/rfp/${editRfqId}`);
      } else {
        flashToast(sendStatus === "sent" ? "RFQ created and sent to vendors" : "RFQ saved as draft", "success");
        window.location.href = sendStatus === "sent" ? buildUrl(`/rfp/${data.rfqId}`) : buildUrl("/rfp?no_restore=1");
      }
    } catch (err) {
      console.error("Save failed:", err);
      toast("Failed to save RFQ. Check console for details.", "error");
    } finally {
      setSaving(false);
      setSavingMode(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ═══ Sticky Header ═══ */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                if (isDirty) {
                  const ok = await confirm({
                    title: "Discard unsaved changes?",
                    message: "All unsaved changes on this RFQ will be lost. Continue?",
                    confirmLabel: "Discard",
                    variant: "danger",
                  });
                  if (!ok) return;
                  isDirtyRef.current = false;
                }
                window.location.href = buildUrl("/rfp?no_restore=1");
              }}
              className="p-1.5 -ml-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
              aria-label="Back to RFQ list"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-bold text-gray-950">
              {isEditMode ? "Edit RFQ" : duplicateFromId ? "Duplicate RFQ" : "Create RFQ"}
              {prefillLoading && <Loader2 className="inline h-4 w-4 animate-spin ml-2 text-gray-400" />}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {elements.length > 0 && (
              <div className="text-right mr-1">
                <p className="text-[10px] text-gray-400 leading-none">Total Amount</p>
                <p className="text-sm font-bold text-gray-900 tabular-nums">{currency.symbol} {formatCurrency(itemTotal)}</p>
              </div>
            )}
            {!isReviseMode && (
              <Button
                variant="outline"
                className={`h-9 text-xs px-4 font-semibold ${savingMode === "draft" ? "disabled:opacity-100" : ""}`}
                disabled={saving}
                onClick={() => handleSave("draft")}
              >
                {savingMode === "draft" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}Save as Draft
              </Button>
            )}
            <Button
              className={`h-9 text-xs px-4 bg-[#E53935] text-white hover:bg-[#C62828] font-semibold ${savingMode === "sent" ? "disabled:opacity-100" : ""}`}
              disabled={saving}
              onClick={() => handleSave("sent")}
            >
              {savingMode === "sent" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}{isReviseMode ? "Revise & Notify" : "Create & Send"}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-5">

        {/* ═══ RFQ DETAILS — flat form card ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-4">
              {/* Row 1: Order, Name, Type, Order Type, Deadline */}
              <div>
                <Label className="text-xs text-gray-500 mb-1.5 block">
                  Draft Order {!isReviseMode && <span className="text-red-500">*</span>}
                </Label>
                {isReviseMode ? (
                  // Source order is locked during revision — render as a
                  // read-only display, not a select. Shows the order number
                  // that was linked at creation time.
                  <div className="h-9 text-sm bg-gray-50 border border-gray-200 rounded-md px-3 flex items-center text-gray-600 cursor-not-allowed" title="Source order is locked after creation">
                    <span className="font-semibold">{reviseInit?.rfq.source_order_number || "—"}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Select value={selectedOrderId} onValueChange={handleOrderChange}>
                      <SelectTrigger className={`h-9 text-sm ${errors.order ? "border-red-500 focus-visible:ring-red-200" : "border-gray-200"} ${loadingOrders ? "opacity-50" : ""}`}>
                        <SelectValue placeholder={loadingOrders ? "Loading..." : "Select Order"} />
                      </SelectTrigger>
                      <SelectContent>
                        {orders.length === 0 && (
                          <div className="px-3 py-4 text-xs text-gray-400 text-center">{loadingOrders ? "Loading..." : "No draft orders"}</div>
                        )}
                        {orders.map((order) => (
                          <SelectItem key={order.id} value={order.id}>
                            <span className="font-semibold">{order.number}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button onClick={fetchDraftOrders} disabled={loadingOrders} className="p-2 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="Refresh">
                      {loadingOrders ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
                {errors.order && <span className="text-[11px] text-red-600 mt-0.5 block">{errors.order}</span>}
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-gray-500 mb-1.5 block">
                  RFQ Name {!isReviseMode && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  value={rfqName}
                  onChange={(e) => setRfqName(e.target.value.slice(0, 50))}
                  maxLength={50}
                  // Orgs with the `rate_per_sqft` config (Client Carpet + Client
                  // Leasable Area) have a specific naming convention they want
                  // surfaced in the placeholder. All other orgs see the generic
                  // prompt.
                  placeholder={has("rate_per_sqft")
                    ? "Enter RFQ Name (Nomenclature: Building Name/Floor No/Date ‘ddmmm’)"
                    : "Enter RFQ name"}
                  readOnly={isReviseMode}
                  disabled={isReviseMode}
                  className={`h-9 text-sm ${isReviseMode ? "bg-gray-50 text-gray-600 cursor-not-allowed" : ""} ${errors.rfqName ? "border-red-500 focus-visible:ring-red-200" : "border-gray-200"}`}
                  title={isReviseMode ? "RFQ name is locked after creation" : undefined}
                />
                {!isReviseMode && (
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[11px] text-red-600">{errors.rfqName || ""}</span>
                    <span className="text-[10px] text-gray-400">{rfqName.length}/50</span>
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <Label className="text-xs text-gray-500">Type {has("rfq_order_type") && <span className="text-red-500">*</span>}</Label>
                  <RfqTypeInfo type={rfqType} size="sm" showBadge={false} />
                </div>
                <Select value={rfqType} onValueChange={(v) => setRfqType(v as "open" | "closed")}>
                  <SelectTrigger className={`h-9 text-sm ${errors.rfqType ? "border-red-500 focus-visible:ring-red-200" : "border-gray-200"}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open Book</SelectItem>
                    <SelectItem value="closed">Closed Book</SelectItem>
                  </SelectContent>
                </Select>
                {errors.rfqType && <span className="text-[11px] text-red-600 mt-0.5 block">{errors.rfqType}</span>}
              </div>
              <div>
                <Label className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> Deadline Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  type="date"
                  value={deadlineDate}
                  onChange={(e) => setDeadlineDate(e.target.value)}
                  // Calendar-only editing — keyboard typing into the day /
                  // month / year segments is blocked, but the native picker
                  // (calendar icon + click on the input) still opens and
                  // sets the value via the synthetic onChange. Same for
                  // paste so the typed value can't sneak in via clipboard.
                  onKeyDown={(e) => {
                    if (e.key !== "Tab") e.preventDefault();
                  }}
                  onPaste={(e) => e.preventDefault()}
                  onClick={(e) => {
                    // Open the native picker on click anywhere in the field.
                    // showPicker() is supported in modern Chromium / WebKit /
                    // Firefox. Falls back to focus on older browsers.
                    const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                    if (typeof el.showPicker === "function") el.showPicker();
                  }}
                  min={new Date().toISOString().split("T")[0]}
                  className={`h-9 text-sm cursor-pointer ${errors.deadline ? "border-red-500 focus-visible:ring-red-200" : "border-gray-200"}`}
                />
                {errors.deadline && <span className="text-[11px] text-red-600 mt-0.5 block">{errors.deadline}</span>}
              </div>

              {/* Row 2: Order Type, Shipping Address */}
              {has("rfq_order_type") && (
                <div>
                  <Label className="text-xs text-gray-500 mb-1.5 block">RFQ Order Type <span className="text-red-500">*</span></Label>
                  <Select value={rfqOrderType || undefined} onValueChange={setRfqOrderType}>
                    <SelectTrigger className={`h-9 text-sm ${errors.rfqOrderType ? "border-red-500 focus-visible:ring-red-200" : "border-gray-200"}`}><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {(getConfig<{ options: string[] }>("rfq_order_type")?.options || ["GC RFQ", "Direct Order"]).map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.rfqOrderType && <span className="text-[11px] text-red-600 mt-0.5 block">{errors.rfqOrderType}</span>}
                </div>
              )}
              <div className={has("rfq_order_type") ? "col-span-2 lg:col-span-4" : "col-span-2 lg:col-span-5"}>
                <Label className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" /> Shipping Address <span className="text-[#E53935]">*</span>
                </Label>
                <Input
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  placeholder="Enter delivery/shipping address"
                  className={`h-9 text-sm ${errors.shippingAddress ? "border-red-500 focus-visible:ring-red-300" : "border-gray-200"}`}
                />
                {errors.shippingAddress && <span className="text-[11px] text-red-600 mt-0.5 block">{errors.shippingAddress}</span>}
              </div>
            </div>

            {/* Vendor portal disclosure controls */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showTargetRate}
                  onChange={(e) => setShowTargetRate(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#E53935] focus:ring-[#E53935]/30"
                />
                <span>
                  <span className="text-sm font-medium text-gray-800">Show target rate to vendors</span>
                  <span className="text-[11px] text-gray-500 block mt-0.5">
                    When on, the vendor portal displays the Target Rate, Target Amount and Deviation % columns. Leave off to keep your internal rate estimate private.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Status bar — hidden in revise mode (source order is locked) */}
          {!isReviseMode && (
            <div className="px-6 py-2.5 border-t border-gray-100 flex items-center gap-6 text-sm">
              <span className="text-gray-500">Order Status: <span className="font-bold text-gray-900">Not Sent</span></span>
            </div>
          )}
        </div>

        {/* ═══ REVISE-ONLY: Current Vendors / New Items / Portal Option ═══ */}
        {isReviseMode && reviseInit && (
          <>
            {/* Current vendors — buyer can remove non-submitted, reopen expired */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Current Vendors ({reviseInit.invitations.length})</h3>
                <div className="text-xs text-gray-500">
                  {removeVendorIds.size > 0 && <span className="text-red-500 mr-3">{removeVendorIds.size} to remove</span>}
                  {reopenVendorIds.size > 0 && <span className="text-green-600">{reopenVendorIds.size} to reopen</span>}
                </div>
              </div>
              <div className="divide-y divide-gray-100 max-h-[240px] overflow-y-auto">
                {reviseInit.invitations.map((v) => {
                  const sub = reviseInit.submissions.find((s) => s.vendor_id === v.vendor_id);
                  const hasSubmitted = sub?.status === "submitted";
                  const isExpiredVendor = sub?.status === "expired" || v.status === "expired";
                  const isMarkedForRemoval = removeVendorIds.has(v.vendor_id);
                  const isMarkedForReopen = reopenVendorIds.has(v.vendor_id);
                  return (
                    <div key={v.id} className={`flex items-center justify-between px-6 py-3 ${isMarkedForRemoval ? "bg-red-50 line-through opacity-60" : isMarkedForReopen ? "bg-green-50" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{v.vendor_name}</span>
                        {hasSubmitted && <span className="text-[11px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">Submitted</span>}
                        {isExpiredVendor && !isMarkedForReopen && <span className="text-[11px] bg-gray-100 text-gray-500 border border-gray-200 rounded px-1.5 py-0.5">Expired</span>}
                        {isMarkedForReopen && <span className="text-[11px] bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5">Will Reopen</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        {isExpiredVendor && (
                          <button onClick={() => setReopenVendorIds((prev) => { const next = new Set(prev); if (next.has(v.vendor_id)) next.delete(v.vendor_id); else next.add(v.vendor_id); return next; })} className={`text-xs ${isMarkedForReopen ? "text-gray-500" : "text-green-600 hover:text-green-800"}`}>
                            {isMarkedForReopen ? "Undo" : "Reopen"}
                          </button>
                        )}
                        {!hasSubmitted && !isExpiredVendor && (
                          <button onClick={() => setRemoveVendorIds((prev) => { const next = new Set(prev); if (next.has(v.vendor_id)) next.delete(v.vendor_id); else next.add(v.vendor_id); return next; })} className="text-xs text-red-500 hover:text-red-700">
                            {isMarkedForRemoval ? "Undo" : "Remove"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* New items in source rDash order (only render when there are any) */}
            {reviseInit.newSourceItems.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    New items in source order
                    <span className="text-gray-400 ml-2 font-normal">({reviseInit.newSourceItems.length})</span>
                    {selectedNewItemIds.size > 0 && <span className="text-blue-600 ml-2 font-normal">— {selectedNewItemIds.size} selected</span>}
                  </h3>
                  <div className="flex items-center gap-3 text-xs">
                    <button onClick={() => setSelectedNewItemIds(new Set(reviseInit.newSourceItems.map((i) => i.id)))} className="text-blue-600 hover:underline">Select all</button>
                    <button onClick={() => setSelectedNewItemIds(new Set())} className="text-gray-500 hover:underline">Clear</button>
                  </div>
                </div>
                <div className="divide-y divide-gray-100 max-h-[240px] overflow-y-auto">
                  {reviseInit.newSourceItems.map((it) => {
                    const checked = selectedNewItemIds.has(it.id);
                    return (
                      <label key={it.id} className="flex items-center gap-3 px-6 py-2.5 cursor-pointer hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSelectedNewItemIds((prev) => { const next = new Set(prev); if (checked) next.delete(it.id); else next.add(it.id); return next; })}
                          className="h-4 w-4"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{it.name}</div>
                          {it.description && <div className="text-xs text-gray-500 truncate">{it.description}</div>}
                        </div>
                        <div className="text-xs text-gray-500 whitespace-nowrap">
                          {it.quantity ? `Qty ${it.quantity}` : ""} {it.uom?.name || ""}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Portal reopen option */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-4">
              <div className="text-sm font-semibold text-gray-900 mb-2">Reopen vendor portal for</div>
              <div className="flex items-center gap-6 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="portalOption" checked={revisePortalOption === "all"} onChange={() => setRevisePortalOption("all")} />
                  <span>All vendors (everyone gets a chance to resubmit)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="portalOption" checked={revisePortalOption === "new_only"} onChange={() => setRevisePortalOption("new_only")} />
                  <span>Only newly added vendors</span>
                </label>
              </div>
            </div>
          </>
        )}

        {/* Create / edit / duplicate only — loading + error placeholders for the
            rDash element fetch. Revise mode bypasses element fetching entirely. */}
        {!isReviseMode && loadingElements && (
          <div className="flex items-center gap-2.5 text-sm text-gray-500 bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
            <Loader2 className="h-4 w-4 animate-spin text-[#E53935]" />
            Loading package items...
          </div>
        )}

        {!isReviseMode && !loadingElements && elementError && (
          <div className="bg-white rounded-xl border border-orange-200 shadow-sm p-5">
            <div className="flex items-center gap-3 text-orange-600">
              <div className="h-8 w-8 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0">
                <Package className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">{elementError}</p>
                <p className="text-xs text-orange-500 mt-0.5">Try selecting a different draft order</p>
              </div>
            </div>
          </div>
        )}

        {/* Revise mode: BOQ items table from the existing RFQ.
            Row data is read-only (qty / target rate / etc can't be edited
            during revision) but the buyer can mark rows for removal with
            the trash icon. Marked rows stay visible with strike-through
            until submit so the action is reversible. */}
        {isReviseMode && reviseInit && reviseInit.items.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                BOQ Items <span className="text-gray-400 font-normal ml-1">({reviseInit.items.length})</span>
                {removeRfqItemIds.size > 0 && <span className="text-red-500 ml-2 font-normal text-xs">— {removeRfqItemIds.size} to remove</span>}
              </h3>
              <span className="text-[11px] text-gray-500">Rates and quantities are read-only. Use the section above to add new items, or the trash icon to remove existing ones.</span>
            </div>
            <div className="overflow-x-auto max-h-[40vh] overflow-y-auto">
              <Table>
                <TableHeader className="bg-gray-50 sticky top-0">
                  <TableRow>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 w-12">Sr</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 min-w-[180px]">Item</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 min-w-[160px]">Description</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 min-w-[110px]">Code</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 min-w-[120px]">Brand / Make</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 min-w-[100px]">HSN</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 min-w-[120px]">Category</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 min-w-[120px]">Item Type</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 text-right w-24">Qty</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 w-20">UOM</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 text-right w-32">Target Rate</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 text-right w-32">Amount</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider text-gray-500 w-12 text-center">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviseInit.items.map((it) => {
                    const isMarkedForRemoval = removeRfqItemIds.has(it.id);
                    return (
                      <TableRow key={it.id} className={`hover:bg-gray-50 ${isMarkedForRemoval ? "bg-red-50 line-through opacity-60" : ""}`}>
                        <TableCell className="text-xs text-gray-500">{it.sr_no}</TableCell>
                        <TableCell className="text-sm font-medium text-gray-800">{it.item_name}</TableCell>
                        <TableCell className="text-xs text-gray-600 max-w-[260px] truncate" title={it.description || undefined}>{it.description || "—"}</TableCell>
                        <TableCell className="text-xs text-gray-600">{it.code || "—"}</TableCell>
                        <TableCell className="text-xs text-gray-600">{it.brand_make || "—"}</TableCell>
                        <TableCell className="text-xs text-gray-600 font-mono">{it.hsn_code || "—"}</TableCell>
                        <TableCell className="text-xs text-gray-600">{it.category || "—"}</TableCell>
                        <TableCell className="text-xs text-gray-600">{it.item_type || "—"}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {it.source_changed ? (
                            <span className="inline-flex items-center gap-1 justify-end" title="Quantity updated in the source order — will be applied on save">
                              <span className="text-gray-400 line-through text-xs">{Number(it.original_quantity ?? 0).toLocaleString("en-IN")}</span>
                              <span className="font-semibold text-[#E53935]">{Number(it.quantity).toLocaleString("en-IN")}</span>
                            </span>
                          ) : (
                            Number(it.quantity).toLocaleString("en-IN")
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-gray-600">{it.uom || "—"}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{formatCurrency(Number(it.target_rate))}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{formatCurrency(Number(it.amount))}</TableCell>
                        <TableCell className="text-center">
                          <button
                            type="button"
                            onClick={() => setRemoveRfqItemIds((prev) => { const next = new Set(prev); if (next.has(it.id)) next.delete(it.id); else next.add(it.id); return next; })}
                            title={isMarkedForRemoval ? "Undo remove" : "Remove this item"}
                            className={`text-xs ${isMarkedForRemoval ? "text-gray-500 hover:text-gray-700" : "text-red-500 hover:text-red-700"}`}
                          >
                            {isMarkedForRemoval ? "Undo" : "Remove"}
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* ═══ 3. PACKAGE ITEMS (create / edit / duplicate only — revise has its own read-only table above) ═══ */}
        {!isReviseMode && elements.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Section tabs bar */}
            <div className="flex items-center border-b border-gray-200 px-1">
              <SectionTab label="All" count={elements.length} active={activeSection === "all"} onClick={() => setActiveSection("all")} isRed />
              {sectionNames.map((sec) => (
                <SectionTab key={sec} label={sec} count={sections.get(sec)?.length || 0} active={activeSection === sec} onClick={() => setActiveSection(sec)} />
              ))}
            </div>

            {/* Items table */}
            <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-gray-50">
                  {/* Single merged header row — column label stacked above its filter input,
                      one cell per column so they line up exactly. */}
                  <TableRow className="border-b border-gray-200 [&>th]:bg-gray-50 [&>th]:border-0 [&>th]:py-2 [&>th]:px-2 [&>th]:align-top">
                    <TableHead className="w-10 pl-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Sr.</div>
                        {(() => {
                          const filtersActive = !!itemSearch || itemFilters.category.length > 0 || itemFilters.itemType.length > 0 || itemFilters.uom.length > 0;
                          const cls = filtersActive ? "text-[#E53935]" : "text-gray-400";
                          const fill = filtersActive ? "currentColor" : "none";
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                if (!filtersActive) return;
                                setItemSearch("");
                                setItemFilters({ category: [], itemType: [], uom: [] });
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
                    <TableHead className="min-w-[180px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Item</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[150px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Description</div>
                        <SmallSearch value={itemSearch} onChange={setItemSearch} />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[120px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Code</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[120px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Brand / Make</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[110px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">HSN</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[140px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Category</div>
                        <MultiSelectFilter options={categoryOptions} selected={itemFilters.category} onChange={(v) => setItemFilters((f) => ({ ...f, category: v }))} />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[140px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Item Type</div>
                        <MultiSelectFilter options={itemTypeOptions} selected={itemFilters.itemType} onChange={(v) => setItemFilters((f) => ({ ...f, itemType: v }))} />
                      </div>
                    </TableHead>
                    <TableHead className="w-20 text-right">
                      <div className="flex flex-col gap-1.5 items-end">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Quantity</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="min-w-[140px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">UOM</div>
                        <MultiSelectFilter options={uomOptions} selected={itemFilters.uom} onChange={(v) => setItemFilters((f) => ({ ...f, uom: v }))} />
                      </div>
                    </TableHead>
                    <TableHead className="w-28 text-right">
                      <div className="flex flex-col gap-1.5 items-end">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">
                          Target Rate ({currency.symbol})
                          {isOpenBook && <Badge variant="outline" className="ml-1 text-[9px] border-green-200 bg-green-50 text-green-700">Open</Badge>}
                        </div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                    <TableHead className="w-28 text-right pr-4">
                      <div className="flex flex-col gap-1.5 items-end">
                        <div className="text-[11px] font-semibold tracking-wide text-gray-700">Amount ({currency.symbol})</div>
                        <div className="h-7" />
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedElements.map((group) => (
                    <React.Fragment key={group.section}>
                      <TableRow className="bg-gray-50/50 hover:bg-gray-50">
                        {/* Section checkbox hidden */}
                        <TableCell colSpan={12} className="font-semibold text-[13px] text-gray-800">
                          {group.section}
                          <span className="ml-2 text-xs font-normal text-gray-400">({group.items.length} items)</span>
                        </TableCell>
                      </TableRow>
                      {group.items.map((el) => {
                        const qty = parseFloat(el.quantity) || 0;
                        const rate = parseFloat(el.budget_rate || "") || parseFloat(el.client_rate) || 0;
                        const amount = qty * rate;
                        return (
                          <TableRow key={el.id} className="hover:bg-blue-50/30 transition-colors">
                            {/* Row checkbox hidden */}
                            <TableCell className="text-xs text-gray-400 font-semibold">{el.globalIdx}.</TableCell>
                            <TableCell className="text-[13px] font-semibold text-gray-900">{el.name}</TableCell>
                            <TableCell className="text-xs text-gray-500 max-w-[180px] truncate">{el.description || "—"}</TableCell>
                            <TableCell className="text-[11px] text-gray-500 font-mono">{el.code}</TableCell>
                            <TableCell className="text-xs text-gray-600 break-words">{el.brand_make || "—"}</TableCell>
                            <TableCell className="text-xs text-gray-500 font-mono break-words">{el.hsn_code || "—"}</TableCell>
                            <TableCell className="text-xs text-gray-600">{el.category?.name || "—"}</TableCell>
                            <TableCell className="text-xs text-gray-600">{el.item_type?.name || "—"}</TableCell>
                            <TableCell className="text-right text-[13px] text-gray-900 tabular-nums">{qty || "—"}</TableCell>
                            <TableCell className="text-xs text-gray-600">{el.uom?.name || "—"}</TableCell>
                            <TableCell className="text-right text-[13px] text-gray-900 tabular-nums">{rate ? formatCurrency(rate) : "—"}</TableCell>
                            <TableCell className="text-right text-[13px] text-gray-900 tabular-nums pr-4">{amount ? formatCurrency(amount) : "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200">
              <div className="px-5 py-2.5 flex items-center justify-between">
                <span />
                <span className="text-xs text-gray-500">{elements.length} item{elements.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex justify-end items-center px-5 py-3 bg-gray-50/80 border-t border-gray-100">
                <span className="text-[13px] font-semibold text-gray-600 mr-10">Item Total</span>
                <span className="text-[13px] font-bold text-gray-900 tabular-nums">{formatCurrency(itemTotal)}</span>
              </div>
            </div>
          </div>
        )}

        {/* ═══ 4. ATTACHMENTS ═══ */}
        <input ref={fileInputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.doc,.docx,.jpeg,.jpg,.png" className="hidden" onChange={handleFileSelect} />
        {attachments.length === 0 ? (
          // No files yet — show only the "+ Add Attachment" affordance.
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[13px] font-semibold text-[#E53935] hover:text-[#C62828] transition-colors"
              >
                + Add Attachment
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow className="bg-gray-50/70">
                  <TableHead className="w-12 text-xs font-semibold text-gray-500 pl-5">Sr.</TableHead>
                  <TableHead className="min-w-[250px] text-xs font-semibold text-gray-500">Attachments</TableHead>
                  <TableHead className="min-w-[120px] text-xs font-semibold text-gray-500">Size</TableHead>
                  <TableHead className="min-w-[120px] text-xs font-semibold text-gray-500">Added On</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {attachments.map((att, idx) => (
                  <TableRow key={att.id}>
                    <TableCell className="text-xs text-gray-400 pl-5">{idx + 1}.</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                          <FileText className="h-4 w-4 text-red-500" />
                        </div>
                        <span className="text-sm font-semibold text-gray-900">{att.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">{att.size}</TableCell>
                    <TableCell className="text-xs text-gray-500">{att.uploadedAt}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 rounded-full hover:bg-gray-100 transition-colors">
                            <MoreVertical className="h-3.5 w-3.5 text-gray-400" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-32">
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            onClick={() => removeAttachment(att.id)}
                          >
                            <X className="mr-2 h-3.5 w-3.5" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-5 py-2.5 border-t border-gray-100">
              <button onClick={() => fileInputRef.current?.click()} className="text-[13px] font-semibold text-[#E53935] hover:text-[#C62828] transition-colors">
                + Add Attachment
              </button>
            </div>
          </div>
        )}

        {/* ═══ 5. TERMS & CONDITION ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3">Terms & Condition</h3>
            <Textarea
              value={termsContent}
              onChange={(e) => setTermsContent(e.target.value)}
              placeholder="Type Terms & Conditions Here"
              className="min-h-[150px] text-sm border-gray-200 focus:ring-[#E53935]"
            />
          </div>
        </div>

        {/* ═══ 6. BIDDERS ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Header with search */}
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-gray-900">Bidders</h3>
              {selectedVendorIds.size > 0 && (
                <>
                  <Badge variant="secondary" className="text-[11px] font-semibold bg-[#E53935]/10 text-[#E53935]">
                    {selectedVendorIds.size} selected
                  </Badge>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedVendorIds(new Set()); }}
                    className="text-[11px] font-medium text-gray-500 hover:text-[#E53935]"
                  >
                    Deselect all
                  </button>
                </>
              )}
            </div>
            <div className="relative w-[280px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
                placeholder="Search vendors by name or code..."
                className="h-8 pl-9 text-xs border-gray-200 bg-gray-50"
              />
            </div>
          </div>

          {/* Selected vendors with POC info */}
          {selectedVendorIds.size > 0 && (
            <div className="border-b border-gray-200">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow className="bg-red-50/40">
                    <TableHead className="w-12 text-xs font-semibold text-gray-500 pl-5">Sr.</TableHead>
                    <TableHead className="min-w-[200px] text-xs font-semibold text-gray-500">Vendor Name</TableHead>
                    <TableHead className="min-w-[280px] text-xs font-semibold text-gray-500">Vendor POC</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from(selectedVendorIds)
                    .map((id) => lookupVendor(id))
                    .filter((v): v is VendorRec => !!v)
                    .map((v, idx) => {
                    const user = vendorUsers[v.id];
                    const isEditing = editingPocVendor === v.id;
                    return (
                      <TableRow key={v.id} className="bg-red-50/20 align-top">
                        <TableCell className="text-xs text-gray-500 pl-5 pt-3">{idx + 1}.</TableCell>
                        <TableCell className="pt-3">
                          <div className="text-sm font-semibold text-gray-900">{v.name}</div>
                        </TableCell>
                        <TableCell className="pt-3">
                          {isEditing ? (() => {
                            const trimmedName = editPocName.trim();
                            const trimmedEmail = editPocEmail.trim();
                            const origName = (user?.name || "").trim();
                            const origEmail = (user?.email || "").trim();
                            const hasContent = !!trimmedName || !!trimmedEmail;
                            const hasChanged = trimmedName !== origName || trimmedEmail !== origEmail;
                            const canSave = hasContent && hasChanged;
                            return (
                            <div className="space-y-1.5">
                              <Input
                                value={editPocName}
                                onChange={(e) => setEditPocName(e.target.value)}
                                placeholder="POC Name"
                                className="h-7 text-xs w-[200px]"
                                autoFocus
                              />
                              <Input
                                value={editPocEmail}
                                onChange={(e) => setEditPocEmail(e.target.value)}
                                placeholder="POC Email"
                                className="h-7 text-xs w-[200px]"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && canSave) savePocDetails(v.id);
                                  if (e.key === "Escape") setEditingPocVendor(null);
                                }}
                              />
                              <div className="flex gap-1">
                                <Button
                                  variant="outline"
                                  className="h-6 text-[10px] px-2"
                                  disabled={!canSave}
                                  onClick={() => savePocDetails(v.id)}
                                >
                                  Save
                                </Button>
                                <Button variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setEditingPocVendor(null)}>Cancel</Button>
                              </div>
                            </div>
                            );
                          })() : user ? (
                            user.email ? (
                              <div className="text-xs text-gray-600">
                                {user.name && <span className="font-semibold text-gray-700">{user.name}</span>}
                                {user.name && " · "}
                                <span>{user.email}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">No POC found — <button className="text-[#E53935] hover:underline" onClick={() => { setEditingPocVendor(v.id); setEditPocName(""); setEditPocEmail(""); }}>Add manually</button></span>
                            )
                          ) : (
                            <span className="text-xs text-gray-400 italic">Loading...</span>
                          )}
                        </TableCell>
                        <TableCell className="pt-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 rounded hover:bg-gray-100">
                                <MoreVertical className="h-3.5 w-3.5 text-gray-400" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem className="text-xs" onClick={() => { setEditingPocVendor(v.id); setEditPocName(user?.name || ""); setEditPocEmail(user?.email || ""); }}>
                                Edit POC Details
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-xs text-red-600" onClick={() => toggleVendor(v.id)}>
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Scrollable vendor list */}
          <div className="max-h-[35vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow className="bg-gray-50/70">
                  <TableHead className="w-10 pl-5" />
                  <TableHead className="text-xs font-semibold text-gray-500">Vendor Name</TableHead>
                  <TableHead className="w-[200px] text-xs font-semibold text-gray-500 text-right pr-4">
                    {(() => {
                      const visible = filteredVendors.length;
                      const visibleSelected = filteredVendors.filter((v) => selectedVendorIds.has(v.id)).length;
                      const remaining = visible - visibleSelected;
                      if (visible === 0) return <span className="text-xs">Code</span>;
                      return (
                        <div className="inline-flex items-center gap-3">
                          {remaining > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectAllVisibleVendors(); }}
                              className="text-[11px] font-medium text-[#E53935] hover:text-[#C62828]"
                            >
                              + Select all ({remaining})
                            </button>
                          )}
                          {visibleSelected > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); deselectAllVisibleVendors(); }}
                              className="text-[11px] font-medium text-gray-500 hover:text-[#E53935]"
                            >
                              − Deselect ({visibleSelected})
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVendors.filter((v) => !selectedVendorIds.has(v.id)).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-6 text-xs text-gray-400">
                      {vendorsPermissionDenied
                        ? "You don't have permission to view vendors. Ask your admin for vendor management access."
                        : vendorSearch
                          ? "No vendors match your search"
                          : "All vendors have been selected"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredVendors.filter((v) => !selectedVendorIds.has(v.id)).map((v) => (
                    <TableRow key={v.id} className="cursor-pointer hover:bg-blue-50/30 transition-colors" onClick={() => toggleVendor(v.id)}>
                      <TableCell className="pl-5"><Checkbox checked={false} /></TableCell>
                      <TableCell className="text-sm text-gray-700">{v.name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] font-mono bg-gray-50">{v.code}</Badge></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Footer */}
          <div className="px-5 py-2.5 border-t border-gray-100 flex items-center justify-between">
            <span />
            <span className="text-[11px] text-gray-400">{filteredVendors.length} vendors available</span>
          </div>
        </div>

        {/* ═══ 7. EMAIL CONFIGURATION (collapsible) ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <button onClick={() => setEmailOpen(!emailOpen)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <Mail className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <span className="text-sm font-bold text-gray-900">Email Configuration</span>
            </div>
            {emailOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>
          {emailOpen && (
            <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-4">
              <div>
                <Label className="text-xs text-gray-500 mb-1.5 block">Subject</Label>
                <Input
                  value={computedSubject}
                  readOnly
                  disabled
                  className="h-10 text-sm border-gray-200 bg-gray-50 text-gray-600 cursor-not-allowed"
                  title="Subject is auto-generated from the selected order"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500 mb-1.5 block">Custom Message</Label>
                <Textarea
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  placeholder="Add a custom message to the RFQ email..."
                  className="min-h-[100px] text-sm border-gray-200"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-500 mb-1.5 block">CC Emails</Label>
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 min-h-[40px]">
                  {ccEmails.map((email) => (
                    <Badge key={email} variant="secondary" className="flex items-center gap-1 text-xs py-1 bg-gray-100">
                      {email}
                      <button onClick={() => setCcEmails((prev) => prev.filter((e) => e !== email))} className="ml-0.5 rounded-full hover:bg-gray-300">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <input
                    name="rfq-cc-field"
                    autoComplete="off"
                    readOnly={ccReadOnly}
                    onFocus={() => setCcReadOnly(false)}
                    value={ccInput}
                    onChange={(e) => setCcInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addCcEmail(); } }}
                    onBlur={() => { setCcReadOnly(true); addCcEmail(); }}
                    placeholder={ccEmails.length === 0 ? "Add email and press Enter" : ""}
                    className="flex-1 min-w-[150px] border-none bg-transparent text-sm outline-none placeholder:text-gray-400"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-gray-500 mb-1.5 block">BCC Emails</Label>
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 min-h-[40px]">
                  {bccEmails.map((email) => (
                    <Badge key={email} variant="secondary" className="flex items-center gap-1 text-xs py-1 bg-gray-100">
                      {email}
                      <button onClick={() => setBccEmails((prev) => prev.filter((e) => e !== email))} className="ml-0.5 rounded-full hover:bg-gray-300">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  <input
                    name="rfq-bcc-field"
                    autoComplete="off"
                    readOnly={bccReadOnly}
                    onFocus={() => setBccReadOnly(false)}
                    value={bccInput}
                    onChange={(e) => setBccInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addBccEmail(); } }}
                    onBlur={() => { setBccReadOnly(true); addBccEmail(); }}
                    placeholder={bccEmails.length === 0 ? "Add email and press Enter" : ""}
                    className="flex-1 min-w-[150px] border-none bg-transparent text-sm outline-none placeholder:text-gray-400"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Notified only when the RFQ is floated and when it is awarded.</p>
              </div>
            </div>
          )}
        </div>

        {/* ═══ BOTTOM ACTIONS ═══ */}
        <div className="flex items-center gap-3 pb-8">
          {/* Save Draft only applies to create/edit/duplicate — revise has
              no draft state (an existing RFQ is already past draft). */}
          {!isReviseMode && (
            <Button
              variant="outline"
              className={`h-10 px-6 font-semibold ${savingMode === "draft" ? "disabled:opacity-100" : ""}`}
              disabled={saving}
              onClick={() => handleSave("draft")}
            >
              {savingMode === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : null}Save as Draft
            </Button>
          )}
          <Button
            className={`h-10 px-6 bg-[#E53935] text-white hover:bg-[#C62828] shadow-sm font-semibold ${savingMode === "sent" ? "disabled:opacity-100" : ""}`}
            disabled={saving}
            onClick={() => handleSave("sent")}
          >
            {savingMode === "sent" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : null}{isReviseMode ? "Revise & Notify" : "Create & Send"}
          </Button>
          <Button
            variant="outline"
            className="h-10 px-6 font-semibold"
            onClick={async () => {
              if (isDirty) {
                const ok = await confirm({
                  title: "Discard unsaved changes?",
                  message: "All unsaved changes on this RFQ will be lost. Continue?",
                  confirmLabel: "Discard",
                  variant: "danger",
                });
                if (!ok) return;
                isDirtyRef.current = false;
              }
              // Cancel navigation target:
              //   - revise mode  → back to the RFQ detail page
              //   - everything else → list (no_restore=1 so the cookie's
              //     lastPath doesn't auto-restore to the just-cancelled form)
              window.location.href = isReviseMode && reviseRfqId
                ? buildUrl(`/rfp/${reviseRfqId}`)
                : buildUrl("/rfp?no_restore=1");
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════ */

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">{children}</div>;
}

function CardHeader({ icon, title, step }: { icon: React.ReactNode; title: string; step: number }) {
  return (
    <div className="px-5 pt-4 pb-3 flex items-center gap-3">
      <div className="h-7 w-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">{icon}</div>
      <div>
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Step {step}</span>
        <h2 className="text-sm font-semibold text-gray-900 -mt-0.5">{title}</h2>
      </div>
    </div>
  );
}

function SectionTab({ label, count, active, onClick, isRed = false }: { label: string; count: number; active: boolean; onClick: () => void; isRed?: boolean }) {
  return (
    <button onClick={onClick} className={`px-3 py-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${active ? "border-[#E53935] text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
      {label}
      <span className={`text-[10px] min-w-[18px] text-center px-1.5 py-0.5 rounded-full font-semibold ${active && isRed ? "bg-[#E53935] text-white" : active ? "bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-500"}`}>
        {count}
      </span>
    </button>
  );
}

function SmallSearch({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
      <Input
        value={value || ""}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder="Search"
        className="h-7 pl-7 text-xs border-gray-200 bg-white"
        readOnly={!onChange}
      />
    </div>
  );
}

