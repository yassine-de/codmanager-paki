import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { format } from "date-fns";
import OrderHistoryModal from "@/components/OrderHistoryModal";

type Segment = "all" | "failed_attempt" | "delayed" | "on_going";

const FOLLOW_UP_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "contacted_courier", label: "Contacted Courier" },
  { value: "contacted_client", label: "Contacted Client" },
  { value: "client_confirmed", label: "Client Confirmed" },
  { value: "resent_to_courier", label: "Resent to Courier" },
  { value: "closed", label: "Closed" },
];

// Modern status colors using project's HSL token style
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
  const [savingId, setSavingId] = useState<string | null>(null);
  const [historyOrder, setHistoryOrder] = useState<{ id: string; customer: string } | null>(null);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["follow-ups-data"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_follow_ups_data");
      if (error) throw error;
      return (data ?? []) as FollowUpRow[];
    },
    enabled: !!authUser && (authUser.role === "admin" || authUser.role === "agent"),
    refetchInterval: 30000,
  });

  // Realtime
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

  // KPIs (over ALL ORIO-synced orders, no filters)
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

  // Segment counts
  const segCounts = useMemo(() => {
    const c = { failed_attempt: 0, delayed: 0, on_going: 0 };
    for (const r of enriched) if (r.segment) c[r.segment]++;
    return c;
  }, [enriched]);

  // Distinct sellers / agents / delivery statuses for filters
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
      if (segment !== "all" && r.segment !== segment) return false;
      if (filterDelivery !== "all" && r.delivery_status !== filterDelivery) return false;
      if (filterSeller !== "all" && r.seller_id !== filterSeller) return false;
      if (filterAgent !== "all" && r.agent_id !== filterAgent) return false;
      if (filterFollowUp !== "all" && r.follow_up_status !== filterFollowUp) return false;
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
  }, [enriched, segment, filterDelivery, filterSeller, filterAgent, filterFollowUp, search]);

  const activeFilterCount =
    (segment !== "all" ? 1 : 0) +
    (filterDelivery !== "all" ? 1 : 0) +
    (filterSeller !== "all" ? 1 : 0) +
    (filterAgent !== "all" ? 1 : 0) +
    (filterFollowUp !== "all" ? 1 : 0) +
    (search.trim() ? 1 : 0);

  function clearFilters() {
    setSegment("all");
    setFilterDelivery("all");
    setFilterSeller("all");
    setFilterAgent("all");
    setFilterFollowUp("all");
    setSearch("");
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

  // Auth gate AFTER all hooks
  if (!authLoading && authUser && authUser.role !== "admin" && authUser.role !== "agent") {
    return <Navigate to="/" replace />;
  }

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
          <KPICard
            icon={Truck}
            label="Total Shipped to ORIO"
            value={kpis.total}
            sub="Orders synced"
            tone="muted"
          />
          <KPICard
            icon={Activity}
            label="Currently Shipped"
            value={kpis.shipped}
            sub={`${kpis.shippedPct}% of total`}
            tone="info"
          />
          <KPICard
            icon={PackageCheck}
            label="Delivered"
            value={kpis.delivered}
            sub={`${kpis.deliveredPct}% of total`}
            tone="success"
          />
          <KPICard
            icon={Hourglass}
            label="Pending Follow-up"
            value={kpis.pending}
            sub={`${kpis.pendingPct}% need action`}
            tone="warning"
          />
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
        <Card className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search order, customer, phone, city, seller, agent..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-9 text-xs gap-1"
              >
                <X className="h-3.5 w-3.5" />
                Clear ({activeFilterCount})
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Select value={filterDelivery} onValueChange={setFilterDelivery}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Delivery Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Delivery Status</SelectItem>
                {filterOptions.deliveries.map((d) => (
                  <SelectItem key={d} value={d}>
                    {formatStatus(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterSeller} onValueChange={setFilterSeller}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Seller" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sellers</SelectItem>
                {filterOptions.sellers.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterAgent} onValueChange={setFilterAgent}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {filterOptions.agents.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterFollowUp} onValueChange={setFilterFollowUp}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Follow Up Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Follow Up Status</SelectItem>
                {FOLLOW_UP_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Table */}
        <Card className="overflow-hidden">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs uppercase tracking-wider">Order ID</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Customer</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Phone</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">City</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Seller</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Delivery</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-center">Days</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Segment</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider min-w-[180px]">Follow Up</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Created</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Updated</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 12 }).map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-12">
                      No follow-ups found
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => {
                    const segMeta = row.segment ? segmentMeta[row.segment] : null;
                    return (
                      <TableRow key={row.order_id} className="hover:bg-muted/40">
                        <TableCell className="font-mono text-xs font-medium">{row.order_id}</TableCell>
                        <TableCell className="text-xs">{row.customer_name || "—"}</TableCell>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">
                          {row.customer_phone || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.customer_city || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{row.seller_name || "—"}</TableCell>
                        <TableCell>
                          <StatusPill value={row.delivery_status} styleMap={deliveryStatusStyle} />
                        </TableCell>
                        <TableCell className="text-center text-xs tabular-nums font-medium">
                          {row.days_since_shipped ?? "—"}
                        </TableCell>
                        <TableCell>
                          {segMeta ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${segMeta.pill}`}
                            >
                              <segMeta.icon className="h-3 w-3" />
                              {segMeta.label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={row.follow_up_status}
                            onValueChange={(v) => handleStatusChange(row.order_id, v)}
                            disabled={savingId === row.order_id}
                          >
                            <SelectTrigger
                              className={`h-7 text-[11px] border rounded-full px-2.5 py-0 w-auto min-w-[140px] gap-1 ${
                                followUpStatusStyle[row.follow_up_status] ?? ""
                              }`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FOLLOW_UP_STATUSES.map((s) => (
                                <SelectItem key={s.value} value={s.value} className="text-xs">
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${
                                      followUpStatusStyle[s.value] ?? ""
                                    }`}
                                  >
                                    {s.label}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground tabular-nums">
                          {format(new Date(row.order_created_at), "dd MMM HH:mm")}
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground tabular-nums">
                          {format(new Date(row.order_updated_at), "dd MMM HH:mm")}
                        </TableCell>
                        <TableCell>
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
                              <TooltipContent side="top">
                                <p className="text-xs">Edit Order</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() =>
                                    setHistoryOrder({
                                      id: row.order_id,
                                      customer: row.customer_name,
                                    })
                                  }
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[hsl(210,60%,52%)]/10 text-[hsl(210,60%,52%)] hover:bg-[hsl(210,60%,52%)]/20 transition-colors active:scale-95"
                                >
                                  <History className="w-3.5 h-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p className="text-xs">Order History</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
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
      </div>
    </TooltipProvider>
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
