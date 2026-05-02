import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Search,
  ClipboardCheck,
  AlertTriangle,
  Clock,
  Activity,
  Pencil,
  History,
  Truck,
  PackageCheck,
  Hourglass,
  X,
  Columns3,
  GripVertical,
  CalendarIcon,
  Eye,
  EyeOff,
  StickyNote,
  Check,
  ChevronDown,
  PhoneOff,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";
import OrderHistoryModal from "@/components/OrderHistoryModal";
import OrioTrackingModal from "@/components/OrioTrackingModal";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Segment = "all" | "failed_attempt" | "delayed" | "on_going" | "none";
type DateField = "created" | "updated";

const FOLLOW_UP_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "contacted_courier", label: "Contacted Courier" },
  { value: "contacted_client", label: "Contacted Client" },
  { value: "client_confirmed", label: "Client Confirmed" },
  { value: "resent_to_courier", label: "Resent to Courier" },
  { value: "no_answer", label: "No Answer" },
  { value: "closed", label: "Closed" },
];

const followUpStatusStyle: Record<string, string> = {
  pending:           "bg-[hsl(30,6%,50%)]/12  text-[hsl(30,6%,50%)]    border-[hsl(30,6%,50%)]/25",
  contacted_courier: "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)]  border-[hsl(210,60%,52%)]/25",
  contacted_client:  "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)]  border-[hsl(200,65%,50%)]/25",
  client_confirmed:  "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)]  border-[hsl(155,50%,42%)]/25",
  resent_to_courier: "bg-[hsl(270,50%,55%)]/12 text-[hsl(270,50%,55%)]  border-[hsl(270,50%,55%)]/25",
  no_answer:         "bg-[hsl(0,65%,52%)]/12   text-[hsl(0,65%,52%)]    border-[hsl(0,65%,52%)]/25",
  closed:            "bg-[hsl(155,50%,42%)]/15 text-[hsl(155,50%,42%)]  border-[hsl(155,50%,42%)]/30 font-semibold",
};

const deliveryStatusStyle: Record<string, string> = {
  pending:          "bg-[hsl(30,6%,50%)]/12   text-[hsl(30,6%,50%)]   border-[hsl(30,6%,50%)]/25",
  booked:           "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/25",
  shipped:          "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/25",
  in_transit:       "bg-[hsl(230,55%,55%)]/12 text-[hsl(230,55%,55%)] border-[hsl(230,55%,55%)]/25",
  with_courier:     "bg-[hsl(185,55%,42%)]/12 text-[hsl(185,55%,42%)] border-[hsl(185,55%,42%)]/25",
  out_for_delivery: "bg-[hsl(185,55%,42%)]/12 text-[hsl(185,55%,42%)] border-[hsl(185,55%,42%)]/25",
  delivered:        "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/25",
  returned:         "bg-[hsl(0,65%,52%)]/12   text-[hsl(0,65%,52%)]   border-[hsl(0,65%,52%)]/25",
  cancelled:        "bg-[hsl(0,65%,52%)]/12   text-[hsl(0,65%,52%)]   border-[hsl(0,65%,52%)]/25",
  failed_attempt:   "bg-[hsl(0,65%,52%)]/12   text-[hsl(0,65%,52%)]   border-[hsl(0,65%,52%)]/25",
  ready_for_return: "bg-[hsl(15,75%,55%)]/12  text-[hsl(15,75%,55%)]  border-[hsl(15,75%,55%)]/25",
  rejected:         "bg-[hsl(0,65%,52%)]/12   text-[hsl(0,65%,52%)]   border-[hsl(0,65%,52%)]/25",
};

interface FollowUpRow {
  order_id: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  delivery_status: string | null;
  shipping_status: string | null;
  orio_order_id: number | null;
  orio_consignment_no: string | null;
  shipped_at: string | null;
  days_since_shipped: number | null;
  follow_up_status: string;
  follow_up_updated_at: string | null;
  follow_up_updated_by: string | null;
  order_created_at: string;
  order_updated_at: string;
  seller_id: string | null;
  seller_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  follow_up_assigned_to: string | null;
  follow_up_note: string | null;
  product_name: string | null;
  total_amount: number | null;
  fu_no_answer_count: number;
}

function computeSegment(row: FollowUpRow): "failed_attempt" | "delayed" | "on_going" | null {
  const ds = row.delivery_status;
  const days = row.days_since_shipped ?? 0;
  if (ds === "failed_attempt") return "failed_attempt";
  if (["shipped", "in_transit", "out_for_delivery", "with_courier"].includes(ds ?? "") && days >= 3) return "delayed";
  if (["shipped", "in_transit", "out_for_delivery", "with_courier"].includes(ds ?? "") && days < 3)  return "on_going";
  return null;
}

