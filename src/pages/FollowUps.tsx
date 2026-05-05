import { useCallback, useEffect, useMemo, useState } from "react";
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
  X,
  RefreshCw,
  RotateCcw,
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
import { isWithinInterval, isSameDay, formatDistanceToNow } from "date-fns";
import {
  formatPKT as format,
  startOfDayPKT as startOfDay, endOfDayPKT as endOfDay,
  subDaysPKT as subDays, startOfMonthPKT as startOfMonth, endOfMonthPKT as endOfMonth,
} from "@/lib/timezone";
// startOfYesterday / endOfYesterday expressed in PKT
import { subDaysPKT } from "@/lib/timezone";
const startOfYesterday = () => startOfDay(subDaysPKT(new Date(), 1));
const endOfYesterday   = () => endOfDay(subDaysPKT(new Date(), 1));
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

type Segment = "all" | "failed_attempt" | "delayed" | "on_going" | "returned" | "re_attempted" | "no_answer" | "none";
type DateField = "created" | "updated" | "fu_updated";

/* Top-level tracking statuses */
const FU_TOP_STATUSES = [
  { value: "ongoing",         label: "Ongoing"         },
  { value: "failed_attempts", label: "Failed Attempts" },
  { value: "delayed",         label: "Delayed"         },
];
/* Action statuses (agent picks one of these) */
const FU_ACTION_STATUSES = [
  { value: "re_attempted", label: "Re-attempted" },
  { value: "refused",      label: "Refused"      },
];
const FOLLOW_UP_STATUSES = [...FU_TOP_STATUSES, ...FU_ACTION_STATUSES,
  { value: "no_answer", label: "No Answer" },
];

