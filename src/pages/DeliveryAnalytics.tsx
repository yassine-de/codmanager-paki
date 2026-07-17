import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Truck, Package, CheckCircle2, XCircle, AlertTriangle, RotateCcw,
  MapPin, Users, Award, TrendingUp, BarChart2, ChevronUp, ChevronDown,
  ChevronsUpDown, Loader2, ArrowRight, PackageX, PackageCheck, Navigation,
  Printer, Send,
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

type SortDir = "asc" | "desc";
type DateField = "created" | "updated";

type CourierSortField = "courier" | "total" | "delivered" | "failed" | "returned" | "rate";
type CitySortField = "city" | "total" | "delivered" | "failed" | "returned" | "inProcess" | "rate";
type AgentSortField = "name" | "confirmed" | "delivered" | "failed" | "rate";

// ─── Constants ────────────────────────────────────────────────────────────────

const ORDER_SELECT =
  "id, order_id, confirmation_status, confirmation_channel, delivery_status, product_name, seller_id, agent_id, original_agent_id, customer_city, created_at, confirmed_at, delivered_at, updated_at, shipping_status, shipments(tracking_number, carriers(name))";
const PAGE_SIZE = 1000;

const CONFIRMED_DELIVERY_STATUSES = [
  "booked", "printed", "dispatched", "shipped", "in_transit", "with_courier", "out_for_delivery",
  "delivered", "paid", "failed_attempt", "returned", "return", "ready_for_return", "return_received",
];
const DELIVERED_STATUSES = ["delivered", "paid"];
const SHIPPED_STATUSES = ["shipped", "in_transit", "with_courier", "out_for_delivery"];
const RETURNED_STATUSES = ["returned", "return", "return_received"];

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
}

