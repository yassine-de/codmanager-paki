import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Truck, Package, CheckCircle2, XCircle, AlertTriangle, RotateCcw,
  MapPin, Users, Award, TrendingUp, BarChart2, ChevronUp, ChevronDown,
  ChevronsUpDown, Loader2, ArrowRight, PackageX, PackageCheck, Navigation,
  Printer, Send, Layers, Activity,
} from "lucide-react";
import {
  formatPKT as format,
  startOfDayPKT as startOfDay,
  endOfDayPKT as endOfDay,
  subDaysPKT as subDays,
} from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { isDeliveredStatus, isInShippedDeliveryPool } from "@/lib/delivery-rate";

// ─── Types ────────────────────────────────────────────────────────────────────

type Order = {
  id: string;
  order_id: string;
  confirmation_status: string;
  confirmation_channel: string | null;
  delivery_status: string | null;
  product_name: string;
  seller_id: string;
  agent_id: string | null;
  original_agent_id: string | null;
  customer_city: string | null;
  created_at: string;
  confirmed_at: string | null;
  delivered_at: string | null;
  updated_at: string;
  shipping_status: string | null;
  shipments?: Array<{
    tracking_number: string | null;
    carriers?: { name: string | null } | null;
  }>;
};

type FollowUpRow = {
  order_id: string;
  follow_up_status: string;
  updated_by: string | null;
  updated_at: string;
};

