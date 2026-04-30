import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
} from "lucide-react";
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
  { value: "closed", label: "Closed" },
];

const followUpStatusStyle: Record<string, string> = {
  pending: "bg-[hsl(30,6%,50%)]/12 text-[hsl(30,6%,50%)] border-[hsl(30,6%,50%)]/25",
  contacted_courier: "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/25",
  contacted_client: "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/25",
  client_confirmed: "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/25",
  resent_to_courier: "bg-[hsl(270,50%,55%)]/12 text-[hsl(270,50%,55%)] border-[hsl(270,50%,55%)]/25",
  closed: "bg-[hsl(155,50%,42%)]/15 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/30 font-semibold",
};

const deliveryStatusStyle: Record<string, string> = {
  pending: "bg-[hsl(30,6%,50%)]/12 text-[hsl(30,6%,50%)] border-[hsl(30,6%,50%)]/25",
  booked: "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/25",
  shipped: "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/25",
  in_transit: "bg-[hsl(230,55%,55%)]/12 text-[hsl(230,55%,55%)] border-[hsl(230,55%,55%)]/25",
  with_courier: "bg-[hsl(185,55%,42%)]/12 text-[hsl(185,55%,42%)] border-[hsl(185,55%,42%)]/25",
  out_for_delivery: "bg-[hsl(185,55%,42%)]/12 text-[hsl(185,55%,42%)] border-[hsl(185,55%,42%)]/25",
  delivered: "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/25",
  returned: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/25",
  cancelled: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/25",
  failed_attempt: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/25",
  ready_for_return: "bg-[hsl(15,75%,55%)]/12 text-[hsl(15,75%,55%)] border-[hsl(15,75%,55%)]/25",
  rejected: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/25",
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
}

function computeSegment(row: FollowUpRow): "failed_attempt" | "delayed" | "on_going" | null {
  const ds = row.delivery_status;
  const days = row.days_since_shipped ?? 0;

  if (ds === "failed_attempt") return "failed_attempt";
  if ((ds === "in_transit" || ds === "out_for_delivery" || ds === "with_courier") && days >= 3) {
    return "delayed";
  }
  if (
    (ds === "shipped" || ds === "in_transit" || ds === "out_for_delivery" || ds === "with_courier") &&
    days < 3
  ) {
    return "on_going";
  }
  return null;
}

const segmentMeta: Record<
  "failed_attempt" | "delayed" | "on_going",
  { label: string; pill: string; chip: string; icon: typeof AlertTriangle }
> = {
  failed_attempt: {
    label: "Failed Attempt",
    pill: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/25",
    chip: "bg-[hsl(0,65%,52%)]/15 text-[hsl(0,65%,52%)]",
    icon: AlertTriangle,
  },
  delayed: {
    label: "Delayed",
    pill: "bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/25",
    chip: "bg-[hsl(25,85%,55%)]/15 text-[hsl(25,85%,55%)]",
    icon: Clock,
  },
  on_going: {
    label: "On Going",
    pill: "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/25",
    chip: "bg-[hsl(210,60%,52%)]/15 text-[hsl(210,60%,52%)]",
    icon: Activity,
  },
};