function KPICard({ title, value, subtitle, icon: Icon, colorBg, colorIcon, gradient, delay = 0, pool }: KPICardProps) {
  const numVal = typeof value === "number" ? value : 0;
  const poolPct = pool && pool > 0 ? pct(numVal, pool) : null;

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-card border border-border/60 shadow-sm hover:shadow-md transition-all duration-300 animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={cn("h-1 w-full bg-gradient-to-r", gradient)} />
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className={cn("p-2 rounded-xl", colorBg)}>
            <Icon className={cn("h-4 w-4", colorIcon)} />
          </div>
          {poolPct !== null && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
              {fmtPct(poolPct)}
            </span>
          )}
        </div>
        <div className="space-y-0.5">
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {typeof value === "number" ? value.toLocaleString() : value}
          </div>
          <p className="text-xs text-muted-foreground font-medium">{title}</p>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          {poolPct !== null && (
            <div className="h-1 bg-muted rounded-full overflow-hidden mt-2">
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
      <div className={cn("p-2 rounded-xl", iconBg)}>
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
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

  // ── Data Queries ─────────────────────────────────────────────────────────────

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["delivery-analytics-orders-v4"],
    queryFn: fetchAllOrders,
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

  // ── Filtered orders ──────────────────────────────────────────────────────────

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (sellerFilter !== "all" && o.seller_id !== sellerFilter) return false;
      if (productFilter !== "all" && o.product_name !== productFilter) return false;
      if (deliveryStatusFilter !== "all" && o.delivery_status !== deliveryStatusFilter) return false;
      const dt = dateField === "created" ? o.created_at : o.updated_at;
      if (!isWithinRange(new Date(dt), dateRange)) return false;
      return true;
    });
  }, [orders, sellerFilter, productFilter, deliveryStatusFilter, dateField, dateRange]);

  // ── KPI Calculations ─────────────────────────────────────────────────────────

  // When a date range is active, confirmed/delivered/returned use their own event
  // dates so we count "confirmed today", "delivered today", "returned today"
  // accurately — not just orders *created* today that happen to have that status.
  const eventFilteredPool = useMemo(() => {
    if (!dateRange?.from) return null;
    return orders.filter((o) => {
      if (sellerFilter !== "all" && o.seller_id !== sellerFilter) return false;
      if (productFilter !== "all" && o.product_name !== productFilter) return false;
      if (deliveryStatusFilter !== "all" && o.delivery_status !== deliveryStatusFilter) return false;
      return true;
    });
  }, [orders, sellerFilter, productFilter, deliveryStatusFilter, dateRange]);

  const kpis = useMemo(() => {
    const total = filteredOrders.length;

    const pool = eventFilteredPool ?? filteredOrders;

    // Confirmed: use confirmed_at if set, otherwise updated_at
    const confirmed = pool.filter((o) => {
      const isConf =
        o.confirmation_status === "confirmed" ||
        CONFIRMED_DELIVERY_STATUSES.includes(o.delivery_status || "");
      if (!isConf) return false;
      if (!dateRange?.from) return true;
      return isWithinRange(new Date(o.confirmed_at ?? o.updated_at), dateRange);
    }).length;

    const deliveryPool = filteredOrders.filter((o) =>
      CONFIRMED_DELIVERY_STATUSES.includes(o.delivery_status || "")
    );
    const poolCount = deliveryPool.length;
    const booked  = filteredOrders.filter((o) => o.delivery_status === "booked").length;
    const printed = filteredOrders.filter((o) => o.delivery_status === "printed").length;
    const dispatched = filteredOrders.filter((o) => o.delivery_status === "dispatched").length;
    const shipped = filteredOrders.filter((o) => SHIPPED_STATUSES.includes(o.delivery_status || "")).length;

    // Delivered: use delivered_at if set, otherwise updated_at
    const delivered = pool.filter((o) => {
      if (!DELIVERED_STATUSES.includes(o.delivery_status || "")) return false;
      if (!dateRange?.from) return true;
      return isWithinRange(new Date(o.delivered_at ?? o.updated_at), dateRange);
    }).length;

    // Returned: no returned_at field — use updated_at as proxy
    // Matches both "returned" and "return" (both values exist in the DB)
    const returned = pool.filter((o) => {
      if (!RETURNED_STATUSES.includes(o.delivery_status || "")) return false;
      if (!dateRange?.from) return true;
      return isWithinRange(new Date(o.updated_at), dateRange);
    }).length;

    const failedAttempt  = filteredOrders.filter((o) => o.delivery_status === "failed_attempt").length;
    const inReturnProcess = filteredOrders.filter((o) => o.delivery_status === "ready_for_return").length;

    return {
      total, confirmed, poolCount, booked, printed, dispatched, shipped, delivered,
      failedAttempt, returned, inReturnProcess,
      deliveryRate: pct(delivered, confirmed),
      returnRate: pct(returned, poolCount),
      failedAttemptRate: pct(failedAttempt, poolCount),
    };
  }, [filteredOrders, eventFilteredPool, dateRange]);

  // ── By Courier ───────────────────────────────────────────────────────────────

  const courierRows = useMemo(() => {
    const map: Record<string, { total: number; delivered: number; failed: number; returned: number }> = {};
    filteredOrders.forEach((o) => {
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
      const city = o.customer_city?.trim() || "Unknown";
      if (!map[city]) map[city] = { total: 0, delivered: 0, failed: 0, returned: 0, inProcess: 0 };
      map[city].total++;
      if (DELIVERED_STATUSES.includes(o.delivery_status || "")) map[city].delivered++;
      if (o.delivery_status === "failed_attempt") map[city].failed++;
      if (RETURNED_STATUSES.includes(o.delivery_status || "")) map[city].returned++;
      // In Process = booked + shipped/in_transit + failed_attempt (can still be delivered)
      if (
        o.delivery_status === "booked" ||
        SHIPPED_STATUSES.includes(o.delivery_status || "") ||
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
    const map: Record<string, { confirmed: number; delivered: number; failed: number }> = {};
    filteredOrders.forEach((o) => {
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { confirmed: 0, delivered: 0, failed: 0 };
      if (o.confirmation_status === "confirmed" || CONFIRMED_DELIVERY_STATUSES.includes(o.delivery_status || "")) {
        map[name].confirmed++;
      }
      if (DELIVERED_STATUSES.includes(o.delivery_status || "")) map[name].delivered++;
      if (o.delivery_status === "failed_attempt") map[name].failed++;
    });
    return Object.entries(map)
      .filter(([, d]) => d.confirmed > 0)
      .map(([name, d]) => ({ name, confirmed: d.confirmed, delivered: d.delivered, failed: d.failed, rate: pct(d.delivered, d.confirmed) }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  const visibleProductRows = showAllProducts ? productRows : productRows.slice(0, 12);

  // ── Agent Performance ────────────────────────────────────────────────────────

  const agentRows = useMemo(() => {
    // Per-agent stats (phone/manual confirmations)
    const map: Record<string, { confirmed: number; delivered: number; failed: number }> = {};
    // WhatsApp synthetic agent
    const wa = { confirmed: 0, delivered: 0, failed: 0 };

    filteredOrders.forEach((o) => {
      const isWa = o.confirmation_channel === "whatsapp";
      const isConfirmed = o.confirmation_status === "confirmed" || CONFIRMED_DELIVERY_STATUSES.includes(o.delivery_status || "");
      const isDelivered = DELIVERED_STATUSES.includes(o.delivery_status || "");
      const isFailed = o.delivery_status === "failed_attempt";

      if (isWa) {
        // WhatsApp row: count all WA-confirmed orders regardless of agent
        if (isConfirmed) wa.confirmed++;
        if (isDelivered) wa.delivered++;
        if (isFailed) wa.failed++;
      } else {
        const agentId = o.agent_id || o.original_agent_id;
        if (!agentId) return;
        if (!map[agentId]) map[agentId] = { confirmed: 0, delivered: 0, failed: 0 };
        if (isConfirmed) map[agentId].confirmed++;
        if (isDelivered) map[agentId].delivered++;
        if (isFailed) map[agentId].failed++;
      }
    });

    const rows = Object.entries(map)
      .filter(([, d]) => d.confirmed > 0)
      .map(([id, d]) => ({
        id,
        name: profileMap[id] || id.slice(0, 8),
        confirmed: d.confirmed,
        delivered: d.delivered,
        failed: d.failed,
        rate: pct(d.delivered, d.confirmed),
        isWhatsApp: false,
      }));

    // Add WhatsApp as a standalone row if it has any data
    if (wa.confirmed > 0) {
      rows.push({
        id: "__whatsapp__",
        name: "WhatsApp",
        confirmed: wa.confirmed,
        delivered: wa.delivered,
        failed: wa.failed,
        rate: pct(wa.delivered, wa.confirmed),
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

  const hasFilters = sellerFilter !== "all" || productFilter !== "all" || deliveryStatusFilter !== "all" || !!dateRange;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Page Header */}
      <div className="animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md">
            <Truck className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Delivery Analytics</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Shipping & delivery performance insights</p>
          </div>
        </div>
      </div>

      {/* ── Sticky Filter Bar ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-background/80 border border-border/60 rounded-2xl p-3 shadow-sm animate-fade-in">
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
              subtitle="delivered + paid"
              icon={CheckCircle2}
              colorBg="bg-green-100 dark:bg-green-900/30"
              colorIcon="text-green-600 dark:text-green-300"
              gradient="from-green-500 to-emerald-400"
              delay={200}
              pool={kpis.confirmed}
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
            />
            <KPICard
              title="Returned"
              value={kpis.returned}
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
                sub: `${kpis.delivered.toLocaleString()} delivered / ${kpis.confirmed.toLocaleString()} confirmed`,
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
                className="relative overflow-hidden rounded-2xl bg-card border border-border/60 shadow-sm p-5 animate-slide-up"
                style={{ animationDelay: `${400 + i * 60}ms` }}
              >
                <div className={cn("absolute top-0 left-0 right-0 h-1 bg-gradient-to-r", rateGradient(value))} />
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 rounded-xl bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Badge className={cn("text-xs font-semibold border-0", rateBadgeClass(value))}>
                    {rateLabel(value)}
                  </Badge>
                </div>
                <div className="text-4xl font-bold tracking-tight" style={{ color: rateColor(value) }}>
                  {fmtPct(value)}
                </div>
                <p className="text-sm font-medium text-foreground mt-1">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
                <div className="mt-4 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", rateGradient(value))}
                    style={{ width: `${Math.min(value, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ── Section 3: Delivery by Agent ─────────────────────────────────── */}
          {sortedAgentRows.length > 0 && (
            <div
              className="rounded-2xl bg-card border border-border/60 shadow-sm p-5 animate-slide-up"
              style={{ animationDelay: "140ms" }}
            >
              <SectionHeader
                icon={Users}
                title="Delivery by Agent"
                subtitle="Confirmed, delivered & failed per agent — WhatsApp included as a source"
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
                          { key: "confirmed", label: "Confirmed",      align: "right" },
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
                            {row.confirmed.toLocaleString()}
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
              className="rounded-2xl bg-card border border-border/60 shadow-sm p-5 animate-slide-up overflow-hidden"
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
              className="rounded-2xl bg-card border border-border/60 shadow-sm p-5 animate-slide-up"
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

          {/* ── Section 5: Daily Trend Chart ───────────────────────────────────── */}
          {trendData.length > 0 && (
            <div
              className="rounded-2xl bg-card border border-border/60 shadow-sm p-5 animate-slide-up"
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
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
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
                      borderRadius: "12px",
                      border: "1px solid hsl(var(--border))",
                      fontSize: "12px",
                      background: "hsl(var(--card))",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    }}
                  />
                  <Line type="monotone" dataKey="confirmed" stroke="#6366f1" strokeWidth={2} dot={false} name="Confirmed" />
                  <Line type="monotone" dataKey="delivered" stroke="#10b981" strokeWidth={2} dot={false} name="Delivered" />
                  <Line type="monotone" dataKey="returned" stroke="#ef4444" strokeWidth={2} dot={false} name="Returned" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Section 6: Delivery Rate by Product ───────────────────────────── */}
          {productRows.length > 0 && (
            <div
              className="rounded-2xl bg-card border border-border/60 shadow-sm p-5 animate-slide-up"
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
                      <th className="text-right py-2.5 px-3 font-semibold">Confirmed</th>
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
                          {row.confirmed.toLocaleString()}
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
            <div className="rounded-2xl bg-card border border-border/60 p-16 text-center animate-fade-in">
              <div className="w-12 h-12 rounded-2xl bg-muted mx-auto flex items-center justify-center mb-4">
                <Package className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">No orders match the selected filters.</p>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting the date range or filters above.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