const followUpStatusStyle: Record<string, string> = {
  pending:         "bg-[hsl(30,6%,50%)]/12    text-[hsl(30,6%,50%)]    border-[hsl(30,6%,50%)]/25",
  ongoing:         "bg-[hsl(160,50%,42%)]/12  text-[hsl(160,50%,42%)]  border-[hsl(160,50%,42%)]/25",
  failed_attempts: "bg-[hsl(15,75%,52%)]/12   text-[hsl(15,75%,52%)]   border-[hsl(15,75%,52%)]/25",
  delayed:         "bg-[hsl(38,90%,48%)]/12   text-[hsl(38,90%,48%)]   border-[hsl(38,90%,48%)]/25",
  re_attempted:    "bg-[hsl(270,50%,55%)]/12  text-[hsl(270,50%,55%)]  border-[hsl(270,50%,55%)]/25",
  no_answer:       "bg-[hsl(0,65%,52%)]/12    text-[hsl(0,65%,52%)]    border-[hsl(0,65%,52%)]/25",
  refused:         "bg-[hsl(340,65%,45%)]/12  text-[hsl(340,65%,45%)]  border-[hsl(340,65%,45%)]/25",
  /* legacy */
  contacted_courier: "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)]  border-[hsl(210,60%,52%)]/25",
  contacted_client:  "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)]  border-[hsl(200,65%,50%)]/25",
  client_confirmed:  "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)]  border-[hsl(155,50%,42%)]/25",
  resent_to_courier: "bg-[hsl(270,50%,55%)]/12 text-[hsl(270,50%,55%)]  border-[hsl(270,50%,55%)]/25",
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

// Detect courier from ORIO consignment number prefix
function detectCourier(consignmentNo: string | null): string | null {
  if (!consignmentNo) return null;
  const cn = consignmentNo.toUpperCase().trim();
  if (cn.startsWith("MP") || cn.includes("MPX")) return "MPostex";
  if (cn.startsWith("BL") || cn.includes("BLX")) return "Bleux";
  if (cn.startsWith("LD") || cn.includes("LEO")) return "Leopard";
  if (cn.startsWith("TCS"))                       return "TCS";
  if (cn.startsWith("TR") || cn.includes("TRX"))  return "Trax";
  return null;
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

const STORAGE_KEY = "follow-ups:column-config:v5";
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
  const [filterDelivery, setFilterDelivery]     = useState<string>("all");
  const [filterSubStatus, setFilterSubStatus]   = useState<string>("all");
  const [filterSeller, setFilterSeller]         = useState<string>("all");
  const [filterAgent, setFilterAgent]           = useState<string>("all");
  const [filterFollowUp, setFilterFollowUp]     = useState<string>("all");
  const [dateField, setDateField]       = useState<DateField>("created");
  const [dateRange, setDateRange]       = useState<DateRange | undefined>();
  const [pageSize, setPageSize]         = useState<number>(100);
  const [page, setPage]                 = useState<number>(1);
  const [savingId, setSavingId]         = useState<string | null>(null);
  const [historyOrder, setHistoryOrder] = useState<{ id: string; customer: string } | null>(null);
  const [trackingTarget, setTrackingTarget] = useState<{ orioId: number; sellerId: string } | null>(null);
  const [noteDialog, setNoteDialog]     = useState<{ orderId: string; currentNote: string; fromStatusChange?: boolean } | null>(null);
  const [noteText, setNoteText]         = useState("");
  const [columns, setColumns]           = useState<ColumnConfig[]>(() => loadColumnConfig());

  const saveColumns = useCallback((next: ColumnConfig[]) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    setColumns(next);
  }, []);

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

  const segCounts = useMemo(() => {
    const c = { failed_attempt: 0, delayed: 0, on_going: 0, none: 0, returned: 0, re_attempted: 0, no_answer: 0 };
    for (const r of enriched) {
      if (r.segment) c[r.segment]++; else c.none++;
      if (["returned","return","ready_for_return"].includes(r.delivery_status ?? "")) c.returned++;
      if (r.follow_up_status === "re_attempted") c.re_attempted++;
      if (r.follow_up_status === "no_answer")    c.no_answer++;
    }
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
      if (segment === "none")         { if (r.segment !== null) return false; }
      else if (segment === "returned")     { if (!["returned","return","ready_for_return"].includes(r.delivery_status ?? "")) return false; }
      else if (segment === "re_attempted") { if (r.follow_up_status !== "re_attempted") return false; }
      else if (segment === "no_answer")    { if (r.follow_up_status !== "no_answer")    return false; }
      else if (r.segment !== segment) return false;
    }
    if (filterDelivery   !== "all" && r.delivery_status !== filterDelivery)   return false;
    if (filterSubStatus  !== "all" && r.segment         !== filterSubStatus)  return false;
    if (filterSeller     !== "all" && r.seller_id       !== filterSeller)     return false;
    if (filterAgent    !== "all" && r.agent_id        !== filterAgent)    return false;
    if (filterFollowUp !== "all" && r.follow_up_status !== filterFollowUp) return false;
    if (dateRange?.from) {
      try {
        const ts = dateField === "created" ? r.order_created_at
          : dateField === "fu_updated"     ? (r.follow_up_updated_at ?? r.order_updated_at)
          : r.order_updated_at;
        const target = new Date(ts);
        const start  = startOfDay(dateRange.from);
        const end    = endOfDay(dateRange.to ?? dateRange.from);
        if (start > end || !isWithinInterval(target, { start, end })) return false;
      } catch { return false; }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = [
        r.order_id,
        r.customer_name,
        r.customer_phone,
        r.customer_city,
        r.seller_name ?? "",
        r.agent_name ?? "",
        r.orio_order_id?.toString() ?? "",
        r.orio_consignment_no ?? "",
        r.product_name ?? "",
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [enriched, segment, filterDelivery, filterSubStatus, filterSeller, filterAgent, filterFollowUp, search, dateRange, dateField]);

  // Reset to page 1 whenever filtered result set changes
  useEffect(() => { setPage(1); }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);

  const activeFilterCount =
    (segment !== "all" ? 1 : 0) + (filterDelivery !== "all" ? 1 : 0) +
    (filterSubStatus !== "all" ? 1 : 0) +
    (filterSeller !== "all" ? 1 : 0) + (filterAgent !== "all" ? 1 : 0) +
    (filterFollowUp !== "all" ? 1 : 0) + (dateRange?.from ? 1 : 0) + (search.trim() ? 1 : 0);

  function clearFilters() {
    setSegment("all"); setFilterDelivery("all"); setFilterSubStatus("all"); setFilterSeller("all");
    setFilterAgent("all"); setFilterFollowUp("all"); setSearch(""); setDateRange(undefined);
  }

  async function handleStatusChange(orderId: string, newStatus: string, noAnswerAttempt?: number, note?: string) {
    if (!authUser) return;
    setSavingId(orderId);
    try {
      const upsertData: Record<string, unknown> = { order_id: orderId, follow_up_status: newStatus, updated_by: authUser.id };
      if (newStatus === "no_answer" && noAnswerAttempt !== undefined) upsertData.fu_no_answer_count = noAnswerAttempt;
      const { error } = await supabase.from("order_follow_ups").upsert(upsertData as any, { onConflict: "order_id" });
      if (error) throw error;
      if (note?.trim()) {
        await supabase.from("orders").update({ follow_up_note: note.trim() }).eq("order_id", orderId);
      }
      toast.success("Follow-up updated");
      refetch();
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
      <div className="space-y-2 max-w-[1600px] animate-fade-in">

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

          {/* Separator */}
          <div className="w-px h-5 bg-border mx-0.5" />

          {/* Returned tab */}
          {(() => {
            const active = segment === "returned";
            const clr = "hsl(0,55%,48%)";
            return (
              <button
                onClick={() => setSegment(active ? "all" : "returned")}
                style={active ? { backgroundColor: `color-mix(in srgb, ${clr} 15%, transparent)`, color: clr, borderColor: `color-mix(in srgb, ${clr} 40%, transparent)` } : {}}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-all ${active ? "shadow-sm" : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"}`}
              >
                <RotateCcw className="h-3 w-3 flex-shrink-0" />
                Returned
                <span style={active ? { backgroundColor: `color-mix(in srgb, ${clr} 20%, transparent)` } : {}} className={`tabular-nums text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${active ? "" : "bg-muted"}`}>
                  {segCounts.returned}
                </span>
              </button>
            );
          })()}

          {/* Re-attempted tab */}
          {(() => {
            const active = segment === "re_attempted";
            const clr = "hsl(270,50%,55%)";
            return (
              <button
                onClick={() => setSegment(active ? "all" : "re_attempted")}
                style={active ? { backgroundColor: `color-mix(in srgb, ${clr} 15%, transparent)`, color: clr, borderColor: `color-mix(in srgb, ${clr} 40%, transparent)` } : {}}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-all ${active ? "shadow-sm" : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"}`}
              >
                <RefreshCw className="h-3 w-3 flex-shrink-0" />
                Re-attempted
                <span style={active ? { backgroundColor: `color-mix(in srgb, ${clr} 20%, transparent)` } : {}} className={`tabular-nums text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${active ? "" : "bg-muted"}`}>
                  {segCounts.re_attempted}
                </span>
              </button>
            );
          })()}

          {/* No Answer tab */}
          {(() => {
            const active = segment === "no_answer";
            const clr = "hsl(0,65%,52%)";
            return (
              <button
                onClick={() => setSegment(active ? "all" : "no_answer")}
                style={active ? { backgroundColor: `color-mix(in srgb, ${clr} 15%, transparent)`, color: clr, borderColor: `color-mix(in srgb, ${clr} 40%, transparent)` } : {}}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-all ${active ? "shadow-sm" : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"}`}
              >
                <PhoneOff className="h-3 w-3 flex-shrink-0" />
                No Answer
                <span style={active ? { backgroundColor: `color-mix(in srgb, ${clr} 20%, transparent)` } : {}} className={`tabular-nums text-[10px] rounded-full px-1.5 py-0.5 font-semibold ${active ? "" : "bg-muted"}`}>
                  {segCounts.no_answer}
                </span>
              </button>
            );
          })()}
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

          <Select value={filterSubStatus} onValueChange={setFilterSubStatus}>
            <SelectTrigger className="h-8 text-xs w-[140px]">
              <SelectValue placeholder="Sub Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sub Status</SelectItem>
              <SelectItem value="on_going">On Going</SelectItem>
              <SelectItem value="delayed">Delayed</SelectItem>
              <SelectItem value="failed_attempt">Failed Attempt</SelectItem>
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
          <DateRangePicker
            dateField={dateField}
            onDateFieldChange={setDateField}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
          />

          <div className="ml-auto flex items-center gap-2">
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs gap-1">
                <X className="h-3.5 w-3.5" />
                Clear ({activeFilterCount})
              </Button>
            )}
            <ColumnsManager columns={columns} onChange={saveColumns} />
            {!isLoading && (
              <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap hidden md:inline">
                {filtered.length.toLocaleString()} / {enriched.length.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* ── Pagination ── */}
        {!isLoading && filtered.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                <SelectTrigger className="h-7 text-xs w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[20, 50, 100, 300].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground tabular-nums">
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="sm"
                className="h-7 w-7 p-0 text-xs"
                onClick={() => setPage(1)}
                disabled={page === 1}
              >«</Button>
              <Button
                variant="outline" size="sm"
                className="h-7 w-7 p-0 text-xs"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >‹</Button>
              <span className="text-xs tabular-nums px-2 text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline" size="sm"
                className="h-7 w-7 p-0 text-xs"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >›</Button>
              <Button
                variant="outline" size="sm"
                className="h-7 w-7 p-0 text-xs"
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
              >»</Button>
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div className="rounded-xl border overflow-hidden bg-card shadow-soft relative">
          {/* Top loading bar */}
          {isFetching && !isLoading && (
            <div className="absolute top-0 inset-x-0 h-0.5 bg-primary/20 overflow-hidden z-10">
              <div className="h-full w-1/3 bg-primary animate-slide" />
            </div>
          )}

          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "calc(100vh - 12rem)" }}>
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
                        className={`text-left py-2 px-3 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest whitespace-nowrap overflow-hidden ${isCenter ? "text-center" : ""}`}
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
                        <td key={c.key} className="py-1.5 px-3">
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
                  paginated.map((row) => {
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
                            className={`py-1.5 overflow-hidden ${cellClassFor(col.key)}`}
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
  note:      "52px",
  created:   "88px",
  updated:   "88px",
  actions:   "88px",
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
/* ── Date Range Picker with sidebar presets ── */
const DATE_PRESETS = [
  {
    label: "Today",
    shortLabel: "Today",
    getRange: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }),
  },
  {
    label: "Yesterday",
    shortLabel: "Yesterday",
    getRange: () => ({ from: startOfYesterday(), to: endOfYesterday() }),
  },
  {
    label: "Last 7 days",
    shortLabel: "Last 7d",
    getRange: () => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }),
  },
  {
    label: "Last 30 days",
    shortLabel: "Last 30d",
    getRange: () => ({ from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) }),
  },
  {
    label: "This month",
    shortLabel: "This month",
    getRange: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }),
  },
  {
    label: "Last month",
    shortLabel: "Last month",
    getRange: () => {
      const last = subDays(startOfMonth(new Date()), 1);
      return { from: startOfMonth(last), to: endOfMonth(last) };
    },
  },
];

function getActivePreset(dateRange: DateRange | undefined) {
  if (!dateRange?.from || !dateRange?.to) return null;
  for (const p of DATE_PRESETS) {
    const r = p.getRange();
    if (isSameDay(dateRange.from, r.from) && isSameDay(dateRange.to, r.to)) return p;
  }
  return null;
}

function DateRangePicker({
  dateField,
  onDateFieldChange,
  dateRange,
  onDateRangeChange,
}: {
  dateField: DateField;
  onDateFieldChange: (v: DateField) => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (r: DateRange | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const activePreset = getActivePreset(dateRange);
  const hasRange = !!dateRange?.from;

  const triggerLabel = activePreset
    ? activePreset.shortLabel
    : hasRange
    ? dateRange!.to
      ? `${format(dateRange!.from!, "dd MMM")} – ${format(dateRange!.to, "dd MMM")}`
      : format(dateRange!.from!, "dd MMM")
    : "All dates";

  return (
    <div className="flex gap-1">
      {/* Field toggle */}
      <Select value={dateField} onValueChange={(v) => onDateFieldChange(v as DateField)}>
        <SelectTrigger className="h-8 text-xs w-[100px] px-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="created">Order Created</SelectItem>
          <SelectItem value="updated">Order Updated</SelectItem>
          <SelectItem value="fu_updated">FU Updated</SelectItem>
        </SelectContent>
      </Select>

      {/* Date picker trigger */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={`h-8 text-xs px-2.5 gap-1.5 min-w-[110px] justify-start font-medium transition-all ${
              hasRange
                ? "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarIcon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 text-left truncate">{triggerLabel}</span>
            {hasRange && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); onDateRangeChange(undefined); }}
                className="ml-auto flex-shrink-0 rounded-full hover:bg-primary/20 p-0.5 transition-colors"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-auto p-0 overflow-hidden shadow-xl border"
          align="start"
          sideOffset={4}
        >
          <div className="flex">
            {/* Left sidebar — presets */}
            <div className="w-[130px] border-r bg-muted/30 flex flex-col py-1.5">
              <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Quick select
              </p>
              <div className="space-y-0.5 px-1.5">
                {DATE_PRESETS.map((p) => {
                  const isActive = activePreset?.label === p.label;
                  return (
                    <button
                      key={p.label}
                      onClick={() => {
                        onDateRangeChange(p.getRange());
                        setOpen(false);
                      }}
                      className={`w-full text-left rounded-md px-2.5 py-2 text-xs font-medium transition-all ${
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Clear button at the bottom */}
              {hasRange && (
                <div className="mt-auto px-1.5 pb-1.5 pt-3 border-t mt-3">
                  <button
                    onClick={() => { onDateRangeChange(undefined); setOpen(false); }}
                    className="w-full flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Right — calendar */}
            <div className="p-0">
              {/* Selected range summary */}
              {hasRange && (
                <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                  <div className="flex-1 text-center">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">From</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {format(dateRange!.from!, "dd MMM yyyy")}
                    </p>
                  </div>
                  <div className="w-4 h-px bg-border flex-shrink-0" />
                  <div className="flex-1 text-center">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">To</p>
                    <p className="text-sm font-semibold mt-0.5">
                      {dateRange!.to ? format(dateRange!.to, "dd MMM yyyy") : "—"}
                    </p>
                  </div>
                </div>
              )}
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={onDateRangeChange}
                numberOfMonths={1}
                initialFocus
                className="pointer-events-auto"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const FU_MAX_ATTEMPTS = 5;

type FuView = "status" | "attempts" | "refused_note";

function FollowUpStatusCell({
  row,
  savingId,
  onStatusChange,
}: {
  row: FollowUpRow & { segment: "failed_attempt" | "delayed" | "on_going" | null };
  savingId: string | null;
  onStatusChange: (id: string, status: string, attempt?: number, note?: string) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [view, setView]       = useState<FuView>("status");
  const [refusedNote, setRefusedNote] = useState("");

  const doneCount   = row.fu_no_answer_count ?? 0;
  const nextAttempt = doneCount + 1;
  const isNoAnswer  = row.follow_up_status === "no_answer";
  const exhausted   = doneCount >= FU_MAX_ATTEMPTS;
  const isSaving    = savingId === row.order_id;

  const triggerLabel =
    isNoAnswer && doneCount > 0
      ? `No Answer · ${doneCount}/${FU_MAX_ATTEMPTS}`
      : (FOLLOW_UP_STATUSES.find((s) => s.value === row.follow_up_status)?.label ?? row.follow_up_status);

  const updatedAt = row.follow_up_updated_at
    ? formatDistanceToNow(new Date(row.follow_up_updated_at), { addSuffix: true })
    : null;

  function handleOpenChange(v: boolean) {
    setOpen(v);
    if (!v) { setView("status"); setRefusedNote(""); }
  }

  function pick(status: string, attempt?: number, note?: string) {
    setOpen(false);
    setView("status");
    setRefusedNote("");
    onStatusChange(row.order_id, status, attempt, note);
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <Popover open={open} onOpenChange={handleOpenChange}>
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

        <PopoverContent align="start" className="w-80 p-0 overflow-hidden shadow-xl">

          {/* ── VIEW 1: Status list ── */}
          {view === "status" && (
            <>
              <div className="px-3 py-2 border-b bg-muted/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Update Follow Up
                </p>
              </div>
              <div className="p-1.5">
                <div className="space-y-0.5">
                  {/* Pending — direct save */}
                  {(() => {
                    const active = row.follow_up_status === "pending";
                    return (
                      <button
                        onClick={() => pick("pending")}
                        className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-muted/70 ${active ? "bg-muted/50" : ""}`}
                      >
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${followUpStatusStyle["pending"]}`}>
                          Pending
                        </span>
                        {active && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                      </button>
                    );
                  })()}

                  {/* Re-attempted — direct save */}
                  {(() => {
                    const s = FU_ACTION_STATUSES.find((x) => x.value === "re_attempted")!;
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
                  })()}

                  {/* No Answer — opens stepper */}
                  <button
                    onClick={() => setView("attempts")}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-[hsl(0,65%,52%)]/8 ${isNoAnswer ? "bg-[hsl(0,65%,52%)]/8" : ""}`}
                  >
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${followUpStatusStyle["no_answer"]}`}>
                      No Answer {isNoAnswer && doneCount > 0 ? `· ${doneCount}/${FU_MAX_ATTEMPTS}` : ""}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-[hsl(0,65%,52%)]/70 -rotate-90 flex-shrink-0" />
                  </button>

                  {/* Refused — opens note input (obligatory) */}
                  <button
                    onClick={() => setView("refused_note")}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-[hsl(340,65%,45%)]/8 ${row.follow_up_status === "refused" ? "bg-[hsl(340,65%,45%)]/8" : ""}`}
                  >
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${followUpStatusStyle["refused"]}`}>
                      Refused
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-semibold text-muted-foreground/60 uppercase tracking-wide">Note req.</span>
                      <ChevronDown className="h-3.5 w-3.5 text-[hsl(340,65%,45%)]/70 -rotate-90 flex-shrink-0" />
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── VIEW 2: No Answer attempt stepper ── */}
          {view === "attempts" && (
            <div className="bg-[hsl(0,65%,52%)]/[0.03]">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50">
                <button
                  onClick={() => setView("status")}
                  className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className="h-3.5 w-3.5 rotate-90" />
                </button>
                <div className="flex items-center gap-1.5 flex-1">
                  <div className="p-1 rounded-md bg-[hsl(0,65%,52%)]/15">
                    <PhoneOff className="h-3 w-3 text-[hsl(0,65%,52%)]" />
                  </div>
                  <span className="text-xs font-bold text-[hsl(0,65%,52%)]">No Answer — Select Attempt</span>
                </div>
                <span className="text-[11px] tabular-nums font-semibold text-muted-foreground">
                  {doneCount}/{FU_MAX_ATTEMPTS}
                </span>
              </div>

              <div className="px-4 py-4 space-y-4">
                <div className="relative pt-1 pb-5">
                  <div className="absolute left-[18px] right-[18px] top-[18px] h-[2px] bg-border" />
                  {doneCount > 0 && (
                    <div
                      className="absolute left-[18px] top-[18px] h-[2px] bg-[hsl(0,65%,52%)] transition-all duration-500"
                      style={{ width: `calc((100% - 36px) * ${Math.max(0, doneCount - 1)} / ${FU_MAX_ATTEMPTS - 1})` }}
                    />
                  )}
                  <div className="relative flex justify-between items-start">
                    {Array.from({ length: FU_MAX_ATTEMPTS }, (_, i) => i + 1).map((n) => {
                      const isDone   = n <= doneCount;
                      const isNext   = n === nextAttempt && !exhausted;
                      const isLocked = !isDone && !isNext;
                      return (
                        <div key={n} className="flex flex-col items-center gap-1.5">
                          <button
                            type="button"
                            disabled={!isNext}
                            onClick={() => pick("no_answer", n)}
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-all duration-200
                              ${isDone   ? "bg-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)] text-white cursor-default" : ""}
                              ${isNext   ? "bg-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)] text-white shadow-lg scale-110 cursor-pointer hover:scale-[1.15] ring-4 ring-[hsl(0,65%,52%)]/25 animate-pulse-subtle" : ""}
                              ${isLocked ? "bg-background border-border/60 text-muted-foreground/40 cursor-not-allowed" : ""}
                            `}
                          >
                            {isDone ? <Check className="h-4 w-4 stroke-[2.5]" /> : n}
                          </button>
                          <span className={`text-[10px] font-semibold leading-none ${
                            isDone || isNext ? "text-[hsl(0,65%,52%)]" : "text-muted-foreground/40"
                          }`}>
                            {isDone ? "Done" : isNext ? "Tap" : `#${n}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {exhausted ? (
                  <div className="rounded-xl bg-[hsl(0,65%,52%)]/10 border border-[hsl(0,65%,52%)]/20 px-3 py-2.5 text-center">
                    <p className="text-xs font-semibold text-[hsl(0,65%,52%)]">All 5 attempts exhausted</p>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[hsl(0,65%,52%)]/10 border border-[hsl(0,65%,52%)]/20 px-3 py-2.5 flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full bg-[hsl(0,65%,52%)] animate-pulse flex-shrink-0" />
                    <p className="text-xs font-medium text-[hsl(0,65%,52%)]">
                      {doneCount === 0 ? "Tap circle 1 to record first attempt" : `Tap circle ${nextAttempt} to record attempt ${nextAttempt}`}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── VIEW 3: Refused — obligatory note ── */}
          {view === "refused_note" && (
            <div className="bg-[hsl(340,65%,45%)]/[0.03]">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50">
                <button
                  onClick={() => { setView("status"); setRefusedNote(""); }}
                  className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className="h-3.5 w-3.5 rotate-90" />
                </button>
                <div className="flex items-center gap-1.5 flex-1">
                  <div className="p-1 rounded-md bg-[hsl(340,65%,45%)]/15">
                    <X className="h-3 w-3 text-[hsl(340,65%,45%)]" />
                  </div>
                  <span className="text-xs font-bold text-[hsl(340,65%,45%)]">Refused — Add Note</span>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wide text-[hsl(340,65%,45%)]/70 bg-[hsl(340,65%,45%)]/10 px-1.5 py-0.5 rounded-full border border-[hsl(340,65%,45%)]/20">
                  Required
                </span>
              </div>

              <div className="p-3 space-y-3">
                <Textarea
                  value={refusedNote}
                  onChange={(e) => setRefusedNote(e.target.value)}
                  placeholder="Why did the client refuse? (required)"
                  className="text-xs resize-none min-h-[80px] focus:ring-[hsl(340,65%,45%)]/30 focus:border-[hsl(340,65%,45%)]/50"
                  autoFocus
                />
                <button
                  disabled={!refusedNote.trim()}
                  onClick={() => pick("refused", undefined, refusedNote)}
                  className="w-full py-2 rounded-lg text-xs font-semibold transition-all
                    disabled:opacity-40 disabled:cursor-not-allowed
                    bg-[hsl(340,65%,45%)] text-white hover:bg-[hsl(340,65%,40%)] active:scale-95"
                >
                  Confirm Refused
                </button>
              </div>
            </div>
          )}

        </PopoverContent>
      </Popover>

      {/* Timestamp under pill */}
      {updatedAt && (
        <span className="text-[9px] text-muted-foreground/45 leading-none pl-1">{updatedAt}</span>
      )}
    </div>
  );
}

/* ── Cell renderer ── */
function renderCell(
  key: ColumnKey,
  row: FollowUpRow & { segment: "failed_attempt" | "delayed" | "on_going" | null },
  segMeta: (typeof segmentMeta)[keyof typeof segmentMeta] | null,
  savingId: string | null,
  handleStatusChange: (id: string, status: string, attempt?: number, note?: string) => void,
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
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setTrackingTarget({ orioId: row.orio_order_id!, sellerId: row.seller_id ?? "" })}
            className="text-[hsl(210,60%,52%)] hover:underline font-semibold text-xs tabular-nums"
          >
            {row.orio_order_id}
          </button>
          <a
            href={`https://oms.getorio.com/orderDetail?odid=${row.orio_order_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground/40 hover:text-[hsl(210,60%,52%)] transition-colors"
            title="Open in Orio OMS"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>
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

    case "phone": {
      const phone = row.customer_phone;
      if (!phone) return <span className="text-muted-foreground/50 text-xs">—</span>;
      const cleaned = phone.replace(/\D/g, "");
      const waNumber = cleaned.startsWith("92") ? cleaned : cleaned.startsWith("0") ? "92" + cleaned.slice(1) : cleaned;
      const waUrl = `https://wa.me/${waNumber}`;
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-xs tabular-nums font-medium text-foreground/70">{phone}</span>
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open WhatsApp"
            className="flex-shrink-0 text-[hsl(142,70%,42%)]/50 hover:text-[hsl(142,70%,42%)] transition-colors"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          </a>
        </div>
      );
    }

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
      return (
        <div className="flex flex-col items-start gap-0.5">
          <StatusPill value={row.delivery_status} styleMap={deliveryStatusStyle} />
          {detectCourier(row.orio_consignment_no) && (
            <span className="text-[9px] font-semibold text-muted-foreground/55 leading-none pl-1 truncate max-w-[100px]">
              {detectCourier(row.orio_consignment_no)}
            </span>
          )}
        </div>
      );

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
              className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all active:scale-95 ${
                hasNote
                  ? "bg-[hsl(45,90%,55%)]/15 text-[hsl(45,90%,55%)] hover:bg-[hsl(45,90%,55%)]/25 shadow-sm"
                  : "bg-muted/40 text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground"
              }`}
            >
              <StickyNote className="w-4 h-4" />
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

    case "actions": {
      const phone = row.customer_phone ?? "";
      const cleaned = phone.replace(/\D/g, "");
      const waNumber = cleaned.startsWith("92") ? cleaned : cleaned.startsWith("0") ? "92" + cleaned.slice(1) : cleaned;
      const waUrl = `https://wa.me/${waNumber}`;
      return (
        <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity duration-150">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate(`/orders/${row.order_id}`)}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(30,90%,55%)]/10 text-[hsl(30,90%,55%)] hover:bg-[hsl(30,90%,55%)]/20 transition-colors active:scale-95"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p className="text-xs">Edit Order</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setHistoryOrder({ id: row.order_id, customer: row.customer_name })}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(210,60%,52%)]/10 text-[hsl(210,60%,52%)] hover:bg-[hsl(210,60%,52%)]/20 transition-colors active:scale-95"
              >
                <History className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p className="text-xs">Order History</p></TooltipContent>
          </Tooltip>
          {phone && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(142,70%,42%)]/10 text-[hsl(142,70%,42%)] hover:bg-[hsl(142,70%,42%)]/20 transition-colors active:scale-95"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </a>
              </TooltipTrigger>
              <TooltipContent side="top"><p className="text-xs">WhatsApp {row.customer_name}</p></TooltipContent>
            </Tooltip>
          )}
        </div>
      );
    }
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