const segmentMeta: Record<
  "failed_attempt" | "delayed" | "on_going",
  { label: string; color: string; chip: string; icon: typeof AlertTriangle }
> = {
  failed_attempt: { label: "Failed Attempt", color: "hsl(0,65%,52%)",   chip: "bg-[hsl(0,65%,52%)]/15 text-[hsl(0,65%,52%)]",   icon: AlertTriangle },
  delayed:        { label: "Delayed",        color: "hsl(25,85%,55%)",  chip: "bg-[hsl(25,85%,55%)]/15 text-[hsl(25,85%,55%)]",  icon: Clock },
  on_going:       { label: "On Going",       color: "hsl(210,60%,52%)", chip: "bg-[hsl(210,60%,52%)]/15 text-[hsl(210,60%,52%)]", icon: Activity },
};

function rowAccentStyle(row: FollowUpRow & { segment: "failed_attempt" | "delayed" | "on_going" | null }) {
  if (row.segment === "failed_attempt") return { boxShadow: "inset 3px 0 0 hsl(0 65% 52% / 0.6)" };
  if (row.segment === "delayed")        return { boxShadow: "inset 3px 0 0 hsl(25 85% 55% / 0.6)" };
  if (row.segment === "on_going")       return { boxShadow: "inset 3px 0 0 hsl(210 60% 52% / 0.5)" };
  if (row.delivery_status === "delivered") return { boxShadow: "inset 3px 0 0 hsl(155 50% 42% / 0.5)" };
  return {};
}