function formatStatus(status: string | null): string {
  if (!status) return "—";
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function StatusPill({ value, styleMap }: { value: string | null; styleMap: Record<string, string> }) {
  if (!value) return <span className="text-muted-foreground text-xs">—</span>;
  const cls = styleMap[value] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${cls}`}
    >
      {formatStatus(value)}
    </span>
  );
}

/* ── Column system ── */
type ColumnKey =
  | "order_id"
  | "orio_id"
  | "customer"
  | "phone"
  | "city"
  | "product"
  | "price"
  | "delivery"
  | "segment"
  | "days"
  | "follow_up"
  | "note"
  | "created"
  | "updated"
  | "actions";

const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "order_id", label: "Order ID" },
  { key: "orio_id", label: "ORIO ID" },
  { key: "customer", label: "Customer" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
  { key: "product", label: "Product" },
  { key: "price", label: "Price" },
  { key: "delivery", label: "Delivery" },
  { key: "segment", label: "Sub Status" },
  { key: "days", label: "Days" },
  { key: "follow_up", label: "Follow Up" },
  { key: "note", label: "FU Note" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
  { key: "actions", label: "Actions" },
];

const STORAGE_KEY = "follow-ups:column-config:v4";

type ColumnConfig = { key: ColumnKey; visible: boolean };

function loadColumnConfig(): ColumnConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("none");
    const parsed = JSON.parse(raw) as ColumnConfig[];
    // Backfill any new columns appended at the end
    const existingKeys = new Set(parsed.map((c) => c.key));
    const merged = [
      ...parsed.filter((c) => ALL_COLUMNS.some((a) => a.key === c.key)),
      ...ALL_COLUMNS.filter((a) => !existingKeys.has(a.key)).map((a) => ({
        key: a.key,
        visible: true,
      })),
    ];
    return merged;
  } catch {
    return ALL_COLUMNS.map((c) => ({ key: c.key, visible: true }));
  }
}

export default function FollowUps() {
  const { authUser, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [segment, setSegment] = useState<Segment>("all");
  const [search, setSearch] = useState("");
  const [filterDelivery, setFilterDelivery] = useState<string>("all");
  const [filterSeller, setFilterSeller] = useState<string>("all");
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterFollowUp, setFilterFollowUp] = useState<string>("all");
  const [dateField, setDateField] = useState<DateField>("created");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [historyOrder, setHistoryOrder] = useState<{ id: string; customer: string } | null>(null);
  const [trackingTarget, setTrackingTarget] = useState<{ orioId: number; sellerId: string } | null>(null);

  const [columns, setColumns] = useState<ColumnConfig[]>(() => loadColumnConfig());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["follow-ups-data"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_follow_ups_data");
      if (error) throw error;
      return (data ?? []) as FollowUpRow[];
    },
    enabled: !!authUser && (authUser.role === "admin" || authUser.role === "agent" || authUser.role === "follow_up"),
    refetchInterval: 30000,
  });

  useEffect(() => {
    const channel = supabase
      .channel("follow-ups-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_follow_ups" },
        () => queryClient.invalidateQueries({ queryKey: ["follow-ups-data"] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const enriched = useMemo(
    () => rows.map((r) => ({ ...r, segment: computeSegment(r) })),
    [rows]
  );

  const kpis = useMemo(() => {
    const total = enriched.length;
    const shipped = enriched.filter((r) =>
      ["shipped", "in_transit", "with_courier", "out_for_delivery"].includes(r.delivery_status ?? "")
    ).length;
    const delivered = enriched.filter((r) => r.delivery_status === "delivered").length;
    const pending = enriched.filter((r) => r.follow_up_status !== "closed").length;
    return {
      total,
      shipped,
      delivered,
      pending,
      shippedPct: total > 0 ? Math.round((shipped / total) * 100) : 0,
      deliveredPct: total > 0 ? Math.round((delivered / total) * 100) : 0,
      pendingPct: total > 0 ? Math.round((pending / total) * 100) : 0,
    };
  }, [enriched]);

  const segCounts = useMemo(() => {
    const c = { failed_attempt: 0, delayed: 0, on_going: 0, none: 0 };
    for (const r of enriched) {
      if (r.segment) c[r.segment]++;
      else c.none++;
    }
    return c;
  }, [enriched]);

  const filterOptions = useMemo(() => {
    const sellers = new Map<string, string>();
    const agents = new Map<string, string>();
    const deliveries = new Set<string>();
    for (const r of enriched) {
      if (r.seller_id && r.seller_name) sellers.set(r.seller_id, r.seller_name);
      if (r.agent_id && r.agent_name) agents.set(r.agent_id, r.agent_name);
      if (r.delivery_status) deliveries.add(r.delivery_status);
    }
    return {
      sellers: Array.from(sellers.entries()).sort((a, b) => a[1].localeCompare(b[1])),
      agents: Array.from(agents.entries()).sort((a, b) => a[1].localeCompare(b[1])),
      deliveries: Array.from(deliveries).sort(),
    };
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched.filter((r) => {
      if (segment !== "all") {
        if (segment === "none") {
          if (r.segment !== null) return false;
        } else if (r.segment !== segment) return false;
      }
      if (filterDelivery !== "all" && r.delivery_status !== filterDelivery) return false;
      if (filterSeller !== "all" && r.seller_id !== filterSeller) return false;
      if (filterAgent !== "all" && r.agent_id !== filterAgent) return false;
      if (filterFollowUp !== "all" && r.follow_up_status !== filterFollowUp) return false;

      if (dateRange?.from) {
        const target = new Date(dateField === "created" ? r.order_created_at : r.order_updated_at);
        const start = startOfDay(dateRange.from);
        const end = endOfDay(dateRange.to ?? dateRange.from);
        if (!isWithinInterval(target, { start, end })) return false;
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
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, segment, filterDelivery, filterSeller, filterAgent, filterFollowUp, search, dateRange, dateField]);

  const activeFilterCount =
    (segment !== "all" ? 1 : 0) +
    (filterDelivery !== "all" ? 1 : 0) +
    (filterSeller !== "all" ? 1 : 0) +
    (filterAgent !== "all" ? 1 : 0) +
    (filterFollowUp !== "all" ? 1 : 0) +
    (dateRange?.from ? 1 : 0) +
    (search.trim() ? 1 : 0);

  function clearFilters() {
    setSegment("all");
    setFilterDelivery("all");
    setFilterSeller("all");
    setFilterAgent("all");
    setFilterFollowUp("all");
    setSearch("");
    setDateRange(undefined);
  }

  async function handleStatusChange(orderId: string, newStatus: string) {
    if (!authUser) return;
    setSavingId(orderId);
    try {
      const { error } = await supabase
        .from("order_follow_ups")
        .upsert(
          { order_id: orderId, follow_up_status: newStatus, updated_by: authUser.id },
          { onConflict: "order_id" }
        );
      if (error) throw error;
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
      const { error } = await supabase
        .from("orders")
        .update({ follow_up_note: note })
        .eq("order_id", orderId);
      if (error) throw error;
      toast.success("Note saved");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to save note");
    }
  }

  if (!authLoading && authUser && authUser.role !== "admin" && authUser.role !== "agent" && authUser.role !== "follow_up") {
    return <Navigate to="/" replace />;
  }

  const visibleColumns = columns.filter((c) => c.visible);

  return (
    <TooltipProvider>
      <div className="space-y-6 max-w-[1500px] animate-fade-in">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold">Follow Ups</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Track shipped orders that need attention. Auto-segmented by delivery status & age.
          </p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPICard icon={Truck} label="Total Shipped to ORIO" value={kpis.total} sub="Orders synced" tone="muted" />
          <KPICard icon={Activity} label="Currently Shipped" value={kpis.shipped} sub={`${kpis.shippedPct}% of total`} tone="info" />
          <KPICard icon={PackageCheck} label="Delivered" value={kpis.delivered} sub={`${kpis.deliveredPct}% of total`} tone="success" />
          <KPICard icon={Hourglass} label="Pending Follow-up" value={kpis.pending} sub={`${kpis.pendingPct}% need action`} tone="warning" />
        </div>

        {/* Segment cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(["failed_attempt", "delayed", "on_going"] as const).map((seg) => {
            const meta = segmentMeta[seg];
            const Icon = meta.icon;
            const active = segment === seg;
            return (
              <button
                key={seg}
                onClick={() => setSegment(active ? "all" : seg)}
                className={`text-left rounded-xl border p-4 transition-all hover:shadow-soft ${
                  active ? "ring-2 ring-primary border-primary" : "bg-card"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-md ${meta.chip}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-medium">{meta.label}</span>
                  </div>
                  <span className="text-2xl font-bold tabular-nums">{segCounts[seg]}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <Card className="p-3 sm:p-4 space-y-3">
          {/* Row 1: Search + actions */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
            <div className="relative flex-1 sm:max-w-md min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs sm:text-sm"
              />
            </div>

            <div className="flex items-center gap-2 sm:ml-auto flex-shrink-0">
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-9 text-xs gap-1 flex-1 sm:flex-initial"
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="hidden xs:inline">Clear</span> ({activeFilterCount})
                </Button>
              )}
              <ColumnsManager columns={columns} onChange={setColumns} />
            </div>
          </div>

          {/* Row 2: Filter dropdowns - fully responsive grid */}
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            {/* Segment filter */}
            <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
              <SelectTrigger className="h-9 text-xs min-w-0">
                <SelectValue placeholder="Segment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Segments</SelectItem>
                <SelectItem value="failed_attempt">Failed Attempt</SelectItem>
                <SelectItem value="delayed">Delayed</SelectItem>
                <SelectItem value="on_going">On Going</SelectItem>
                <SelectItem value="none">Unsegmented</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterDelivery} onValueChange={setFilterDelivery}>
              <SelectTrigger className="h-9 text-xs min-w-0">
                <SelectValue placeholder="Delivery Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Delivery Status</SelectItem>
                {filterOptions.deliveries.map((d) => (
                  <SelectItem key={d} value={d}>{formatStatus(d)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterFollowUp} onValueChange={setFilterFollowUp}>
              <SelectTrigger className="h-9 text-xs min-w-0">
                <SelectValue placeholder="Follow Up Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Follow Up Status</SelectItem>
                {FOLLOW_UP_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date range filter - keeps field selector + date side-by-side */}
            <div className="flex gap-1 min-w-0">
              <Select value={dateField} onValueChange={(v) => setDateField(v as DateField)}>
                <SelectTrigger className="h-9 text-xs w-[78px] sm:w-[88px] flex-shrink-0 px-2">
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
                    className={`h-9 text-xs flex-1 min-w-0 justify-start gap-1.5 px-2 ${
                      dateRange?.from ? "" : "text-muted-foreground"
                    }`}
                  >
                    <CalendarIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">
                      {dateRange?.from
                        ? dateRange.to
                          ? `${format(dateRange.from, "dd MMM")} - ${format(dateRange.to, "dd MMM")}`
                          : format(dateRange.from, "dd MMM")
                        : "Pick date"}
                    </span>
                    {dateRange?.from && (
                      <X
                        className="h-3 w-3 ml-auto hover:text-foreground flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDateRange(undefined);
                        }}
                      />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 max-w-[calc(100vw-2rem)]" align="end">
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
          </div>
        </Card>

        {/* Table */}
        <Card className="overflow-hidden">
          <div className="overflow-auto">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  {visibleColumns.map((col) => {
                    const meta = ALL_COLUMNS.find((c) => c.key === col.key)!;
                    const isCenter = col.key === "days";
                    return (
                      <TableHead
                        key={col.key}
                        style={{ width: columnWidths[col.key] }}
                        className={`text-[11px] uppercase tracking-wider px-2 ${isCenter ? "text-center" : ""}`}
                      >
                        {meta.label}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {visibleColumns.map((c) => (
                        <TableCell key={c.key}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumns.length} className="text-center text-muted-foreground py-12">
                      No follow-ups found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => {
                    const segMeta = row.segment ? segmentMeta[row.segment] : null;
                    return (
                      <TableRow key={row.order_id} className="hover:bg-muted/40">
                        {visibleColumns.map((col) => (
                          <TableCell
                            key={col.key}
                            className={cellClassFor(col.key)}
                          >
                            {renderCell(col.key, row, segMeta, savingId, handleStatusChange, handleNoteSave, navigate, setHistoryOrder, setTrackingTarget)}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

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
      </div>
    </TooltipProvider>
  );
}

const columnWidths: Record<ColumnKey, string> = {
  order_id: "80px",
  orio_id: "75px",
  customer: "110px",
  phone: "110px",
  city: "85px",
  product: "130px",
  price: "80px",
  delivery: "90px",
  segment: "100px",
  days: "45px",
  follow_up: "100px",
  note: "130px",
  created: "85px",
  updated: "85px",
  actions: "60px",
};

function cellClassFor(key: ColumnKey): string {
  switch (key) {
    case "order_id": return "font-mono text-[11px] font-medium px-2 truncate";
    case "orio_id": return "font-mono text-[11px] px-2 truncate";
    case "customer": return "text-[11px] px-2 truncate";
    case "phone": return "text-[11px] tabular-nums text-muted-foreground px-2 truncate";
    case "city": return "text-[11px] text-muted-foreground px-2 truncate";
    case "product": return "text-[11px] px-2 truncate";
    case "price": return "text-[11px] tabular-nums font-medium px-2";
    case "days": return "text-center text-[11px] tabular-nums font-medium px-2";
    case "created":
    case "updated": return "text-[10px] text-muted-foreground tabular-nums px-2";
    default: return "px-2";
  }
}

function renderCell(
  key: ColumnKey,
  row: FollowUpRow & { segment: "failed_attempt" | "delayed" | "on_going" | null },
  segMeta: (typeof segmentMeta)[keyof typeof segmentMeta] | null,
  savingId: string | null,
  handleStatusChange: (id: string, status: string) => void,
  handleNoteSave: (id: string, note: string) => void,
  navigate: (to: string) => void,
  setHistoryOrder: (v: { id: string; customer: string } | null) => void,
  setTrackingTarget: (v: { orioId: number; sellerId: string } | null) => void,
) {
  switch (key) {
    case "order_id": return row.order_id;
    case "orio_id":
      return row.orio_order_id ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setTrackingTarget({ orioId: row.orio_order_id!, sellerId: row.seller_id ?? "" });
          }}
          className="text-[hsl(210,60%,52%)] hover:underline font-medium"
        >
          {row.orio_order_id}
        </button>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case "customer": return row.customer_name || "—";
    case "phone": return row.customer_phone || "—";
    case "city": return row.customer_city || "—";
    case "product": return row.product_name || "—";
    case "price": return row.total_amount != null ? `${Number(row.total_amount).toLocaleString()} PKR` : "—";
    case "delivery": return <StatusPill value={row.delivery_status} styleMap={deliveryStatusStyle} />;
    case "days": return row.days_since_shipped ?? "—";
    case "segment": {
      const raw = row.shipping_status;
      if (!raw) return <span className="text-muted-foreground text-xs">—</span>;
      const label = raw.replace(/\b\w/g, (c) => c.toUpperCase());
      const s = raw.toLowerCase().trim();
      let cls = "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/20";
      if (s === "delivered") cls = "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20";
      else if (s === "cancelled" || s === "refused to accept") cls = "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20";
      else if (s === "failed attempt") cls = "bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20";
      else if (s === "ready for return" || s.startsWith("return")) cls = "bg-[hsl(340,65%,52%)]/12 text-[hsl(340,65%,52%)] border-[hsl(340,65%,52%)]/20";
      else if (s === "new") cls = "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20";
      return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${cls}`}>
          {label}
        </span>
      );
    }
    case "follow_up":
      return (
        <Select
          value={row.follow_up_status}
          onValueChange={(v) => handleStatusChange(row.order_id, v)}
          disabled={savingId === row.order_id}
        >
          <SelectTrigger className={`h-7 text-[11px] border rounded-full px-2 py-0 w-fit min-w-0 gap-1 [&>span]:truncate ${followUpStatusStyle[row.follow_up_status] ?? ""}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FOLLOW_UP_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${followUpStatusStyle[s.value] ?? ""}`}>
                  {s.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "note":
      return (
        <input
          type="text"
          defaultValue={row.follow_up_note ?? ""}
          placeholder="Add note…"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (row.follow_up_note ?? "")) handleNoteSave(row.order_id, v);
          }}
          className="h-7 text-xs px-2 rounded-md border border-input bg-background w-full min-w-[140px] focus:outline-none focus:ring-1 focus:ring-primary"
        />
      );
    case "created": return format(new Date(row.order_created_at), "dd MMM HH:mm");
    case "updated": return format(new Date(row.order_updated_at), "dd MMM HH:mm");
    case "actions":
      return (
        <div className="flex items-center gap-1.5">
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

/* ── Columns Manager (reorder + show/hide) ── */
function ColumnsManager({
  columns,
  onChange,
}: {
  columns: ColumnConfig[];
  onChange: (next: ColumnConfig[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = columns.findIndex((c) => c.key === active.id);
    const newIndex = columns.findIndex((c) => c.key === over.id);
    onChange(arrayMove(columns, oldIndex, newIndex));
  }

  function toggleVisibility(key: ColumnKey) {
    onChange(columns.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));
  }

  function resetDefault() {
    onChange(ALL_COLUMNS.map((c) => ({ key: c.key, visible: true })));
  }

  const visibleCount = columns.filter((c) => c.visible).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
          <Columns3 className="h-3.5 w-3.5" />
          Columns
          <span className="text-muted-foreground">({visibleCount})</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-xs font-semibold">Reorder & Toggle Columns</div>
          <button
            onClick={resetDefault}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        </div>
        <div className="p-2 max-h-[400px] overflow-y-auto">
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
                    onToggle={() => toggleVisibility(col.key)}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
        <div className="px-3 py-2 border-t text-[11px] text-muted-foreground">
          Drag <GripVertical className="inline h-3 w-3" /> to reorder. Click eye to show/hide.
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SortableColumnItem({
  id,
  label,
  visible,
  onToggle,
}: {
  id: ColumnKey;
  label: string;
  visible: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 group"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className={`text-xs flex-1 ${visible ? "" : "text-muted-foreground line-through"}`}>
        {label}
      </span>
      <button
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground p-0.5"
        aria-label={visible ? "Hide" : "Show"}
      >
        {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/* ── KPI sub-component ── */
function KPICard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Truck;
  label: string;
  value: number;
  sub: string;
  tone: "muted" | "info" | "success" | "warning";
}) {
  const toneCls = {
    muted: "bg-muted text-muted-foreground",
    info: "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)]",
    success: "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)]",
    warning: "bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)]",
  }[tone];

  return (
    <Card className="p-4 hover:shadow-soft transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium truncate">
            {label}
          </p>
          <p className="text-2xl font-bold tabular-nums mt-1">{value.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
        </div>
        <div className={`p-2 rounded-lg ${toneCls}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}