type DeliveryStatusEvent = {
  order_id: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

type SortDir = "asc" | "desc";
type DateField = "created" | "updated";

type CourierSortField = "courier" | "total" | "delivered" | "failed" | "returned" | "rate";
type CitySortField = "city" | "total" | "delivered" | "failed" | "returned" | "inProcess" | "rate";
type AgentSortField = "name" | "shipped" | "delivered" | "failed" | "rate";

// ─── Constants ────────────────────────────────────────────────────────────────

const ORDER_SELECT =
  "id, order_id, confirmation_status, confirmation_channel, delivery_status, product_name, seller_id, agent_id, original_agent_id, customer_city, created_at, confirmed_at, delivered_at, updated_at, shipping_status, shipments(tracking_number, carriers(name))";
const PAGE_SIZE = 1000;

const CONFIRMED_DELIVERY_STATUSES = [
  "booked", "printed", "dispatched", "shipped", "in_transit", "with_courier", "out_for_delivery",
  "delivered", "paid", "failed_attempt", "returned", "return", "ready_for_return", "return_received",
];
const DELIVERED_STATUSES = ["delivered"];
const SUCCESSFUL_DELIVERY_STATUSES = ["delivered", "paid"];
const ACTIVE_SHIPPING_STATUSES = ["shipped", "in_transit", "with_courier", "out_for_delivery"];
const RETURNED_STATUSES = ["returned", "return", "return_received"];
const RETURN_RECEIVED_STATUSES = ["return_received"];
// Matches FollowUps.tsx's RETURN_DELIVERY_STATUSES / STALE_REATTEMPT_MS exactly,
// so "stale re-attempt" here means the same thing as the warning shown there.
const RETURN_LIKE_STATUSES = ["returned", "return", "ready_for_return", "return_received"];
const STALE_REATTEMPT_MS = 24 * 60 * 60 * 1000;
// Only these two follow_up_status values represent an actual attempt to
// rescue the delivery. "refused"/"area_restricted" are correct triage calls
// (the customer said no / the address can't be served) — blending them into
// a single "effectiveness" number makes real rescue attempts look far worse
// than they are, since refused orders are ~1% delivered by nature, not by
// a failure of follow-up. "no_answer"/"postponed" are still-open, not a
// completed rescue attempt either way.
const RESCUE_ATTEMPT_STATUSES = ["re_attempted", "pushed_delivery"];
const SHIPPED_POOL_STATUSES = [
  ...ACTIVE_SHIPPING_STATUSES,
  ...SUCCESSFUL_DELIVERY_STATUSES,
  "failed_attempt",
  "no_answer",
  "postponed",
  ...RETURNED_STATUSES,
  "ready_for_return",
];

const DELIVERY_STATUS_OPTIONS = [
  { value: "booked", label: "Booked" },
  { value: "printed", label: "Printed" },
  { value: "dispatched", label: "Dispatched" },
  { value: "shipped", label: "Shipped" },
  { value: "in_transit", label: "In Transit" },
  { value: "with_courier", label: "With Courier" },
  { value: "out_for_delivery", label: "Out for Delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "paid", label: "Paid" },
  { value: "failed_attempt", label: "Failed Attempt" },
  { value: "returned", label: "Returned" },
  { value: "return", label: "Return" },
  { value: "ready_for_return", label: "Ready for Return" },
  { value: "return_received", label: "Return Received" },
];

// Courier color map
const COURIER_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  mpostex:  { bg: "bg-blue-100 dark:bg-blue-900/30",   text: "text-blue-700 dark:text-blue-300",   accent: "#3b82f6" },
  bleux:    { bg: "bg-sky-100 dark:bg-sky-900/30",     text: "text-sky-700 dark:text-sky-300",     accent: "#0ea5e9" },
  leopard:  { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-300", accent: "#f97316" },
  tcs:      { bg: "bg-red-100 dark:bg-red-900/30",     text: "text-red-700 dark:text-red-300",     accent: "#ef4444" },
  trax:     { bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-300", accent: "#8b5cf6" },
};

function courierColor(name: string) {
  const key = name.toLowerCase().replace(/\s+/g, "");
  for (const [k, v] of Object.entries(COURIER_COLORS)) {
    if (key.includes(k)) return v;
  }
  return { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-700 dark:text-gray-300", accent: "#6b7280" };
}

// Detect courier name from shipment carrier, tracking number prefix, or shipping_status
function detectCourier(o: Pick<Order, "shipments" | "shipping_status">): string {
  const shipment = o.shipments?.[0];
  if (shipment?.carriers?.name) return shipment.carriers.name;
  const cn = (shipment?.tracking_number || "").toUpperCase().trim();
  const ss = (o.shipping_status || "").toLowerCase();

  // Check consignment number prefix
  if (cn.startsWith("MP") || cn.includes("MPX") || cn.includes("MPOSTEX")) return "MPostex";
  if (cn.startsWith("BL") || cn.includes("BLX") || cn.includes("BLEUX"))   return "Bleux";
  if (cn.startsWith("LD") || cn.includes("LEO") || cn.includes("LEOPARD")) return "Leopard";
  if (cn.startsWith("TCS") || cn.includes("TCS"))                           return "TCS";
  if (cn.startsWith("TR") || cn.includes("TRX") || cn.includes("TRAX"))    return "Trax";

  // Fallback: check shipping_status for courier hints
  if (ss.includes("mpostex")) return "MPostex";
  if (ss.includes("bleux"))   return "Bleux";
  if (ss.includes("leopard")) return "Leopard";
  if (ss.includes("tcs"))     return "TCS";
  if (ss.includes("trax"))    return "Trax";

  // If consignment number exists but unknown pattern, label as "Other"
  if (cn.length > 3) return "Other";
  return "Unknown";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(num: number, den: number): number {
  return den === 0 ? 0 : (num / den) * 100;
}

function fmtPct(n: number): string {
  return n.toFixed(1) + "%";
}

function rateColor(rate: number): string {
  if (rate >= 70) return "hsl(155, 50%, 42%)";
  if (rate >= 40) return "hsl(38, 90%, 55%)";
  return "hsl(0, 65%, 52%)";
}

function rateBadgeClass(rate: number): string {
  if (rate >= 70) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (rate >= 40) return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
}

function rateGradient(rate: number): string {
  if (rate >= 70) return "from-emerald-500 to-green-400";
  if (rate >= 40) return "from-amber-500 to-yellow-400";
  return "from-red-500 to-rose-400";
}

function rateLabel(rate: number): string {
  if (rate >= 80) return "Excellent";
  if (rate >= 65) return "Good";
  if (rate >= 40) return "Average";
  return "Poor";
}

// Categorize a raw carrier sub-status string (e.g. "Delivered to Customer",
// "Attempt Made: RFD(REFUSED TO RECEIVE)") into a tone for the sub-status
// breakdown table — purely presentational, does not affect any KPI math.
function subStatusTone(status: string): { bg: string; text: string; dot: string } {
  const s = status.toLowerCase();
  if (s.includes("delivered")) return { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300", dot: "#10b981" };
  if (s.includes("return")) return { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", dot: "#ef4444" };
  if (s.includes("attempt") || s.includes("refused") || s.includes("unsuccessful") || s.includes("failed")) return { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-300", dot: "#f59e0b" };
  if (s.includes("transit") || s.includes("enroute") || s.includes("dispatch") || s.includes("departed") || s.includes("out-for-delivery") || s.includes("out for delivery")) return { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-300", dot: "#3b82f6" };
  if (s.includes("book")) return { bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-300", dot: "#8b5cf6" };
  return { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-700 dark:text-gray-300", dot: "#6b7280" };
}

function isWithinRange(date: Date, range: DateRange | undefined): boolean {
  if (!range?.from) return true;
  if (date < startOfDay(range.from)) return false;
  if (range.to && date > endOfDay(range.to)) return false;
  if (!range.to && date > endOfDay(range.from)) return false;
  return true;
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

async function fetchAllOrders(): Promise<Order[]> {
  const rows: Order[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as Order[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function fetchAllDeliveryStatusEvents(): Promise<DeliveryStatusEvent[]> {
  const rows: DeliveryStatusEvent[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("order_history")
      .select("order_id, old_value, new_value, created_at")
      .eq("field_changed", "delivery_status")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as DeliveryStatusEvent[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function fetchAllFollowUps(): Promise<FollowUpRow[]> {
  const rows: FollowUpRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("order_follow_ups" as any)
      .select("order_id, follow_up_status, updated_by, updated_at")
      .order("updated_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data || []) as FollowUpRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KPICardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ElementType;
  colorBg: string;
  colorIcon: string;
  gradient: string;
  delay?: number;
  pool?: number;
  onClick?: () => void;
}

function KPICard({ title, value, subtitle, icon: Icon, colorBg, colorIcon, gradient, delay = 0, pool, onClick }: KPICardProps) {
  const numVal = typeof value === "number" ? value : 0;
  const poolPct = pool && pool > 0 ? pct(numVal, pool) : null;

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-card border border-border/50",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_-16px_rgba(0,0,0,0.16)]",
        "transition-all duration-300 ease-out animate-slide-up",
        onClick
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_1px_2px_rgba(0,0,0,0.06),0_18px_36px_-16px_rgba(0,0,0,0.22)]"
          : "hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_16px_32px_-16px_rgba(0,0,0,0.2)]",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Soft glow accent behind the top edge */}
      <div className={cn("pointer-events-none absolute -top-2 inset-x-6 h-4 rounded-full bg-gradient-to-r blur-md opacity-30", gradient)} />
      <div className={cn("relative h-[3px] w-full bg-gradient-to-r", gradient)} />
      <div className="relative p-4">
        <div className="flex items-start justify-between mb-3.5">
          <div className={cn("p-2.5 rounded-2xl ring-1 ring-inset ring-black/5 dark:ring-white/10 shadow-sm", colorBg)}>
            <Icon className={cn("h-4 w-4", colorIcon)} />
          </div>
          {poolPct !== null && (
            <span className="text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full bg-muted/70 text-muted-foreground border border-border/40 backdrop-blur-sm">
              {fmtPct(poolPct)}
            </span>
          )}
        </div>
        <div className="space-y-1">
          <div className="text-[26px] leading-none font-bold tracking-tight text-foreground tabular-nums">
            {typeof value === "number" ? value.toLocaleString() : value}
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">{title}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          {poolPct !== null && (
            <div className="h-1.5 bg-muted/70 rounded-full overflow-hidden mt-2.5 shadow-inner">
              <div
                className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", gradient)}
                style={{ width: `${Math.min(poolPct, 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon, title, subtitle, iconBg, iconColor,
}: { icon: React.ElementType; title: string; subtitle?: string; iconBg: string; iconColor: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={cn("p-2.5 rounded-xl ring-1 ring-inset ring-black/5 dark:ring-white/10 shadow-sm", iconBg)}>
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <div>
        <h2 className="text-[13px] font-bold tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function SortIcon({ field, active, dir }: { field: string; active: string; dir: SortDir }) {
  if (active !== field) return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50 inline ml-1" />;
  return dir === "desc"
    ? <ChevronDown className="h-3 w-3 text-primary inline ml-1" />
    : <ChevronUp className="h-3 w-3 text-primary inline ml-1" />;
}

function SkeletonBlock() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-2xl border bg-card overflow-hidden animate-pulse">
            <div className="h-1 bg-muted" />
            <div className="p-4 space-y-3">
              <div className="w-8 h-8 rounded-xl bg-muted" />
              <div className="space-y-1.5">
                <div className="h-6 w-14 rounded bg-muted" />
                <div className="h-3 w-20 rounded bg-muted" />
              </div>
            </div>
          </div>
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl border bg-card p-5 animate-pulse space-y-3">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="h-32 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DeliveryAnalytics() {
  const [sellerFilter, setSellerFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [courierFilter, setCourierFilter] = useState("all");
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [dateField, setDateField] = useState<DateField>("created");

  const [showAllProducts, setShowAllProducts] = useState(false);

  const [courierSort, setCourierSort] = useState<CourierSortField>("rate");
  const [courierSortDir, setCourierSortDir] = useState<SortDir>("desc");

  const [citySort, setCitySort] = useState<CitySortField>("rate");
  const [citySortDir, setCitySortDir] = useState<SortDir>("desc");
  const [showAllCities, setShowAllCities] = useState(false);

  const [agentSort, setAgentSort] = useState<AgentSortField>("rate");
  const [agentSortDir, setAgentSortDir] = useState<SortDir>("desc");

  const [showFailedAttemptDetail, setShowFailedAttemptDetail] = useState(false);

  // ── Data Queries ─────────────────────────────────────────────────────────────

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["delivery-analytics-orders-v4"],
    queryFn: fetchAllOrders,
  });

  const { data: deliveryStatusEvents = [] } = useQuery({
    queryKey: ["delivery-analytics-status-events-v1"],
    queryFn: fetchAllDeliveryStatusEvents,
  });

  const { data: followUps = [] } = useQuery({
    queryKey: ["delivery-analytics-follow-ups-v1"],
    queryFn: fetchAllFollowUps,
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, name");
      if (error) throw error;
      return data as { user_id: string; name: string }[];
    },
  });

  const profileMap = useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach((p) => { m[p.user_id] = p.name; });
    return m;
  }, [profiles]);

  const orderByOrderId = useMemo(() => {
    const m: Record<string, Order> = {};
    orders.forEach((o) => { m[o.order_id] = o; });
    return m;
  }, [orders]);

  // order_follow_ups is upserted one row per order_id (onConflict: "order_id"),
  // so this is a safe 1:1 lookup.
  const followUpByOrderId = useMemo(() => {
    const m: Record<string, FollowUpRow> = {};
    followUps.forEach((f) => { m[f.order_id] = f; });
    return m;
  }, [followUps]);

  // ── Derived options ──────────────────────────────────────────────────────────

  const sellerOptions = useMemo(() => {
    const ids = [...new Set(orders.map((o) => o.seller_id))];
    return ids
      .map((id) => ({ value: id, label: profileMap[id] || id.slice(0, 8) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, profileMap]);

  const productOptions = useMemo(() => {
    const source = sellerFilter === "all" ? orders : orders.filter((o) => o.seller_id === sellerFilter);
    const names = [...new Set(source.map((o) => o.product_name).filter(Boolean))];
    return names.sort().map((n) => ({ value: n, label: n }));
  }, [orders, sellerFilter]);

  const courierOptions = useMemo(() => {
    const names = [...new Set(orders.map((o) => detectCourier(o)))].filter(Boolean);
    return names.sort().map((n) => ({ value: n, label: n }));
  }, [orders]);

  // ── Filtered orders ──────────────────────────────────────────────────────────

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (sellerFilter !== "all" && o.seller_id !== sellerFilter) return false;
      if (productFilter !== "all" && o.product_name !== productFilter) return false;
      if (courierFilter !== "all" && detectCourier(o) !== courierFilter) return false;
      if (deliveryStatusFilter !== "all" && o.delivery_status !== deliveryStatusFilter) return false;
      const dt = dateField === "created" ? o.created_at : o.updated_at;
      if (!isWithinRange(new Date(dt), dateRange)) return false;
      return true;
    });
  }, [orders, sellerFilter, productFilter, courierFilter, deliveryStatusFilter, dateField, dateRange]);

  // ── KPI Calculations ─────────────────────────────────────────────────────────

  // The daily trend chart plots its own rolling window independent of the main
  // date filter — each line buckets by its own event date — so it needs an
  // unbounded-by-date population (seller/product/status filtered only).
  const eventFilteredPool = useMemo(() => {
    return orders.filter((o) => {
      if (sellerFilter !== "all" && o.seller_id !== sellerFilter) return false;
      if (productFilter !== "all" && o.product_name !== productFilter) return false;
      if (courierFilter !== "all" && detectCourier(o) !== courierFilter) return false;
      if (deliveryStatusFilter !== "all" && o.delivery_status !== deliveryStatusFilter) return false;
      return true;
    });
  }, [orders, sellerFilter, productFilter, courierFilter, deliveryStatusFilter]);

  // Same basis-aware event rule used by SellerAnalytics.tsx (the page this was
  // reconciled against): in "created" mode every metric is scoped by
  // created_at — a pure cohort view ("of orders placed in this period, what's
  // their status now"), one single population so nothing can mismatch. In
  // "updated" mode each metric uses ITS OWN event timestamp when it has one
  // (confirmed_at, delivered_at) so "Confirmed"/"Delivered" mean what really
  // happened in the period, not just "current status of whatever was touched
  // today" — falling back to updated_at only for stages with no dedicated
  // timestamp (booked/printed/dispatched/shipped/failed_attempt/ready_for_return).
  //
  // Earlier attempts got this wrong twice: (1) mixing event dates for
  // confirmed/delivered/returned with a plain created_at/updated_at filter for
  // everything else — poolCount came out 0 while Delivered came out 5 for the
  // same filter, a 0-denominator rate next to a nonzero numerator; (2) scoping
  // EVERY metric to a blunt updated_at/created_at snapshot ("orders touched
  // today, whatever their current status") — "Confirmed" then meant something
  // completely different from what SellerAnalytics' own confirmed-trend chart
  // shows for the same day (578 touched-and-currently-confirmed vs. 5 that
  // actually became confirmed that day). poolCount is deliberately just
  // `shipped`'s own event-scoped count (not a separately-defined population),
  // so the delivery/return/failed-attempt rates can never divide mismatched sets.
  const inRangeByEvent = (o: Order, eventIso: string | null): boolean => {
    if (!dateRange?.from) return true;
    const d = dateField === "created" ? o.created_at : (eventIso ?? o.updated_at);
    return isWithinRange(new Date(d), dateRange);
  };

  const kpis = useMemo(() => {
    const matchesNonStatusFilters = (o: Order) =>
      (sellerFilter === "all" || o.seller_id === sellerFilter) &&
      (productFilter === "all" || o.product_name === productFilter) &&
      (courierFilter === "all" || detectCourier(o) === courierFilter);
    const matchesFilters = (o: Order) =>
      matchesNonStatusFilters(o) &&
      (deliveryStatusFilter === "all" || o.delivery_status === deliveryStatusFilter);
    const base = orders.filter(matchesFilters);
    const baseWithoutStatusFilter = orders.filter(matchesNonStatusFilters);

    const selectedStatusAllows = (statuses: string[]) =>
      deliveryStatusFilter === "all" || statuses.includes(deliveryStatusFilter);

    const countCurrentStatus = (statuses: string[], eventDate: (o: Order) => string | null = (o) => o.updated_at) => {
      if (!selectedStatusAllows(statuses)) return 0;
      return baseWithoutStatusFilter.filter((o) => {
        if (!statuses.includes(o.delivery_status || "")) return false;
        return inRangeByEvent(o, eventDate(o));
      }).length;
    };

    const countDeliveryStatusEvents = (statuses: string[]) => {
      if (!selectedStatusAllows(statuses)) return 0;

      // In Created mode this page is a cohort view: count orders created in the
      // selected period and show their current delivery status. In Updated mode
      // every delivery KPI must mean "orders whose delivery_status changed to
      // this status in the selected period", so use order_history.created_at.
      if (dateField === "created") {
        return countCurrentStatus(statuses, (o) => o.created_at);
      }

      const ids = new Set<string>();
      deliveryStatusEvents.forEach((event) => {
        const nextStatus = event.new_value || "";
        if (!statuses.includes(nextStatus)) return;
        if ((event.old_value || "") === nextStatus) return;
        const order = orderByOrderId[event.order_id];
        if (!order || !matchesNonStatusFilters(order)) return;
        if (!isWithinRange(new Date(event.created_at), dateRange)) return;
        ids.add(event.order_id);
      });

      return ids.size;
    };

    const total = base.filter((o) => inRangeByEvent(o, o.updated_at)).length;

    const confirmed = base.filter((o) =>
      (o.confirmation_status === "confirmed" || CONFIRMED_DELIVERY_STATUSES.includes(o.delivery_status || ""))
      && inRangeByEvent(o, o.confirmed_at)
    ).length;

    const booked = countDeliveryStatusEvents(["booked"]);
    const printed = countDeliveryStatusEvents(["printed"]);
    const dispatched = countDeliveryStatusEvents(["dispatched"]);
    const shipped = countDeliveryStatusEvents(ACTIVE_SHIPPING_STATUSES);
    const delivered = countCurrentStatus(DELIVERED_STATUSES, (o) => dateField === "created" ? o.created_at : o.delivered_at);
    const returned = countDeliveryStatusEvents(RETURN_RECEIVED_STATUSES);
    const failedAttempt = countDeliveryStatusEvents(["failed_attempt"]);
    const inReturnProcess = countDeliveryStatusEvents(["ready_for_return"]);

    const poolCount = countDeliveryStatusEvents(SHIPPED_POOL_STATUSES);

    return {
      total, confirmed, poolCount, booked, printed, dispatched, shipped, delivered,
      failedAttempt, returned, inReturnProcess,
      deliveryRate: pct(delivered, poolCount),
      returnRate: pct(returned, poolCount),
      failedAttemptRate: pct(failedAttempt, poolCount),
    };
  }, [orders, deliveryStatusEvents, orderByOrderId, sellerFilter, productFilter, courierFilter, deliveryStatusFilter, dateField, dateRange]);

  // The actual order rows behind the "Failed Attempt" KPI number — mirrors
  // countDeliveryStatusEvents(["failed_attempt"])'s exact logic (event-scoped
  // in Updated mode, cohort-scoped in Created mode) so the popup's total
  // always matches the KPI card's own count.
  const failedAttemptOrders = useMemo(() => {
    if (deliveryStatusFilter !== "all" && deliveryStatusFilter !== "failed_attempt") return [];
    const matchesNonStatusFilters = (o: Order) =>
      (sellerFilter === "all" || o.seller_id === sellerFilter) &&
      (productFilter === "all" || o.product_name === productFilter) &&
      (courierFilter === "all" || detectCourier(o) === courierFilter);

    if (dateField === "created") {
      return orders.filter((o) => matchesNonStatusFilters(o) && o.delivery_status === "failed_attempt" && inRangeByEvent(o, o.created_at));
    }

    const ids = new Set<string>();
    deliveryStatusEvents.forEach((event) => {
      if (event.new_value !== "failed_attempt") return;
      if ((event.old_value || "") === "failed_attempt") return;
      const order = orderByOrderId[event.order_id];
      if (!order || !matchesNonStatusFilters(order)) return;
      if (!isWithinRange(new Date(event.created_at), dateRange)) return;
      ids.add(event.order_id);
    });
    return [...ids].map((id) => orderByOrderId[id]).filter(Boolean) as Order[];
  }, [orders, deliveryStatusEvents, orderByOrderId, sellerFilter, productFilter, courierFilter, deliveryStatusFilter, dateField, dateRange]);

  const failedAttemptReasonRows = useMemo(() => {
    const map: Record<string, number> = {};
    failedAttemptOrders.forEach((o) => {
      const reason = o.shipping_status?.trim() || "No reason recorded";
      map[reason] = (map[reason] || 0) + 1;
    });
    const total = failedAttemptOrders.length;
    return Object.entries(map)
      .map(([reason, count]) => ({ reason, count, pct: pct(count, total) }))
      .sort((a, b) => b.count - a.count);
  }, [failedAttemptOrders]);

  const failedAttemptCourierRows = useMemo(() => {
    const map: Record<string, number> = {};
    failedAttemptOrders.forEach((o) => {
      const co = detectCourier(o);
      map[co] = (map[co] || 0) + 1;
    });
    return Object.entries(map).map(([courier, count]) => ({ courier, count })).sort((a, b) => b.count - a.count);
  }, [failedAttemptOrders]);

  const failedAttemptCityRows = useMemo(() => {
    const map: Record<string, number> = {};
    failedAttemptOrders.forEach((o) => {
      const city = o.customer_city?.trim() || "Unknown";
      map[city] = (map[city] || 0) + 1;
    });
    return Object.entries(map).map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [failedAttemptOrders]);

  // ── Follow-Up Effectiveness ──────────────────────────────────────────────────
  // Answers two questions: (1) is Follow Up actually working the orders that
  // currently need it (coverage), and (2) when they do act, does it actually
  // rescue the order (effectiveness — delivered vs still stuck/returned).
  const isStale = (order: Order, fu: FollowUpRow | undefined) => {
    if (!fu || fu.follow_up_status !== "re_attempted") return false;
    if (order.delivery_status === "delivered") return false;
    if (RETURN_LIKE_STATUSES.includes(order.delivery_status || "")) return false;
    return Date.now() - new Date(fu.updated_at).getTime() > STALE_REATTEMPT_MS;
  };

  const followUpStats = useMemo(() => {
    // Orders that currently need follow-up attention right now.
    const needsFollowUpPool = filteredOrders.filter((o) => o.delivery_status === "failed_attempt");
    const workedInPool = needsFollowUpPool.filter((o) => {
      const fu = followUpByOrderId[o.order_id];
      return !!fu && fu.follow_up_status !== "pending";
    });
    const untouchedInPool = needsFollowUpPool.length - workedInPool.length;

    // Every order Follow Up has ever acted on (regardless of its current
    // status — an order that got rescued and delivered no longer shows
    // delivery_status='failed_attempt', so this must NOT be scoped to the
    // pool above or "effectiveness" would always look like 0%).
    const touchedOrders = filteredOrders.filter((o) => {
      const fu = followUpByOrderId[o.order_id];
      return !!fu && fu.follow_up_status !== "pending";
    });
    const deliveredAfterTouch = touchedOrders.filter((o) => o.delivery_status === "delivered");
    const returnedAfterTouch = touchedOrders.filter((o) => RETURNED_STATUSES.includes(o.delivery_status || ""));
    const stillStuck = touchedOrders.filter((o) => o.delivery_status === "failed_attempt");

    // Rescue rate: scoped ONLY to orders actually marked re_attempted/
    // pushed_delivery — a fair "did the rescue attempt work" number, not
    // diluted by refused/area_restricted orders that were never rescuable.
    const rescueAttempts = touchedOrders.filter((o) => RESCUE_ATTEMPT_STATUSES.includes(followUpByOrderId[o.order_id]?.follow_up_status || ""));
    const rescuedDelivered = rescueAttempts.filter((o) => o.delivery_status === "delivered");

    const staleReattempts = filteredOrders.filter((o) => isStale(o, followUpByOrderId[o.order_id]));

    return {
      needsFollowUp: needsFollowUpPool.length,
      worked: workedInPool.length,
      untouched: untouchedInPool,
      coveragePct: pct(workedInPool.length, needsFollowUpPool.length),
      touched: touchedOrders.length,
      delivered: deliveredAfterTouch.length,
      returned: returnedAfterTouch.length,
      stillStuck: stillStuck.length,
      rescueAttempts: rescueAttempts.length,
      rescuedDelivered: rescuedDelivered.length,
      rescueRatePct: pct(rescuedDelivered.length, rescueAttempts.length),
      staleCount: staleReattempts.length,
    };
  }, [filteredOrders, followUpByOrderId]);

  const followUpOutcomeByStatus = useMemo(() => {
    const map: Record<string, { total: number; delivered: number }> = {};
    filteredOrders.forEach((o) => {
      const fu = followUpByOrderId[o.order_id];
      if (!fu || fu.follow_up_status === "pending") return;
      if (!map[fu.follow_up_status]) map[fu.follow_up_status] = { total: 0, delivered: 0 };
      map[fu.follow_up_status].total++;
      if (o.delivery_status === "delivered") map[fu.follow_up_status].delivered++;
    });
    return Object.entries(map)
      .map(([status, d]) => ({ status, total: d.total, delivered: d.delivered, rate: pct(d.delivered, d.total) }))
      .sort((a, b) => b.total - a.total);
  }, [filteredOrders, followUpByOrderId]);

  const followUpAgentRows = useMemo(() => {
    const map: Record<string, { handled: number; delivered: number; stale: number }> = {};
    filteredOrders.forEach((o) => {
      const fu = followUpByOrderId[o.order_id];
      if (!fu || fu.follow_up_status === "pending" || !fu.updated_by) return;
      const agentId = fu.updated_by;
      if (!map[agentId]) map[agentId] = { handled: 0, delivered: 0, stale: 0 };
      map[agentId].handled++;
      if (o.delivery_status === "delivered") map[agentId].delivered++;
      if (isStale(o, fu)) map[agentId].stale++;
    });
    return Object.entries(map)
      .map(([id, d]) => ({
        id,
        name: profileMap[id] || id.slice(0, 8),
        handled: d.handled,
        delivered: d.delivered,
        stale: d.stale,
        rate: pct(d.delivered, d.handled),
      }))
      .sort((a, b) => b.handled - a.handled);
  }, [filteredOrders, followUpByOrderId, profileMap]);

  // ── By Courier ───────────────────────────────────────────────────────────────

  const courierRows = useMemo(() => {
    const map: Record<string, { total: number; delivered: number; failed: number; returned: number }> = {};
    filteredOrders.forEach((o) => {
      if (!isInShippedDeliveryPool(o.delivery_status)) return;
      const co = detectCourier(o);
      if (!map[co]) map[co] = { total: 0, delivered: 0, failed: 0, returned: 0 };
      map[co].total++;
      if (DELIVERED_STATUSES.includes(o.delivery_status || "")) map[co].delivered++;
      if (o.delivery_status === "failed_attempt") map[co].failed++;
      if (RETURNED_STATUSES.includes(o.delivery_status || "")) map[co].returned++;
    });
    return Object.entries(map)
      .filter(([, d]) => d.total > 0)
      .map(([courier, d]) => ({
        courier,
        total: d.total,
        delivered: d.delivered,
        failed: d.failed,
        returned: d.returned,
        rate: pct(d.delivered, d.total),
      }));
  }, [filteredOrders]);

  const sortedCourierRows = useMemo(() => {
    return [...courierRows].sort((a, b) => {
      const av = a[courierSort], bv = b[courierSort];
      if (typeof av === "string" && typeof bv === "string") {
        return courierSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const diff = (av as number) - (bv as number);
      return courierSortDir === "desc" ? -diff : diff;
    });
  }, [courierRows, courierSort, courierSortDir]);

  // ── By City ──────────────────────────────────────────────────────────────────

  const cityRows = useMemo(() => {
    const map: Record<string, { total: number; delivered: number; failed: number; returned: number; inProcess: number }> = {};
    filteredOrders.forEach((o) => {
      if (!isInShippedDeliveryPool(o.delivery_status)) return;
      const city = o.customer_city?.trim() || "Unknown";
      if (!map[city]) map[city] = { total: 0, delivered: 0, failed: 0, returned: 0, inProcess: 0 };
      map[city].total++;
      if (DELIVERED_STATUSES.includes(o.delivery_status || "")) map[city].delivered++;
      if (o.delivery_status === "failed_attempt") map[city].failed++;
      if (RETURNED_STATUSES.includes(o.delivery_status || "")) map[city].returned++;
      // In Process = booked + shipped/in_transit + failed_attempt (can still be delivered)
      if (
        ACTIVE_SHIPPING_STATUSES.includes(o.delivery_status || "") ||
        o.delivery_status === "failed_attempt"
      ) map[city].inProcess++;
    });
    return Object.entries(map)
      .filter(([, d]) => d.total > 0)
      .map(([city, d]) => ({
        city,
        total: d.total,
        delivered: d.delivered,
        failed: d.failed,
        returned: d.returned,
        inProcess: d.inProcess,
        rate: pct(d.delivered, d.total),
      }));
  }, [filteredOrders]);

  const sortedCityRows = useMemo(() => {
    return [...cityRows].sort((a, b) => {
      const av = a[citySort], bv = b[citySort];
      if (typeof av === "string" && typeof bv === "string") {
        return citySortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const diff = (av as number) - (bv as number);
      return citySortDir === "desc" ? -diff : diff;
    });
  }, [cityRows, citySort, citySortDir]);

  const visibleCityRows = showAllCities ? sortedCityRows : sortedCityRows.slice(0, 15);

  // ── By Sub-Status ────────────────────────────────────────────────────────────
  // Raw carrier sub-status text (e.g. "Delivered to Customer", "Attempt Made:
  // RFD(REFUSED TO RECEIVE)") — one level more granular than delivery_status,
  // synced onto orders.shipping_status by the carrier status-sync functions.
  const subStatusRows = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOrders.forEach((o) => {
      if (!isInShippedDeliveryPool(o.delivery_status)) return;
      const status = o.shipping_status?.trim() || "No sub-status";
      map[status] = (map[status] || 0) + 1;
    });
    const total = Object.values(map).reduce((sum, n) => sum + n, 0);
    return Object.entries(map)
      .map(([status, count]) => ({ status, count, pct: pct(count, total) }))
      .sort((a, b) => b.count - a.count);
  }, [filteredOrders]);

  // ── Daily Trend ──────────────────────────────────────────────────────────────

  const trendData = useMemo(() => {
    const today = new Date();
    const days = dateRange?.from
      ? Math.min(
          Math.ceil((endOfDay(dateRange.to || dateRange.from).getTime() - startOfDay(dateRange.from).getTime()) / 86400000),
          90
        )
      : 30;

    const buckets: Record<string, { confirmed: number; delivered: number; returned: number }> = {};

    for (let i = days - 1; i >= 0; i--) {
      const d = subDays(today, i);
      const key = format(d, "MMM dd");
      buckets[key] = { confirmed: 0, delivered: 0, returned: 0 };
    }

    // Use all orders (seller/product filtered) so event-date buckets are not
    // constrained by the main date filter — each line uses its own event date.
    const trendPool = eventFilteredPool ?? filteredOrders;

    trendPool.forEach((o) => {
      // Confirmed line: use confirmed_at ?? created_at (when confirmed happened)
      const confDate = format(new Date(o.confirmed_at ?? o.created_at), "MMM dd");
      if (
        buckets[confDate] &&
        (o.confirmation_status === "confirmed" || CONFIRMED_DELIVERY_STATUSES.includes(o.delivery_status || ""))
      ) {
        buckets[confDate].confirmed++;
      }

      // Delivered line: use delivered_at ?? updated_at
      if (DELIVERED_STATUSES.includes(o.delivery_status || "")) {
        const delDate = format(new Date(o.delivered_at ?? o.updated_at), "MMM dd");
        if (buckets[delDate]) buckets[delDate].delivered++;
      }

      // Returned line: use updated_at (no returned_at field)
      // Matches both "returned" and "return"
      if (RETURNED_STATUSES.includes(o.delivery_status || "")) {
        const retDate = format(new Date(o.updated_at), "MMM dd");
        if (buckets[retDate]) buckets[retDate].returned++;
      }
    });

    return Object.entries(buckets).map(([date, d]) => ({ date, ...d }));
  }, [filteredOrders, eventFilteredPool, dateField, dateRange]);

  // ── By Product ───────────────────────────────────────────────────────────────

  const productRows = useMemo(() => {
    const map: Record<string, { shipped: number; delivered: number; failed: number }> = {};
    filteredOrders.forEach((o) => {
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { shipped: 0, delivered: 0, failed: 0 };
      if (isInShippedDeliveryPool(o.delivery_status)) map[name].shipped++;
      if (DELIVERED_STATUSES.includes(o.delivery_status || "")) map[name].delivered++;
      if (o.delivery_status === "failed_attempt") map[name].failed++;
    });
    return Object.entries(map)
      .filter(([, d]) => d.shipped > 0)
      .map(([name, d]) => ({ name, shipped: d.shipped, delivered: d.delivered, failed: d.failed, rate: pct(d.delivered, d.shipped) }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  const visibleProductRows = showAllProducts ? productRows : productRows.slice(0, 12);

  // ── Agent Performance ────────────────────────────────────────────────────────

  const agentRows = useMemo(() => {
    // Per-agent stats (phone/manual confirmations)
    const map: Record<string, { shipped: number; delivered: number; failed: number }> = {};
    // WhatsApp synthetic agent
    const wa = { shipped: 0, delivered: 0, failed: 0 };

    filteredOrders.forEach((o) => {
      const isWa = o.confirmation_channel === "whatsapp";
      const isShipped = isInShippedDeliveryPool(o.delivery_status);
      const isDelivered = isDeliveredStatus(o.delivery_status);
      const isFailed = o.delivery_status === "failed_attempt";

      if (isWa) {
        // WhatsApp row: count all WA-confirmed orders regardless of agent
        if (isShipped) wa.shipped++;
        if (isDelivered) wa.delivered++;
        if (isFailed) wa.failed++;
      } else {
        const agentId = o.agent_id || o.original_agent_id;
        if (!agentId) return;
        if (!map[agentId]) map[agentId] = { shipped: 0, delivered: 0, failed: 0 };
        if (isShipped) map[agentId].shipped++;
        if (isDelivered) map[agentId].delivered++;
        if (isFailed) map[agentId].failed++;
      }
    });

    const rows = Object.entries(map)
      .filter(([, d]) => d.shipped > 0)
      .map(([id, d]) => ({
        id,
        name: profileMap[id] || id.slice(0, 8),
        shipped: d.shipped,
        delivered: d.delivered,
        failed: d.failed,
        rate: pct(d.delivered, d.shipped),
        isWhatsApp: false,
      }));

    // Add WhatsApp as a standalone row if it has any data
    if (wa.shipped > 0) {
      rows.push({
        id: "__whatsapp__",
        name: "WhatsApp",
        shipped: wa.shipped,
        delivered: wa.delivered,
        failed: wa.failed,
        rate: pct(wa.delivered, wa.shipped),
        isWhatsApp: true,
      });
    }

    return rows;
  }, [filteredOrders, profileMap]);

  const sortedAgentRows = useMemo(() => {
    return [...agentRows].sort((a, b) => {
      const av = a[agentSort], bv = b[agentSort];
      if (typeof av === "string" && typeof bv === "string") {
        return agentSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const diff = (av as number) - (bv as number);
      return agentSortDir === "desc" ? -diff : diff;
    });
  }, [agentRows, agentSort, agentSortDir]);

  // ── Sort toggle helpers ──────────────────────────────────────────────────────

  function toggleCourierSort(field: CourierSortField) {
    if (courierSort === field) setCourierSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setCourierSort(field); setCourierSortDir("desc"); }
  }

  function toggleCitySort(field: CitySortField) {
    if (citySort === field) setCitySortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setCitySort(field); setCitySortDir("desc"); }
  }

  function toggleAgentSort(field: AgentSortField) {
    if (agentSort === field) setAgentSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setAgentSort(field); setAgentSortDir("desc"); }
  }

  const hasFilters = sellerFilter !== "all" || productFilter !== "all" || courierFilter !== "all" || deliveryStatusFilter !== "all" || !!dateRange;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 w-full max-w-none">
      {/* Page Header */}
      <div className="relative animate-fade-in">
        <div className="pointer-events-none absolute -top-8 -left-4 w-56 h-56 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-600/10 blur-3xl" />
        <div className="relative flex items-center gap-3.5">
          <div className="relative p-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-[0_8px_24px_-8px_rgba(99,102,241,0.5)] ring-1 ring-inset ring-white/20">
            <Truck className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Delivery Analytics
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">Shipping & delivery performance insights</p>
          </div>
        </div>
      </div>

      {/* ── Sticky Filter Bar ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 backdrop-blur-xl bg-background/75 border border-border/50 rounded-2xl p-3 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.15)] animate-fade-in">
        <div className="flex flex-wrap gap-2 items-center">
          <DatePresetFilter
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            preset={datePreset}
            onPresetChange={setDatePreset}
          />
          <SearchableSelect
            value={sellerFilter}
            onValueChange={(v) => { setSellerFilter(v); setProductFilter("all"); }}
            options={sellerOptions}
            placeholder="Seller"
            allLabel="All Sellers"
            className="w-[150px]"
          />
          <SearchableSelect
            value={productFilter}
            onValueChange={setProductFilter}
            options={productOptions}
            placeholder="Product"
            allLabel="All Products"
            className="w-[150px]"
          />
          <SearchableSelect
            value={courierFilter}
            onValueChange={setCourierFilter}
            options={courierOptions}
            placeholder="Courier"
            allLabel="All Couriers"
            className="w-[150px]"
          />
          <SearchableSelect
            value={deliveryStatusFilter}
            onValueChange={setDeliveryStatusFilter}
            options={DELIVERY_STATUS_OPTIONS}
            placeholder="Delivery Status"
            allLabel="All Delivery Statuses"
            className="w-[170px]"
          />

          {/* Date field toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
            {(["created", "updated"] as DateField[]).map((f) => (
              <button
                key={f}
                onClick={() => setDateField(f)}
                className={cn(
                  "px-3 py-1.5 transition-colors capitalize",
                  dateField === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted"
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSellerFilter("all");
                setProductFilter("all");
                setCourierFilter("all");
                setDeliveryStatusFilter("all");
                setDatePreset("maximum");
                setDateRange(undefined);
              }}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Clear all
            </Button>
          )}

          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{filteredOrders.length.toLocaleString()}</span>
            orders
          </div>
        </div>
      </div>

      {isLoading ? (
        <SkeletonBlock />
      ) : (
        <>
          {/* ── Section 1: Main KPI Cards ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPICard
              title="Total Orders"
              value={kpis.total}
              icon={Package}
              colorBg="bg-indigo-100 dark:bg-indigo-900/30"
              colorIcon="text-indigo-600 dark:text-indigo-300"
              gradient="from-indigo-500 to-violet-500"
              delay={0}
            />
            <KPICard
              title="Confirmed"
              value={kpis.confirmed}
              icon={CheckCircle2}
              colorBg="bg-emerald-100 dark:bg-emerald-900/30"
              colorIcon="text-emerald-600 dark:text-emerald-300"
              gradient="from-emerald-500 to-green-400"
              delay={50}
              pool={kpis.total}
            />
            <KPICard
              title="Booked"
              value={kpis.booked}
              icon={PackageCheck}
              colorBg="bg-violet-100 dark:bg-violet-900/30"
              colorIcon="text-violet-600 dark:text-violet-300"
              gradient="from-violet-500 to-purple-400"
              delay={100}
              pool={kpis.poolCount}
            />
            <KPICard
              title="Printed"
              value={kpis.printed}
              icon={Printer}
              colorBg="bg-indigo-100 dark:bg-indigo-900/30"
              colorIcon="text-indigo-600 dark:text-indigo-300"
              gradient="from-indigo-500 to-blue-400"
              delay={125}
              pool={kpis.poolCount}
            />
            <KPICard
              title="Dispatched"
              value={kpis.dispatched}
              icon={Send}
              colorBg="bg-cyan-100 dark:bg-cyan-900/30"
              colorIcon="text-cyan-600 dark:text-cyan-300"
              gradient="from-cyan-500 to-teal-400"
              delay={140}
              pool={kpis.poolCount}
            />
            <KPICard
              title="Shipped / In Transit"
              value={kpis.shipped}
              icon={Navigation}
              colorBg="bg-blue-100 dark:bg-blue-900/30"
              colorIcon="text-blue-600 dark:text-blue-300"
              gradient="from-blue-500 to-cyan-400"
              delay={150}
              pool={kpis.poolCount}
            />
            <KPICard
              title="Delivered"
              value={kpis.delivered}
              subtitle="status delivered"
              icon={CheckCircle2}
              colorBg="bg-green-100 dark:bg-green-900/30"
              colorIcon="text-green-600 dark:text-green-300"
              gradient="from-green-500 to-emerald-400"
              delay={200}
              pool={kpis.poolCount}
            />
            <KPICard
              title="Failed Attempt"
              value={kpis.failedAttempt}
              icon={AlertTriangle}
              colorBg="bg-amber-100 dark:bg-amber-900/30"
              colorIcon="text-amber-600 dark:text-amber-300"
              gradient="from-amber-500 to-yellow-400"
              delay={250}
              pool={kpis.poolCount}
              onClick={() => setShowFailedAttemptDetail(true)}
            />
            <KPICard
              title="Returned"
              value={kpis.returned}
              subtitle="return received"
              icon={RotateCcw}
              colorBg="bg-red-100 dark:bg-red-900/30"
              colorIcon="text-red-600 dark:text-red-300"
              gradient="from-red-500 to-rose-400"
              delay={300}
              pool={kpis.poolCount}
            />
            <KPICard
              title="In Return Process"
              value={kpis.inReturnProcess}
              icon={PackageX}
              colorBg="bg-orange-100 dark:bg-orange-900/30"
              colorIcon="text-orange-600 dark:text-orange-300"
              gradient="from-orange-500 to-amber-400"
              delay={350}
              pool={kpis.poolCount}
            />
          </div>

          {/* ── Section 2: Rate KPI Cards ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
            {[
              {
                label: "Delivery Rate",
                value: kpis.deliveryRate,
                sub: `${kpis.delivered.toLocaleString()} delivered / ${kpis.poolCount.toLocaleString()} shipped`,
                icon: TrendingUp,
              },
              {
                label: "Return Rate",
                value: kpis.returnRate,
                sub: `${kpis.returned.toLocaleString()} returned / ${kpis.poolCount.toLocaleString()} in pool`,
                icon: RotateCcw,
              },
              {
                label: "Failed Attempt Rate",
                value: kpis.failedAttemptRate,
                sub: `${kpis.failedAttempt.toLocaleString()} failed / ${kpis.poolCount.toLocaleString()} in pool`,
                icon: AlertTriangle,
              },
            ].map(({ label, value, sub, icon: Icon }, i) => (
              <div
                key={label}
                className="group relative overflow-hidden rounded-2xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-24px_rgba(0,0,0,0.2)] p-5 animate-slide-up transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_22px_44px_-20px_rgba(0,0,0,0.24)]"
                style={{ animationDelay: `${400 + i * 60}ms` }}
              >
                <div className={cn("pointer-events-none absolute -top-3 inset-x-8 h-6 rounded-full bg-gradient-to-r blur-lg opacity-25", rateGradient(value))} />
                <div className={cn("absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r", rateGradient(value))} />
                <div className="relative flex items-start justify-between mb-4">
                  <div className="p-2.5 rounded-xl bg-muted/70 ring-1 ring-inset ring-black/5 dark:ring-white/10">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Badge className={cn("text-[11px] font-bold border-0 tracking-wide", rateBadgeClass(value))}>
                    {rateLabel(value)}
                  </Badge>
                </div>
                <div className="relative text-[42px] leading-none font-bold tracking-tight tabular-nums" style={{ color: rateColor(value) }}>
                  {fmtPct(value)}
                </div>
                <p className="relative text-sm font-semibold text-foreground mt-2">{label}</p>
                <p className="relative text-xs text-muted-foreground mt-0.5">{sub}</p>
                <div className="relative mt-4 h-2 bg-muted/70 rounded-full overflow-hidden shadow-inner">
                  <div
                    className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", rateGradient(value))}
                    style={{ width: `${Math.min(value, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ── Section 2b: Follow-Up Effectiveness ───────────────────────────── */}
          <div
            className="rounded-2xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-24px_rgba(0,0,0,0.2)] p-5 animate-slide-up"
            style={{ animationDelay: "120ms" }}
          >
            <SectionHeader
              icon={Activity}
              title="Follow-Up Effectiveness"
              subtitle="Is the Follow Up team actually working failed deliveries, and does it help?"
              iconBg="bg-fuchsia-100 dark:bg-fuchsia-900/30"
              iconColor="text-fuchsia-600 dark:text-fuchsia-300"
            />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="rounded-xl border border-border/60 p-3.5">
                <div className="text-2xl font-bold tabular-nums">{followUpStats.needsFollowUp.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-0.5">Needs Follow-Up now</p>
                <p className="text-[11px] text-muted-foreground">currently Failed Attempt</p>
              </div>
              <div className="rounded-xl border border-border/60 p-3.5">
                <div className="text-2xl font-bold tabular-nums" style={{ color: rateColor(followUpStats.coveragePct) }}>
                  {fmtPct(followUpStats.coveragePct)}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Coverage</p>
                <p className="text-[11px] text-muted-foreground">{followUpStats.worked.toLocaleString()} worked / {followUpStats.untouched.toLocaleString()} untouched</p>
              </div>
              <div className="rounded-xl border border-border/60 p-3.5">
                <div className="text-2xl font-bold tabular-nums" style={{ color: rateColor(followUpStats.rescueRatePct) }}>
                  {fmtPct(followUpStats.rescueRatePct)}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Rescue Rate</p>
                <p className="text-[11px] text-muted-foreground">{followUpStats.rescuedDelivered.toLocaleString()} delivered / {followUpStats.rescueAttempts.toLocaleString()} re-attempted or pushed</p>
              </div>
              <div className={cn("rounded-xl border p-3.5", followUpStats.staleCount > 0 ? "border-red-300/60 bg-red-50/50 dark:bg-red-900/10 dark:border-red-900/40" : "border-border/60")}>
                <div className={cn("text-2xl font-bold tabular-nums", followUpStats.staleCount > 0 && "text-red-600 dark:text-red-400")}>
                  {followUpStats.staleCount.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Stale Re-Attempts</p>
                <p className="text-[11px] text-muted-foreground">re-attempted &gt;24h, still stuck</p>
              </div>
            </div>

            {followUpAgentRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-xs text-muted-foreground">
                      <th className="text-left py-2.5 pr-4 font-semibold">Follow-Up Agent</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Handled</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Delivered</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Stale</th>
                      <th className="text-right py-2.5 pl-3 font-semibold min-w-[160px]">Rescue Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {followUpAgentRows.map((row) => (
                      <tr key={row.id} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                        <td className="py-3 pr-4 font-medium">{row.name}</td>
                        <td className="py-3 px-3 text-right tabular-nums">{row.handled.toLocaleString()}</td>
                        <td className="py-3 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">{row.delivered.toLocaleString()}</td>
                        <td className={cn("py-3 px-3 text-right tabular-nums font-medium", row.stale > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                          {row.stale.toLocaleString()}
                        </td>
                        <td className="py-3 pl-3">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(row.rate, 100)}%`, backgroundColor: rateColor(row.rate) }} />
                            </div>
                            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", rateBadgeClass(row.rate))}>
                              {fmtPct(row.rate)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {followUpAgentRows.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No follow-up activity for the selected filters.</p>
            )}

            {followUpOutcomeByStatus.length > 0 && (
              <div className="mt-5 pt-5 border-t border-border/60">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Outcome by Follow-Up Status
                </h3>
                <p className="text-[11px] text-muted-foreground mb-3">
                  "Refused"/"Area Restricted" are correct triage calls, not failed rescues — their low delivered % is expected, not a sign of poor follow-up work.
                </p>
                <div className="space-y-1.5">
                  {followUpOutcomeByStatus.map((row) => (
                    <div key={row.status} className="flex items-center gap-3">
                      <span className="text-xs font-medium w-32 shrink-0 capitalize">{row.status.replace(/_/g, " ")}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(row.rate, 100)}%`, backgroundColor: rateColor(row.rate) }} />
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-muted-foreground w-28 text-right shrink-0">
                        {row.delivered.toLocaleString()} / {row.total.toLocaleString()} ({fmtPct(row.rate)})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Section 3: Delivery by Agent ─────────────────────────────────── */}
          {sortedAgentRows.length > 0 && (
            <div
              className="rounded-2xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-24px_rgba(0,0,0,0.2)] p-5 animate-slide-up"
              style={{ animationDelay: "140ms" }}
            >
              <SectionHeader
                icon={Users}
                title="Delivery by Agent"
                subtitle="Shipped, delivered & failed per agent — WhatsApp included as a source"
                iconBg="bg-indigo-100 dark:bg-indigo-900/30"
                iconColor="text-indigo-600 dark:text-indigo-300"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-xs text-muted-foreground">
                      <th className="text-left py-2.5 pr-3 w-10 font-semibold">#</th>
                      {(
                        [
                          { key: "name",      label: "Agent / Source", align: "left"  },
                          { key: "shipped",   label: "Shipped",        align: "right" },
                          { key: "delivered", label: "Delivered",      align: "right" },
                          { key: "failed",    label: "Failed Attempt", align: "right" },
                          { key: "rate",      label: "Delivery Rate",  align: "right" },
                        ] as { key: AgentSortField; label: string; align: string }[]
                      ).map(({ key, label, align }) => (
                        <th
                          key={key}
                          className={cn(
                            "py-2.5 font-semibold cursor-pointer hover:text-foreground select-none",
                            align === "left" ? "text-left pr-4" : "text-right px-3",
                            key === "rate" && "min-w-[160px]"
                          )}
                          onClick={() => toggleAgentSort(key)}
                        >
                          {label} <SortIcon field={key} active={agentSort} dir={agentSortDir} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAgentRows.map((row, i) => {
                      const isWa = row.isWhatsApp;
                      const agentRank = sortedAgentRows.filter((r) => !r.isWhatsApp).indexOf(row) + 1;
                      const rankBadge =
                        agentRank === 1
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-700"
                          : agentRank === 2
                          ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                          : agentRank === 3
                          ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border border-orange-200 dark:border-orange-700"
                          : "bg-muted text-muted-foreground";
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            "border-b border-border/40 last:border-0 transition-colors",
                            isWa
                              ? "bg-emerald-50/60 dark:bg-emerald-900/10 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                              : "hover:bg-muted/40"
                          )}
                        >
                          <td className="py-3 pr-3">
                            {isWa ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300">
                                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                                  <path d="M12 0C5.374 0 0 5.373 0 12c0 2.117.554 4.127 1.529 5.875L.057 23.97l6.256-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.8 9.8 0 01-5.028-1.378l-.36-.214-3.718.972.995-3.622-.234-.373A9.817 9.817 0 012.182 12C2.182 6.573 6.573 2.182 12 2.182S21.818 6.573 21.818 12 17.427 21.818 12 21.818z"/>
                                </svg>
                              </span>
                            ) : (
                              <span
                                className={cn(
                                  "inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold",
                                  rankBadge
                                )}
                              >
                                {agentRank <= 3 ? <Award className="h-3 w-3" /> : agentRank}
                              </span>
                            )}
                          </td>
                          <td className="py-3 pr-4">
                            {isWa ? (
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-emerald-700 dark:text-emerald-300">WhatsApp</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 font-medium">Auto</span>
                              </div>
                            ) : (
                              <span className="font-medium">{row.name}</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums font-medium">
                            {row.shipped.toLocaleString()}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                            {row.delivered.toLocaleString()}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">
                            {row.failed.toLocaleString()}
                          </td>
                          <td className="py-3 pl-3">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-14 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${Math.min(row.rate, 100)}%`, backgroundColor: rateColor(row.rate) }}
                                />
                              </div>
                              <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full min-w-[46px] text-center", rateBadgeClass(row.rate))}>
                                {fmtPct(row.rate)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Section 4: Delivery Rate by Courier ───────────────────────────── */}
          {sortedCourierRows.length > 0 && (
            <div
              className="rounded-2xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-24px_rgba(0,0,0,0.2)] p-5 animate-slide-up overflow-hidden"
              style={{ animationDelay: "180ms" }}
            >
              <SectionHeader
                icon={Truck}
                title="Delivery Rate by Courier"
                subtitle="Performance breakdown per shipping company"
                iconBg="bg-blue-100 dark:bg-blue-900/30"
                iconColor="text-blue-600 dark:text-blue-300"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-xs text-muted-foreground">
                      <th
                        className="text-left py-2.5 pr-4 font-semibold cursor-pointer hover:text-foreground select-none"
                        onClick={() => toggleCourierSort("courier")}
                      >
                        Courier <SortIcon field="courier" active={courierSort} dir={courierSortDir} />
                      </th>
                      <th
                        className="text-right py-2.5 px-4 font-semibold cursor-pointer hover:text-foreground select-none"
                        onClick={() => toggleCourierSort("total")}
                      >
                        Total <SortIcon field="total" active={courierSort} dir={courierSortDir} />
                      </th>
                      <th
                        className="text-right py-2.5 px-4 font-semibold cursor-pointer hover:text-foreground select-none"
                        onClick={() => toggleCourierSort("delivered")}
                      >
                        Delivered <SortIcon field="delivered" active={courierSort} dir={courierSortDir} />
                      </th>
                      <th
                        className="text-right py-2.5 px-4 font-semibold cursor-pointer hover:text-foreground select-none"
                        onClick={() => toggleCourierSort("failed")}
                      >
                        Failed <SortIcon field="failed" active={courierSort} dir={courierSortDir} />
                      </th>
                      <th
                        className="text-right py-2.5 pl-4 font-semibold cursor-pointer hover:text-foreground select-none"
                        onClick={() => toggleCourierSort("returned")}
                      >
                        Returned <SortIcon field="returned" active={courierSort} dir={courierSortDir} />
                      </th>
                      <th
                        className="text-right py-2.5 pl-4 font-semibold cursor-pointer hover:text-foreground select-none min-w-[180px]"
                        onClick={() => toggleCourierSort("rate")}
                      >
                        Delivery Rate <SortIcon field="rate" active={courierSort} dir={courierSortDir} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCourierRows.map((row) => {
                      const cc = courierColor(row.courier);
                      return (
                        <tr
                          key={row.courier}
                          className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors"
                        >
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0",
                                  cc.bg, cc.text
                                )}
                              >
                                {row.courier.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-medium">{row.courier}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums font-medium">
                            {row.total.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                            {row.delivered.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums text-amber-600 dark:text-amber-400 font-medium">
                            {row.failed.toLocaleString()}
                          </td>
                          <td className="py-3 pl-4 text-right tabular-nums text-red-600 dark:text-red-400 font-medium">
                            {row.returned.toLocaleString()}
                          </td>
                          <td className="py-3 pl-4">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${Math.min(row.rate, 100)}%`, backgroundColor: rateColor(row.rate) }}
                                />
                              </div>
                              <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", rateBadgeClass(row.rate))}>
                                {fmtPct(row.rate)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {sortedCourierRows.length === 0 && (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  No courier data available for the selected filters.
                </div>
              )}
            </div>
          )}

          {/* ── Section 4: Delivery Rate by City ──────────────────────────────── */}
          {sortedCityRows.length > 0 && (
            <div
              className="rounded-2xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-24px_rgba(0,0,0,0.2)] p-5 animate-slide-up"
              style={{ animationDelay: "220ms" }}
            >
              <SectionHeader
                icon={MapPin}
                title="Delivery Rate by City"
                subtitle="Top cities by delivery performance"
                iconBg="bg-violet-100 dark:bg-violet-900/30"
                iconColor="text-violet-600 dark:text-violet-300"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-xs text-muted-foreground">
                      {(
                        [
                          { key: "city", label: "City", align: "left" },
                          { key: "total", label: "Total", align: "right" },
                          { key: "delivered", label: "Delivered", align: "right" },
                          { key: "failed", label: "Failed", align: "right" },
                          { key: "returned", label: "Returned", align: "right" },
                          { key: "inProcess", label: "In Process", align: "right" },
                          { key: "rate", label: "Delivery Rate", align: "right" },
                        ] as { key: CitySortField; label: string; align: string }[]
                      ).map(({ key, label, align }) => (
                        <th
                          key={key}
                          className={cn(
                            "py-2.5 font-semibold cursor-pointer hover:text-foreground select-none",
                            align === "left" ? "text-left pr-4" : "text-right px-3",
                            key === "rate" && "min-w-[160px]"
                          )}
                          onClick={() => toggleCitySort(key)}
                        >
                          {label} <SortIcon field={key} active={citySort} dir={citySortDir} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCityRows.map((row, i) => (
                      <tr
                        key={row.city}
                        className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors"
                      >
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-muted text-[10px] font-bold flex items-center justify-center text-muted-foreground">
                              {i + 1}
                            </span>
                            <span className="font-medium">{row.city}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-medium">{row.total.toLocaleString()}</td>
                        <td className="py-3 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                          {row.delivered.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400 font-medium">
                          {row.failed.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-red-600 dark:text-red-400 font-medium">
                          {row.returned.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-sky-600 dark:text-sky-400 font-medium">
                          {row.inProcess.toLocaleString()}
                        </td>
                        <td className="py-3 pl-3">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${Math.min(row.rate, 100)}%`, backgroundColor: rateColor(row.rate) }}
                              />
                            </div>
                            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", rateBadgeClass(row.rate))}>
                              {fmtPct(row.rate)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {sortedCityRows.length > 15 && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => setShowAllCities(!showAllCities)}
                  >
                    {showAllCities ? (
                      <><ChevronUp className="h-3.5 w-3.5" /> Show Less</>
                    ) : (
                      <><ArrowRight className="h-3.5 w-3.5" /> Show All {sortedCityRows.length} Cities</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Section 4b: Delivery Sub-Status Breakdown ─────────────────────── */}
          {subStatusRows.length > 0 && (
            <div
              className="rounded-2xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-24px_rgba(0,0,0,0.2)] p-5 animate-slide-up"
              style={{ animationDelay: "240ms" }}
            >
              <SectionHeader
                icon={Layers}
                title="Delivery Sub-Status Breakdown"
                subtitle="Raw carrier status per shipment (e.g. PostEx/M&P sub-statuses) — one level more detailed than the delivery stage above"
                iconBg="bg-teal-100 dark:bg-teal-900/30"
                iconColor="text-teal-600 dark:text-teal-300"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-xs text-muted-foreground">
                      <th className="text-left py-2.5 pr-4 font-semibold">Sub-Status</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Orders</th>
                      <th className="text-right py-2.5 pl-3 font-semibold min-w-[160px]">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subStatusRows.map((row) => {
                      const tone = subStatusTone(row.status);
                      return (
                        <tr key={row.status} className="border-b border-border/40 last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="py-3 pr-4">
                            <span className={cn("inline-flex items-center gap-2 text-xs font-medium px-2 py-1 rounded-full", tone.bg, tone.text)}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tone.dot }} />
                              {row.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums font-medium">{row.count.toLocaleString()}</td>
                          <td className="py-3 pl-3">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(row.pct, 100)}%`, backgroundColor: tone.dot }} />
                              </div>
                              <span className="text-xs font-semibold text-muted-foreground min-w-[42px] text-right">{fmtPct(row.pct)}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Section 5: Daily Trend Chart ───────────────────────────────────── */}
          {trendData.length > 0 && (
            <div
              className="rounded-2xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-24px_rgba(0,0,0,0.2)] p-5 animate-slide-up"
              style={{ animationDelay: "260ms" }}
            >
              <SectionHeader
                icon={TrendingUp}
                title="Daily Delivery Trend"
                subtitle="Confirmed, delivered, and returned orders over time"
                iconBg="bg-emerald-100 dark:bg-emerald-900/30"
                iconColor="text-emerald-600 dark:text-emerald-300"
              />
              <div className="flex gap-4 mb-4 text-xs">
                {[
                  { label: "Confirmed", color: "#6366f1" },
                  { label: "Delivered", color: "#10b981" },
                  { label: "Returned", color: "#ef4444" },
                ].map(({ label, color }) => (
                  <div key={label} className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50">
                    <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: color }} />
                    <span className="text-muted-foreground font-medium">{label}</span>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 6" stroke="hsl(var(--border))" strokeOpacity={0.6} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "14px",
                      border: "1px solid hsl(var(--border) / 0.6)",
                      fontSize: "12px",
                      fontWeight: 500,
                      background: "hsl(var(--card))",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08), 0 16px 40px -16px rgba(0,0,0,0.25)",
                      padding: "10px 14px",
                    }}
                    cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1, strokeDasharray: "3 3" }}
                  />
                  <Line type="monotone" dataKey="confirmed" stroke="#6366f1" strokeWidth={2.5} strokeLinecap="round" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} name="Confirmed" />
                  <Line type="monotone" dataKey="delivered" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} name="Delivered" />
                  <Line type="monotone" dataKey="returned" stroke="#ef4444" strokeWidth={2.5} strokeLinecap="round" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} name="Returned" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Section 6: Delivery Rate by Product ───────────────────────────── */}
          {productRows.length > 0 && (
            <div
              className="rounded-2xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-24px_rgba(0,0,0,0.2)] p-5 animate-slide-up"
              style={{ animationDelay: "300ms" }}
            >
              <SectionHeader
                icon={BarChart2}
                title="Delivery Rate by Product"
                subtitle={`${productRows.length} product${productRows.length !== 1 ? "s" : ""} · sorted by delivery rate`}
                iconBg="bg-amber-100 dark:bg-amber-900/30"
                iconColor="text-amber-600 dark:text-amber-300"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-xs text-muted-foreground">
                      <th className="text-left py-2.5 w-8 font-semibold">#</th>
                      <th className="text-left py-2.5 pr-4 font-semibold">Product</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Shipped</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Delivered</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Failed</th>
                      <th className="text-right py-2.5 pl-3 font-semibold min-w-[180px]">Delivery Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProductRows.map((row, i) => (
                      <tr
                        key={row.name}
                        className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors group"
                      >
                        <td className="py-2.5 text-xs text-muted-foreground font-medium w-8">{i + 1}</td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: rateColor(row.rate) }}
                            />
                            <span className="font-medium text-sm leading-tight">{row.name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                          {row.shipped.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                          {row.delivered.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">
                          {row.failed.toLocaleString()}
                        </td>
                        <td className="py-2.5 pl-3">
                          <div className="flex items-center justify-end gap-2">
                            <div className="flex-1 max-w-[100px] h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${Math.min(row.rate, 100)}%`, backgroundColor: rateColor(row.rate) }}
                              />
                            </div>
                            <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full min-w-[46px] text-center", rateBadgeClass(row.rate))}>
                              {fmtPct(row.rate)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {productRows.length > 12 && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => setShowAllProducts((v) => !v)}
                  >
                    {showAllProducts ? (
                      <><ChevronUp className="h-3.5 w-3.5" /> Show Less</>
                    ) : (
                      <><ArrowRight className="h-3.5 w-3.5" /> Show All {productRows.length} Products</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}


          {/* Empty state */}
          {filteredOrders.length === 0 && (
            <div className="rounded-2xl bg-card border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_40px_-24px_rgba(0,0,0,0.2)] p-16 text-center animate-fade-in">
              <div className="w-12 h-12 rounded-2xl bg-muted mx-auto flex items-center justify-center mb-4">
                <Package className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">No orders match the selected filters.</p>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting the date range or filters above.</p>
            </div>
          )}
        </>
      )}

      {/* ── Failed Attempt detail popup ─────────────────────────────────────── */}
      <Dialog open={showFailedAttemptDetail} onOpenChange={setShowFailedAttemptDetail}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Failed Attempt — {failedAttemptOrders.length.toLocaleString()} order{failedAttemptOrders.length === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Reasons */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">By Reason</h3>
              {failedAttemptReasonRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data for the selected filters.</p>
              ) : (
                <div className="space-y-1.5">
                  {failedAttemptReasonRows.map((row) => {
                    const tone = subStatusTone(row.reason);
                    return (
                      <div key={row.reason} className="flex items-center gap-3">
                        <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full shrink-0", tone.bg, tone.text)}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tone.dot }} />
                          {row.reason}
                        </span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(row.pct, 100)}%`, backgroundColor: tone.dot }} />
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground w-16 text-right shrink-0">
                          {row.count.toLocaleString()} ({fmtPct(row.pct)})
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* By courier */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">By Courier</h3>
              {failedAttemptCourierRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data for the selected filters.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {failedAttemptCourierRows.map((row) => {
                    const cc = courierColor(row.courier);
                    return (
                      <div key={row.courier} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0", cc.bg, cc.text)}>
                            {row.courier.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium truncate">{row.courier}</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums shrink-0">{row.count.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Top cities */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top Cities</h3>
              {failedAttemptCityRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data for the selected filters.</p>
              ) : (
                <div className="space-y-1">
                  {failedAttemptCityRows.map((row, i) => (
                    <div key={row.city} className="flex items-center justify-between text-sm py-1">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-muted text-[10px] font-bold flex items-center justify-center text-muted-foreground">{i + 1}</span>
                        <span className="font-medium">{row.city}</span>
                      </div>
                      <span className="tabular-nums font-semibold">{row.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