function formatStatus(status: string | null): string {
  if (!status) return "—";
  return status.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function StatusPill({ value, styleMap }: { value: string | null; styleMap: Record<string, string> }) {
  if (!value) return <span className="text-muted-foreground text-xs">—</span>;
  const cls = styleMap[value] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${cls}`}>
      {formatStatus(value)}
    </span>
  );
}

/* ── Column system ── */
type ColumnKey =
  | "order_id" | "orio_id" | "customer" | "phone" | "city"
  | "product"  | "price"   | "delivery" | "segment" | "days"
  | "follow_up"| "note"    | "created"  | "updated" | "actions";

const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "order_id",  label: "Order ID"   },
  { key: "orio_id",   label: "ORIO ID"    },
  { key: "customer",  label: "Customer"   },
  { key: "phone",     label: "Phone"      },
  { key: "city",      label: "City"       },
  { key: "product",   label: "Product"    },
  { key: "price",     label: "Price"      },
  { key: "delivery",  label: "Delivery"   },
  { key: "segment",   label: "Sub Status" },
  { key: "days",      label: "Days"       },
  { key: "follow_up", label: "Follow Up"  },
  { key: "note",      label: "FU Note"    },
  { key: "created",   label: "Created"    },
  { key: "updated",   label: "Updated"    },
  { key: "actions",   label: "Actions"    },
];

const STORAGE_KEY = "follow-ups:column-config:v4";
type ColumnConfig = { key: ColumnKey; visible: boolean };

function loadColumnConfig(): ColumnConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("none");
    const parsed = JSON.parse(raw) as ColumnConfig[];
    const existingKeys = new Set(parsed.map((c) => c.key));
    return [
      ...parsed.filter((c) => ALL_COLUMNS.some((a) => a.key === c.key)),
      ...ALL_COLUMNS.filter((a) => !existingKeys.has(a.key)).map((a) => ({ key: a.key, visible: true })),
    ];
  } catch {
    return ALL_COLUMNS.map((c) => ({ key: c.key, visible: true }));
  }
}

export default function FollowUps() {
  const { authUser, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [segment, setSegment]           = useState<Segment>("all");
  const [search, setSearch]             = useState("");
  const [filterDelivery, setFilterDelivery] = useState<string>("all");
  const [filterSeller, setFilterSeller] = useState<string>("all");
  const [filterAgent, setFilterAgent]   = useState<string>("all");
  const [filterFollowUp, setFilterFollowUp] = useState<string>("all");
  const [dateField, setDateField]       = useState<DateField>("created");
  const [dateRange, setDateRange]       = useState<DateRange | undefined>();
  const [savingId, setSavingId]         = useState<string | null>(null);
  const [historyOrder, setHistoryOrder] = useState<{ id: string; customer: string } | null>(null);
  const [trackingTarget, setTrackingTarget] = useState<{ orioId: number; sellerId: string } | null>(null);
  const [noteDialog, setNoteDialog]     = useState<{ orderId: string; currentNote: string; fromStatusChange?: boolean } | null>(null);
  const [noteText, setNoteText]         = useState("");
  const [columns, setColumns]           = useState<ColumnConfig[]>(() => loadColumnConfig());

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(columns)); }, [columns]);

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["follow-ups-data"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_follow_ups_data");
      if (error) throw error;
      return (data ?? []) as FollowUpRow[];
    },
    enabled: !!authUser && ["admin", "agent", "follow_up"].includes(authUser.role),
    refetchInterval: 30000,
    staleTime: 25_000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const channel = supabase
      .channel("follow-ups-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "order_follow_ups" },
        () => queryClient.invalidateQueries({ queryKey: ["follow-ups-data"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const enriched = useMemo(() => rows.map((r) => ({ ...r, segment: computeSegment(r) })), [rows]);

  const kpis = useMemo(() => {
    const total     = enriched.length;
    const shipped   = enriched.filter((r) => ["shipped","in_transit","with_courier","out_for_delivery"].includes(r.delivery_status ?? "")).length;
    const delivered = enriched.filter((r) => r.delivery_status === "delivered").length;
    const pending   = enriched.filter((r) => r.follow_up_status !== "closed").length;
    return {
      total, shipped, delivered, pending,
      shippedPct:   total > 0 ? Math.round((shipped   / total) * 100) : 0,
      deliveredPct: total > 0 ? Math.round((delivered / total) * 100) : 0,
      pendingPct:   total > 0 ? Math.round((pending   / total) * 100) : 0,
    };
  }, [enriched]);

  const segCounts = useMemo(() => {
    const c = { failed_attempt: 0, delayed: 0, on_going: 0, none: 0 };
    for (const r of enriched) { if (r.segment) c[r.segment]++; else c.none++; }
    return c;
  }, [enriched]);

  const filterOptions = useMemo(() => {
    const sellers = new Map<string, string>();
    const agents  = new Map<string, string>();
    const deliveries = new Set<string>();
    for (const r of enriched) {
      if (r.seller_id && r.seller_name) sellers.set(r.seller_id, r.seller_name);
      if (r.agent_id  && r.agent_name)  agents.set(r.agent_id,   r.agent_name);
      if (r.delivery_status) deliveries.add(r.delivery_status);
    }
    return {
      sellers:    Array.from(sellers.entries()).sort((a, b) => a[1].localeCompare(b[1])),
      agents:     Array.from(agents.entries()).sort((a, b) => a[1].localeCompare(b[1])),
      deliveries: Array.from(deliveries).sort(),
    };
  }, [enriched]);

  const filtered = useMemo(() => enriched.filter((r) => {
    if (segment !== "all") {
      if (segment === "none") { if (r.segment !== null) return false; }
      else if (r.segment !== segment) return false;
    }
    if (filterDelivery !== "all" && r.delivery_status !== filterDelivery) return false;
    if (filterSeller   !== "all" && r.seller_id       !== filterSeller)   return false;
    if (filterAgent    !== "all" && r.agent_id        !== filterAgent)    return false;
    if (filterFollowUp !== "all" && r.follow_up_status !== filterFollowUp) return false;
    if (dateRange?.from) {
      const target = new Date(dateField === "created" ? r.order_created_at : r.order_updated_at);
      if (!isWithinInterval(target, { start: startOfDay(dateRange.from), end: endOfDay(dateRange.to ?? dateRange.from) })) return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = [r.order_id, r.customer_name, r.customer_phone, r.customer_city, r.seller_name ?? "", r.agent_name ?? ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [enriched, segment, filterDelivery, filterSeller, filterAgent, filterFollowUp, search, dateRange, dateField]);

  const activeFilterCount =
    (segment !== "all" ? 1 : 0) + (filterDelivery !== "all" ? 1 : 0) +
    (filterSeller !== "all" ? 1 : 0) + (filterAgent !== "all" ? 1 : 0) +
    (filterFollowUp !== "all" ? 1 : 0) + (dateRange?.from ? 1 : 0) + (search.trim() ? 1 : 0);

  function clearFilters() {
    setSegment("all"); setFilterDelivery("all"); setFilterSeller("all");
    setFilterAgent("all"); setFilterFollowUp("all"); setSearch(""); setDateRange(undefined);
  }

  async function handleStatusChange(orderId: string, newStatus: string, noAnswerAttempt?: number) {
    if (!authUser) return;
    setSavingId(orderId);
    try {
      const upsertData: Record<string, unknown> = { order_id: orderId, follow_up_status: newStatus, updated_by: authUser.id };
      if (newStatus === "no_answer" && noAnswerAttempt !== undefined) upsertData.fu_no_answer_count = noAnswerAttempt;
      const { error } = await supabase.from("order_follow_ups").upsert(upsertData as any, { onConflict: "order_id" });
      if (error) throw error;
      toast.success("Follow-up updated");
      refetch();
      const row = enriched.find((r) => r.order_id === orderId);
      setNoteText(row?.follow_up_note ?? "");
      setNoteDialog({ orderId, currentNote: row?.follow_up_note ?? "", fromStatusChange: true });
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setSavingId(null);
    }
  }

  async function handleNoteSave(orderId: string, note: string) {
    if (!authUser) return;
    try {
      const { error } = await supabase.from("orders").update({ follow_up_note: note }).eq("order_id", orderId);
      if (error) throw error;
      toast.success("Note saved");
      setNoteDialog(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to save note");
    }
  }

  function openNoteDialog(orderId: string, currentNote: string) {
    setNoteText(currentNote);
    setNoteDialog({ orderId, currentNote });
  }

  if (!authLoading && authUser && !["admin","agent","follow_up"].includes(authUser.role)) {
    return <Navigate to="/" replace />;
  }

  const isSeller = authUser?.role === "seller";
  const visibleColumns = columns.filter((c) => c.visible && !(isSeller && c.key === "note"));

  return (
    <TooltipProvider>
      <div className="space-y-4 max-w-[1600px] animate-fade-in">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 border border-primary/20 flex-shrink-0">
              <ClipboardCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight tracking-tight">Follow Ups</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isLoading ? "Loading…" : `${enriched.length.toLocaleString()} orders tracked in real-time`}
              </p>
            </div>
          </div>
          {isFetching && !isLoading && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Syncing…
            </div>
          )}
        </div>

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard icon={Truck}       label="Total Orders"   value={kpis.total}     sub="Synced to ORIO"            pct={100}               tone="muted"   />
          <KPICard icon={Activity}    label="In Transit"     value={kpis.shipped}   sub={`${kpis.shippedPct}% of total`}   pct={kpis.shippedPct}   tone="info"    />
          <KPICard icon={PackageCheck} label="Delivered"     value={kpis.delivered} sub={`${kpis.deliveredPct}% of total`} pct={kpis.deliveredPct} tone="success" />
          <KPICard icon={Hourglass}   label="Need Action"    value={kpis.pending}   sub={`${kpis.pendingPct}% pending`}    pct={kpis.pendingPct}   tone="warning" />
        </div>

        {/* ── Segment tabs ── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* All */}
          <button
            onClick={() => setSegment("all")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-all ${
              segment === "all"
                ? "bg-foreground text-background border-foreground shadow-sm"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
            }`}
          >
            All orders
            <span className={`tabular-nums text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${
              segment === "all" ? "bg-white/20" : "bg-muted"
            }`}>{enriched.length}</span>
          </button>

          {(["failed_attempt", "delayed", "on_going"] as const).map((seg) => {
            const meta  = segmentMeta[seg];
            const Icon  = meta.icon;
            const active = segment === seg;
            const clr   = meta.color;
            return (
              <button
                key={seg}
                onClick={() => setSegment(active ? "all" : seg)}
                style={active ? {
                  backgroundColor: `color-mix(in srgb, ${clr} 15%, transparent)`,
                  color: clr,
                  borderColor: `color-mix(in srgb, ${clr} 40%, transparent)`,
                } : {}}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-all ${
                  active
                    ? "shadow-sm"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                }`}
              >
                <Icon className="h-3 w-3 flex-shrink-0" />
                {meta.label}
                <span
                  style={active ? { backgroundColor: `color-mix(in srgb, ${clr} 20%, transparent)` } : {}}
                  className={`tabular-nums text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${active ? "" : "bg-muted"}`}
                >
                  {segCounts[seg]}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Toolbar ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search orders…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>

          <Select value={filterDelivery} onValueChange={setFilterDelivery}>
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <SelectValue placeholder="Delivery" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Delivery</SelectItem>
              {filterOptions.deliveries.map((d) => (
                <SelectItem key={d} value={d}>{formatStatus(d)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterFollowUp} onValueChange={setFilterFollowUp}>
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <SelectValue placeholder="Follow Up" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Follow Up</SelectItem>
              {FOLLOW_UP_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range */}
          <div className="flex gap-1">
            <Select value={dateField} onValueChange={(v) => setDateField(v as DateField)}>
              <SelectTrigger className="h-8 text-xs w-[86px] px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="updated">Updated</SelectItem>
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-8 text-xs px-2 gap-1.5 ${dateRange?.from ? "" : "text-muted-foreground"}`}
                >
                  <CalendarIcon className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="hidden sm:inline">
                    {dateRange?.from
                      ? dateRange.to
                        ? `${format(dateRange.from, "dd MMM")} – ${format(dateRange.to, "dd MMM")}`
                        : format(dateRange.from, "dd MMM")
                      : "Date"}
                  </span>
                  {dateRange?.from && (
                    <X className="h-3 w-3" onClick={(e) => { e.stopPropagation(); setDateRange(undefined); }} />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={typeof window !== "undefined" && window.innerWidth < 640 ? 1 : 2}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs gap-1">
                <X className="h-3.5 w-3.5" />
                Clear ({activeFilterCount})
              </Button>
            )}
            <ColumnsManager columns={columns} onChange={setColumns} />
            {!isLoading && (
              <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap hidden md:inline">
                {filtered.length.toLocaleString()} / {enriched.length.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="rounded-xl border overflow-hidden bg-card shadow-soft relative">
          {/* Top loading bar */}
          {isFetching && !isLoading && (
            <div className="absolute top-0 inset-x-0 h-0.5 bg-primary/20 overflow-hidden z-10">
              <div className="h-full w-1/3 bg-primary animate-slide" />
            </div>
          )}

          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "calc(100vh - 17rem)" }}>
            <table className="w-full text-sm table-fixed border-collapse">
              <thead className="sticky top-0 z-[5]">
                <tr className="bg-muted/90 backdrop-blur-sm border-b border-border">
                  {visibleColumns.map((col) => {
                    const meta = ALL_COLUMNS.find((c) => c.key === col.key)!;
                    const isCenter = col.key === "days";
                    return (
                      <th
                        key={col.key}
                        style={{ width: columnWidths[col.key] }}
                        className={`text-left py-2.5 px-3 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest whitespace-nowrap overflow-hidden ${isCenter ? "text-center" : ""}`}
                      >
                        {meta.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 7 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {visibleColumns.map((c, ci) => (
                        <td key={c.key} className="py-3 px-3">
                          <Skeleton className={`h-3.5 rounded ${ci % 3 === 0 ? "w-3/4" : ci % 3 === 1 ? "w-1/2" : "w-2/3"}`} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={visibleColumns.length}>
                      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                        <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center">
                          <Search className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">No orders found</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {activeFilterCount > 0 ? "Try adjusting your filters" : "Orders appear here once shipped to ORIO"}
                          </p>
                        </div>
                        {activeFilterCount > 0 && (
                          <Button variant="outline" size="sm" onClick={clearFilters} className="text-xs gap-1.5 h-8">
                            <X className="h-3.5 w-3.5" /> Clear filters
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => {
                    const segMeta = row.segment ? segmentMeta[row.segment] : null;
                    return (
                      <tr
                        key={row.order_id}
                        style={rowAccentStyle(row)}
                        className="group border-b border-border/50 last:border-0 hover:bg-muted/40 transition-colors duration-100"
                      >
                        {visibleColumns.map((col) => (
                          <td
                            key={col.key}
                            className={`py-2.5 overflow-hidden ${cellClassFor(col.key)}`}
                          >
                            {renderCell(col.key, row, segMeta, savingId, handleStatusChange, handleNoteSave, navigate, setHistoryOrder, setTrackingTarget, openNoteDialog)}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {historyOrder && (
          <OrderHistoryModal
            open={!!historyOrder}
            onOpenChange={(o) => !o && setHistoryOrder(null)}
            orderId={historyOrder.id}
            customerName={historyOrder.customer}
          />
        )}

        {trackingTarget && (
          <OrioTrackingModal
            orioOrderId={trackingTarget.orioId}
            systemId={null}
            sellerId={trackingTarget.sellerId}
            open={!!trackingTarget}
            onClose={() => setTrackingTarget(null)}
          />
        )}

        {/* Note Dialog */}
        <Dialog open={!!noteDialog} onOpenChange={(o) => !o && setNoteDialog(null)}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-[hsl(45,90%,55%)]" />
                {noteDialog?.fromStatusChange ? "Add a Follow-Up Note" : "Follow-Up Note"}
              </DialogTitle>
            </DialogHeader>
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Write your note here…"
              className="min-h-[100px] text-sm"
              autoFocus
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" size="sm" onClick={() => setNoteDialog(null)}>
                {noteDialog?.fromStatusChange ? "Skip" : "Cancel"}
              </Button>
              <Button size="sm" onClick={() => { if (noteDialog) handleNoteSave(noteDialog.orderId, noteText.trim()); }}>
                Save Note
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

/* ── Column widths ── */
const columnWidths: Record<ColumnKey, string> = {
  order_id:  "94px",
  orio_id:   "82px",
  customer:  "140px",
  phone:     "112px",
  city:      "88px",
  product:   "140px",
  price:     "92px",
  delivery:  "145px",
  segment:   "160px",
  days:      "48px",
  follow_up: "148px",
  note:      "46px",
  created:   "88px",
  updated:   "88px",
  actions:   "68px",
};

function cellClassFor(key: ColumnKey): string {
  switch (key) {
    case "order_id": return "px-3 font-mono text-xs font-medium";
    case "orio_id":  return "px-3 text-xs";
    case "customer": return "px-3 text-xs";
    case "phone":    return "px-3 text-xs text-muted-foreground tabular-nums";
    case "city":     return "px-3 text-xs text-muted-foreground";
    case "product":  return "px-3 text-xs text-muted-foreground";
    case "price":    return "px-3 text-xs font-semibold tabular-nums text-right";
    case "days":     return "px-3 text-xs tabular-nums font-bold text-center";
    case "created":
    case "updated":  return "px-3 text-xs text-muted-foreground tabular-nums";
    default:         return "px-3";
  }
}

/* ── No-answer attempt + status picker ── */
const FU_MAX_ATTEMPTS = 5;

function FollowUpStatusCell({
  row,
  savingId,
  onStatusChange,
}: {
  row: FollowUpRow & { segment: "failed_attempt" | "delayed" | "on_going" | null };
  savingId: string | null;
  onStatusChange: (id: string, status: string, attempt?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const doneCount   = row.fu_no_answer_count ?? 0;
  const nextAttempt = doneCount + 1;
  const isNoAnswer  = row.follow_up_status === "no_answer";
  const exhausted   = doneCount >= FU_MAX_ATTEMPTS;
  const isSaving    = savingId === row.order_id;

  const triggerLabel =
    isNoAnswer && doneCount > 0
      ? `No Answer · ${doneCount}/${FU_MAX_ATTEMPTS}`
      : (FOLLOW_UP_STATUSES.find((s) => s.value === row.follow_up_status)?.label ?? row.follow_up_status);

  function pick(status: string, attempt?: number) {
    setOpen(false);
    onStatusChange(row.order_id, status, attempt);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isSaving}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none whitespace-nowrap transition-all hover:shadow-sm hover:brightness-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none ${
            followUpStatusStyle[row.follow_up_status] ?? "bg-muted text-muted-foreground border-border"
          }`}
        >
          <span className="truncate max-w-[110px]">{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 opacity-60 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0 overflow-hidden shadow-lg">
        {/* Header */}
        <div className="px-3 py-2 border-b bg-muted/50">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Update Follow Up
          </p>
        </div>

        {/* Status list */}
        <div className="p-1.5 space-y-0.5">
          {FOLLOW_UP_STATUSES.filter((s) => s.value !== "no_answer").map((s) => {
            const active = row.follow_up_status === s.value;
            return (
              <button
                key={s.value}
                onClick={() => pick(s.value)}
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted/70 ${active ? "bg-muted/50" : ""}`}
              >
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${followUpStatusStyle[s.value] ?? ""}`}>
                  {s.label}
                </span>
                {active && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
              </button>
            );
          })}
        </div>

        {/* No Answer attempts */}
        <div className="border-t bg-[hsl(0,65%,52%)]/[0.04] px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <PhoneOff className="h-3.5 w-3.5 text-[hsl(0,65%,52%)]" />
              <p className="text-[11px] font-bold text-[hsl(0,65%,52%)]">No Answer Attempts</p>
            </div>
            <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">{doneCount}/{FU_MAX_ATTEMPTS}</span>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: FU_MAX_ATTEMPTS }, (_, i) => i + 1).map((n) => {
              const isDone   = n <= doneCount;
              const isNext   = n === nextAttempt && !exhausted;
              const isLocked = !isDone && !isNext;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={!isNext}
                  onClick={() => pick("no_answer", n)}
                  title={isDone ? `Done` : isNext ? `Submit attempt ${n}` : `Locked`}
                  className={`relative flex items-center justify-center h-9 rounded-lg border text-xs font-bold transition-all
                    ${isDone   ? "bg-[hsl(0,65%,52%)]/15 border-[hsl(0,65%,52%)]/40 text-[hsl(0,65%,52%)] cursor-default" : ""}
                    ${isNext   ? "bg-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)] text-white shadow-md cursor-pointer ring-2 ring-[hsl(0,65%,52%)]/25 ring-offset-1 animate-pulse-subtle" : ""}
                    ${isLocked ? "bg-muted/40 border-border/40 text-muted-foreground/40 cursor-not-allowed" : ""}
                  `}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : n}
                </button>
              );
            })}
          </div>

          <p className="text-[10px] text-center font-medium">
            {exhausted ? (
              <span className="text-[hsl(0,65%,52%)]">All 5 attempts exhausted</span>
            ) : doneCount === 0 ? (
              <span className="text-muted-foreground">Tap <span className="font-bold text-[hsl(0,65%,52%)]">1</span> to start</span>
            ) : (
              <span className="text-muted-foreground">Next: tap <span className="font-bold text-[hsl(0,65%,52%)]">#{nextAttempt}</span></span>
            )}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── Cell renderer ── */
function renderCell(
  key: ColumnKey,
  row: FollowUpRow & { segment: "failed_attempt" | "delayed" | "on_going" | null },
  segMeta: (typeof segmentMeta)[keyof typeof segmentMeta] | null,
  savingId: string | null,
  handleStatusChange: (id: string, status: string, attempt?: number) => void,
  handleNoteSave: (id: string, note: string) => void,
  navigate: (to: string) => void,
  setHistoryOrder: (v: { id: string; customer: string } | null) => void,
  setTrackingTarget: (v: { orioId: number; sellerId: string } | null) => void,
  openNoteDialog: (orderId: string, currentNote: string) => void,
) {
  switch (key) {
    case "order_id":
      return (
        <span className="font-mono text-xs font-semibold text-foreground/80 tracking-tight">
          {row.order_id}
        </span>
      );

    case "orio_id":
      return row.orio_order_id ? (
        <button
          onClick={() => setTrackingTarget({ orioId: row.orio_order_id!, sellerId: row.seller_id ?? "" })}
          className="text-[hsl(210,60%,52%)] hover:underline font-semibold text-xs tabular-nums"
        >
          {row.orio_order_id}
        </button>
      ) : <span className="text-muted-foreground/50">—</span>;

    case "customer": {
      const name = row.customer_name || "—";
      const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("");
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[9px] font-bold text-primary">
                  {initials}
                </span>
                <span className="truncate text-xs font-medium">{name}</span>
              </div>
            </TooltipTrigger>
            {name.length > 14 && (
              <TooltipContent side="top" className="text-xs">{name}</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      );
    }

    case "phone":
      return (
        <span className="text-xs tabular-nums font-medium text-foreground/70">
          {row.customer_phone || "—"}
        </span>
      );

    case "city":
      return row.customer_city ? (
        <span className="flex items-center gap-1.5 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/50 shrink-0" />
          <span className="truncate">{row.customer_city}</span>
        </span>
      ) : <span className="text-muted-foreground/50 text-xs">—</span>;

    case "product":
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate block text-xs">{row.product_name || "—"}</span>
            </TooltipTrigger>
            {(row.product_name?.length ?? 0) > 16 && (
              <TooltipContent side="top" className="text-xs max-w-[240px]">{row.product_name}</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      );

    case "price":
      return row.total_amount != null ? (
        <span className="text-xs font-semibold tabular-nums">
          {Number(row.total_amount).toLocaleString()}
          <span className="text-muted-foreground font-normal ml-0.5">PKR</span>
        </span>
      ) : <span className="text-muted-foreground/50 text-xs">—</span>;

    case "delivery":
      return <StatusPill value={row.delivery_status} styleMap={deliveryStatusStyle} />;

    case "days": {
      const d = row.days_since_shipped;
      if (d == null) return <span className="text-muted-foreground/50">—</span>;
      const cls = d >= 5 ? "text-[hsl(0,65%,52%)]" : d >= 3 ? "text-[hsl(25,85%,55%)]" : "text-foreground/70";
      return <span className={`text-xs font-bold tabular-nums ${cls}`}>{d}d</span>;
    }

    case "segment": {
      const raw = row.shipping_status;
      if (!raw) return <span className="text-muted-foreground/50 text-xs">—</span>;
      const label = raw.replace(/\b\w/g, (c) => c.toUpperCase());
      const s = raw.toLowerCase().trim();
      let cls = "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/20";
      if (s === "delivered") cls = "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20";
      else if (s === "cancelled" || s === "refused to accept") cls = "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20";
      else if (s === "failed attempt") cls = "bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20";
      else if (s === "ready for return" || s.startsWith("return")) cls = "bg-[hsl(340,65%,52%)]/12 text-[hsl(340,65%,52%)] border-[hsl(340,65%,52%)]/20";
      else if (s === "new") cls = "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20";
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap ${cls}`}>
                {label.length > 18 ? label.slice(0, 16) + "…" : label}
              </span>
            </TooltipTrigger>
            {label.length > 16 && (
              <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      );
    }

    case "follow_up":
      return (
        <FollowUpStatusCell
          row={row}
          savingId={savingId}
          onStatusChange={handleStatusChange}
        />
      );

    case "note": {
      const hasNote = !!row.follow_up_note?.trim();
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => openNoteDialog(row.order_id, row.follow_up_note ?? "")}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-all active:scale-95 ${
                hasNote
                  ? "bg-[hsl(45,90%,55%)]/15 text-[hsl(45,90%,55%)] hover:bg-[hsl(45,90%,55%)]/25 shadow-sm"
                  : "bg-muted/40 text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
              }`}
            >
              <StickyNote className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[220px]">
            <p className="text-xs">{hasNote ? row.follow_up_note : "Add note…"}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    case "created": return (
      <span className="text-xs tabular-nums text-muted-foreground">
        {format(new Date(row.order_created_at), "dd MMM HH:mm")}
      </span>
    );
    case "updated": return (
      <span className="text-xs tabular-nums text-muted-foreground">
        {format(new Date(row.order_updated_at), "dd MMM HH:mm")}
      </span>
    );

    case "actions":
      return (
        <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity duration-150">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate(`/orders/${row.order_id}`)}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[hsl(30,90%,55%)]/10 text-[hsl(30,90%,55%)] hover:bg-[hsl(30,90%,55%)]/20 transition-colors active:scale-95"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p className="text-xs">Edit Order</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setHistoryOrder({ id: row.order_id, customer: row.customer_name })}
                className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[hsl(210,60%,52%)]/10 text-[hsl(210,60%,52%)] hover:bg-[hsl(210,60%,52%)]/20 transition-colors active:scale-95"
              >
                <History className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p className="text-xs">Order History</p></TooltipContent>
          </Tooltip>
        </div>
      );
  }
}

/* ── Columns Manager (drag to reorder + toggle visibility) ── */
function ColumnsManager({ columns, onChange }: { columns: ColumnConfig[]; onChange: (next: ColumnConfig[]) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onChange(arrayMove(columns, columns.findIndex((c) => c.key === active.id), columns.findIndex((c) => c.key === over.id)));
  }

  const visibleCount = columns.filter((c) => c.visible).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Columns3 className="h-3.5 w-3.5" />
          Columns
          <span className="text-muted-foreground">({visibleCount})</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <p className="text-xs font-semibold">Columns</p>
          <button
            onClick={() => onChange(ALL_COLUMNS.map((c) => ({ key: c.key, visible: true })))}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        </div>
        <div className="p-1.5 max-h-[380px] overflow-y-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={columns.map((c) => c.key)} strategy={verticalListSortingStrategy}>
              {columns.map((col) => {
                const meta = ALL_COLUMNS.find((c) => c.key === col.key)!;
                return (
                  <SortableColumnItem
                    key={col.key}
                    id={col.key}
                    label={meta.label}
                    visible={col.visible}
                    onToggle={() => onChange(columns.map((c) => c.key === col.key ? { ...c, visible: !c.visible } : c))}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
        <div className="px-3 py-2 border-t text-[10px] text-muted-foreground">
          Drag <GripVertical className="inline h-3 w-3" /> to reorder · eye to toggle
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SortableColumnItem({ id, label, visible, onToggle }: { id: ColumnKey; label: string; visible: boolean; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60"
    >
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none">
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className={`text-xs flex-1 ${visible ? "text-foreground" : "text-muted-foreground line-through"}`}>
        {label}
      </span>
      <button onClick={onToggle} className="text-muted-foreground hover:text-foreground p-0.5">
        {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/* ── KPI Card ── */
function KPICard({
  icon: Icon, label, value, sub, pct, tone,
}: {
  icon: typeof Truck;
  label: string;
  value: number;
  sub: string;
  pct: number;
  tone: "muted" | "info" | "success" | "warning";
}) {
  const iconCls = {
    muted:   "bg-muted/80 text-muted-foreground",
    info:    "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)]",
    success: "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)]",
    warning: "bg-[hsl(25,85%,55%)]/12  text-[hsl(25,85%,55%)]",
  }[tone];

  const barCls = {
    muted:   "bg-foreground/20",
    info:    "bg-[hsl(210,60%,52%)]",
    success: "bg-[hsl(155,50%,42%)]",
    warning: "bg-[hsl(25,85%,55%)]",
  }[tone];

  const borderCls = {
    muted:   "",
    info:    "border-t-[hsl(210,60%,52%)]/30",
    success: "border-t-[hsl(155,50%,42%)]/30",
    warning: "border-t-[hsl(25,85%,55%)]/30",
  }[tone];

  return (
    <Card className={`p-4 hover:shadow-elevated transition-all duration-200 overflow-hidden border-t-2 ${borderCls}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold truncate">{label}</p>
          <p className="text-2xl font-bold tabular-nums mt-1.5 leading-none">{value.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-none">{sub}</p>
        </div>
        <div className={`p-2 rounded-xl flex-shrink-0 ${iconCls}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {/* Progress bar */}
      <div className="mt-3.5 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barCls}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </Card>
  );
}
