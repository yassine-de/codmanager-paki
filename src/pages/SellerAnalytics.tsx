import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, PieChart, Pie,
} from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingCart, CheckCircle2, Truck, Package, MessageCircle, Phone,
  PhoneMissed, Clock, XCircle, TrendingUp, BarChart2, Users, Award,
  ChevronUp, ChevronDown, ChevronsUpDown, Loader2, AlertCircle, ArrowUpRight,
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
  price: number;
  quantity: number;
  created_at: string;
  confirmed_at: string | null;
  delivered_at: string | null;
  updated_at: string;
};

type SortField = "confRate" | "delRate" | "orders" | "confirmed" | "shipped" | "delivered";
type SortDir = "asc" | "desc";
type SellerSortField = "orders" | "confirmed" | "confPct" | "shipped" | "delivered" | "delPct" | "revenue";

// ─── Constants ────────────────────────────────────────────────────────────────

const ORDER_SELECT =
  "id, order_id, confirmation_status, confirmation_channel, delivery_status, product_name, seller_id, price, quantity, created_at, confirmed_at, delivered_at, updated_at";
const PAGE_SIZE = 1000;
const DELIVERED_STATUSES = ["delivered", "paid"];
const SHIPPED_STATUSES = ["printed", "dispatched", "shipped", "in_transit", "with_courier", "out_for_delivery"];

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reachedConfirmedStage(o: Order): boolean {
  return o.confirmation_status === "confirmed";
}

function isWithinRange(date: Date, range: DateRange | undefined): boolean {
  if (!range?.from) return true;
  if (date < startOfDay(range.from)) return false;
  if (range.to && date > endOfDay(range.to)) return false;
  if (!range.to && date > endOfDay(range.from)) return false;
  return true;
}

function pct(num: number, den: number): number {
  return den === 0 ? 0 : (num / den) * 100;
}

function fmtPct(n: number): string {
  return n.toFixed(1) + "%";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface KPIProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ElementType;
  color: string;        // tailwind bg class for icon container
  iconColor: string;    // tailwind text class for icon
  gradient: string;     // gradient class for top border
  delay?: number;
  isPercent?: boolean;
  total?: number;
}

function KPICard({
  title, value, subtitle, icon: Icon, color, iconColor,
  gradient, delay = 0, isPercent = false, total,
}: KPIProps) {
  const numVal = typeof value === "number" ? value : parseFloat(value as string);
  const pctOfTotal = !isPercent && total && total > 0
    ? pct(numVal, total)
    : null;

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-card border border-border/60 shadow-sm hover:shadow-md transition-all duration-300 animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Top gradient accent */}
      <div className={cn("h-1 w-full", gradient)} />

      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className={cn("p-2 rounded-xl", color)}>
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
          {pctOfTotal !== null && (
            <Badge variant="outline" className="text-[10px] font-medium px-1.5 py-0.5 border-border/50">
              {fmtPct(pctOfTotal)}
            </Badge>
          )}
        </div>

        <div className="space-y-0.5">
          {isPercent ? (
            <>
              <div className="text-2xl font-bold tracking-tight text-foreground">
                {typeof value === "number" ? fmtPct(value) : value}
              </div>
              {/* Progress bar for rate cards */}
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-2">
                <div
                  className={cn("h-full rounded-full transition-all duration-700", gradient)}
                  style={{ width: `${Math.min(numVal, 100)}%` }}
                />
              </div>
            </>
          ) : (
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {typeof value === "number" ? value.toLocaleString() : value}
            </div>
          )}
          <p className="text-xs text-muted-foreground font-medium">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  iconBg,
  iconColor,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  iconBg: string;
  iconColor: string;
}) {
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

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max === 0 ? 0 : Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${w}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{fmtPct(value)}</span>
    </div>
  );
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border bg-card overflow-hidden animate-pulse">
          <div className="h-1 bg-muted" />
          <div className="p-4 space-y-3">
            <div className="w-8 h-8 rounded-xl bg-muted" />
            <div className="space-y-1.5">
              <div className="h-6 w-16 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SellerAnalytics() {
  const [sellerFilter, setSellerFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [dateFieldMode, setDateFieldMode] = useState<"created" | "updated">("created");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [productSort, setProductSort] = useState<SortField>("confRate");
  const [productSortDir, setProductSortDir] = useState<SortDir>("desc");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [sellerSort, setSellerSort] = useState<SellerSortField>("orders");
  const [sellerSortDir, setSellerSortDir] = useState<SortDir>("desc");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["seller-analytics-orders-v2"],
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
      const dateField = dateFieldMode === "created" ? o.created_at : o.updated_at;
      if (!isWithinRange(new Date(dateField), dateRange)) return false;
      return true;
    });
  }, [orders, sellerFilter, productFilter, dateFieldMode, dateRange]);

  // ── Confirmation KPIs ────────────────────────────────────────────────────────

  const confirmationKPIs = useMemo(() => {
    const total = filteredOrders.length;
    // Basis semantics (must match the seller Dashboard):
    //   created → cohort view: of the orders CREATED in this range, how many are confirmed
    //             (count confirmed orders by created_at — same date field as `total`).
    //   updated → event view: how many orders were CONFIRMED in this range, regardless of
    //             when created (count by confirmed_at, fallback updated_at).
    const confirmed = (dateRange?.from
      ? orders.filter((o) => {
          if (!reachedConfirmedStage(o)) return false;
          if (sellerFilter !== "all" && o.seller_id !== sellerFilter) return false;
          if (productFilter !== "all" && o.product_name !== productFilter) return false;
          const dateToCheck = dateFieldMode === "created"
            ? o.created_at
            : (o.confirmed_at ?? o.updated_at);
          return isWithinRange(new Date(dateToCheck), dateRange);
        })
      : filteredOrders.filter(reachedConfirmedStage)
    );
    const confirmedCount = confirmed.length;
    const whatsapp = confirmed.filter((o) => o.confirmation_channel === "whatsapp").length;
    const agent = confirmed.filter((o) => o.confirmation_channel !== "whatsapp").length;
    const newOrders = filteredOrders.filter((o) => o.confirmation_status === "new").length;
    const noAnswer = filteredOrders.filter((o) => o.confirmation_status === "no_answer").length;
    const postponed = filteredOrders.filter((o) => o.confirmation_status === "postponed").length;
    const cancelled = filteredOrders.filter((o) => o.confirmation_status === "cancelled").length;
    const confRate = pct(confirmedCount, total);
    return { total, confirmedCount, whatsapp, agent, newOrders, noAnswer, postponed, cancelled, confRate };
  }, [filteredOrders, orders, dateRange, sellerFilter, productFilter, dateFieldMode]);

  // ── Delivery KPIs ────────────────────────────────────────────────────────────

  const deliveryKPIs = useMemo(() => {
    const matchesFilters = (o: Order) =>
      (sellerFilter === "all" || o.seller_id === sellerFilter) &&
      (productFilter === "all" || o.product_name === productFilter);
    // Basis-aware date check (must match the seller Dashboard):
    //   created → created_at (cohort); updated → the event timestamp for that metric
    //   (delivered_at for delivered, else updated_at as a proxy).
    const inRangeByEvent = (o: Order, eventIso: string | null) => {
      if (!dateRange?.from) return true;
      const d = dateFieldMode === "created" ? o.created_at : (eventIso ?? o.updated_at);
      return isWithinRange(new Date(d), dateRange);
    };
    const base = orders.filter(matchesFilters);
    // Delivered = orders actually delivered in the period (delivered_at in Updated mode).
    const delivered = base.filter((o) => DELIVERED_STATUSES.includes(o.delivery_status || "") && inRangeByEvent(o, o.delivered_at)).length;
    // Returned uses delivered_at as its closest event proxy; the rest have no event
    // timestamp, so fall back to updated_at (when the status was last set).
    const booked = base.filter((o) => o.delivery_status === "booked" && inRangeByEvent(o, o.updated_at)).length;
    const shipped = base.filter((o) => SHIPPED_STATUSES.includes(o.delivery_status || "") && inRangeByEvent(o, o.updated_at)).length;
    const failedAttempt = base.filter((o) => o.delivery_status === "failed_attempt" && inRangeByEvent(o, o.updated_at)).length;
    const returned = base.filter((o) => o.delivery_status === "returned" && inRangeByEvent(o, o.delivered_at)).length;
    const inReturnProcess = base.filter((o) => o.delivery_status === "ready_for_return" && inRangeByEvent(o, o.updated_at)).length;
    // Delivery rate denominator = confirmed orders in the period (matches the Confirmed card).
    const poolCount = confirmationKPIs.confirmedCount;
    const delRate = pct(delivered, poolCount);
    return { poolCount, booked, shipped, delivered, failedAttempt, returned, inReturnProcess, delRate };
  }, [orders, sellerFilter, productFilter, dateFieldMode, dateRange, confirmationKPIs]);

  // ── Product Performance ──────────────────────────────────────────────────────

  const productRows = useMemo(() => {
    const matchesFilters = (o: Order) =>
      (sellerFilter === "all" || o.seller_id === sellerFilter) &&
      (productFilter === "all" || o.product_name === productFilter);
    // Same basis-aware date rule as the KPI cards so per-product counts match the totals.
    const inRangeByEvent = (o: Order, eventIso: string | null) => {
      if (!dateRange?.from) return true;
      const d = dateFieldMode === "created" ? o.created_at : (eventIso ?? o.updated_at);
      return isWithinRange(new Date(d), dateRange);
    };
    const map: Record<string, {
      orders: number; confirmed: number; shipped: number; delivered: number;
    }> = {};

    orders.filter(matchesFilters).forEach((o) => {
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { orders: 0, confirmed: 0, shipped: 0, delivered: 0 };
      if (inRangeByEvent(o, o.updated_at)) map[name].orders++;
      if (reachedConfirmedStage(o) && inRangeByEvent(o, o.confirmed_at)) map[name].confirmed++;
      if (SHIPPED_STATUSES.includes(o.delivery_status || "") && inRangeByEvent(o, o.updated_at)) map[name].shipped++;
      if (DELIVERED_STATUSES.includes(o.delivery_status || "") && inRangeByEvent(o, o.delivered_at)) map[name].delivered++;
    });

    return Object.entries(map).map(([name, d]) => ({
      name,
      orders: d.orders,
      confirmed: d.confirmed,
      confRate: pct(d.confirmed, d.orders),
      shipped: d.shipped,
      delivered: d.delivered,
      delRate: pct(d.delivered, d.confirmed),
    }));
  }, [orders, sellerFilter, productFilter, dateFieldMode, dateRange]);

  const sortedProductRows = useMemo(() => {
    return [...productRows].sort((a, b) => {
      const diff = a[productSort] - b[productSort];
      return productSortDir === "desc" ? -diff : diff;
    });
  }, [productRows, productSort, productSortDir]);

  const visibleProductRows = showAllProducts ? sortedProductRows : sortedProductRows.slice(0, 10);

  // ── Seller Leaderboard ───────────────────────────────────────────────────────

  const sellerRows = useMemo(() => {
    const matchesProduct = (o: Order) => productFilter === "all" || o.product_name === productFilter;
    // Same basis-aware date rule as the KPI cards.
    const inRangeByEvent = (o: Order, eventIso: string | null) => {
      if (!dateRange?.from) return true;
      const d = dateFieldMode === "created" ? o.created_at : (eventIso ?? o.updated_at);
      return isWithinRange(new Date(d), dateRange);
    };
    const map: Record<string, {
      orders: number; confirmed: number; shipped: number; delivered: number; revenue: number;
    }> = {};

    orders.filter(matchesProduct).forEach((o) => {
      const id = o.seller_id;
      if (!map[id]) map[id] = { orders: 0, confirmed: 0, shipped: 0, delivered: 0, revenue: 0 };
      if (inRangeByEvent(o, o.updated_at)) map[id].orders++;
      if (reachedConfirmedStage(o) && inRangeByEvent(o, o.confirmed_at)) map[id].confirmed++;
      if (SHIPPED_STATUSES.includes(o.delivery_status || "") && inRangeByEvent(o, o.updated_at)) map[id].shipped++;
      if (DELIVERED_STATUSES.includes(o.delivery_status || "") && inRangeByEvent(o, o.delivered_at)) {
        map[id].delivered++;
        map[id].revenue += (o.price || 0) * (o.quantity || 1);
      }
    });

    return Object.entries(map).map(([id, d]) => ({
      id,
      name: profileMap[id] || id.slice(0, 8),
      orders: d.orders,
      confirmed: d.confirmed,
      confPct: pct(d.confirmed, d.orders),
      shipped: d.shipped,
      delivered: d.delivered,
      delPct: pct(d.delivered, d.confirmed),
      revenue: d.revenue,
    }));
  }, [orders, productFilter, dateFieldMode, dateRange, profileMap]);

  const sortedSellerRows = useMemo(() => {
    return [...sellerRows].sort((a, b) => {
      const diff = a[sellerSort] - b[sellerSort];
      return sellerSortDir === "desc" ? -diff : diff;
    });
  }, [sellerRows, sellerSort, sellerSortDir]);

  // ── Chart data: daily confirmed trend ───────────────────────────────────────

  const trendData = useMemo(() => {
    const rangeFrom = dateRange?.from || subDays(new Date(), 29);
    const rangeTo = dateRange?.to || new Date();

    const days: { label: string; date: Date }[] = [];
    let cur = startOfDay(rangeFrom);
    const end = endOfDay(rangeTo);
    while (cur <= end) {
      days.push({ label: format(cur, "MMM d"), date: new Date(cur) });
      cur = new Date(cur.getTime() + 86_400_000);
    }

    const map: Record<string, { orders: number; confirmed: number; delivered: number }> = {};
    days.forEach(({ label }) => { map[label] = { orders: 0, confirmed: 0, delivered: 0 }; });

    const matchesFilters = (o: Order) =>
      (sellerFilter === "all" || o.seller_id === sellerFilter) &&
      (productFilter === "all" || o.product_name === productFilter);
    // Bucket each metric by its own event date (per chosen basis) so the trend
    // matches the KPI cards: created → created_at; updated → confirmed_at / delivered_at.
    const eventDay = (o: Order, eventIso: string | null) =>
      format(new Date(dateFieldMode === "created" ? o.created_at : (eventIso ?? o.updated_at)), "MMM d");

    orders.filter(matchesFilters).forEach((o) => {
      const od = eventDay(o, o.updated_at);
      if (map[od]) map[od].orders++;
      if (reachedConfirmedStage(o)) {
        const cd = eventDay(o, o.confirmed_at);
        if (map[cd]) map[cd].confirmed++;
      }
      if (DELIVERED_STATUSES.includes(o.delivery_status || "")) {
        const dd = eventDay(o, o.delivered_at);
        if (map[dd]) map[dd].delivered++;
      }
    });

    // Show at most 30 days
    return days.slice(-30).map(({ label }) => ({ label, ...map[label] }));
  }, [orders, sellerFilter, productFilter, dateFieldMode, dateRange]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function handleSellerChange(id: string) {
    setSellerFilter(id);
    setProductFilter("all"); // reset product when seller changes
  }

  function handleProductSort(field: SortField) {
    if (productSort === field) {
      setProductSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setProductSort(field);
      setProductSortDir("desc");
    }
  }

  function handleSellerSort(field: SellerSortField) {
    if (sellerSort === field) {
      setSellerSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSellerSort(field);
      setSellerSortDir("desc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (productSort !== field) return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50 ml-1" />;
    return productSortDir === "desc"
      ? <ChevronDown className="h-3 w-3 text-primary ml-1" />
      : <ChevronUp className="h-3 w-3 text-primary ml-1" />;
  }

  function SellerSortIcon({ field }: { field: SellerSortField }) {
    if (sellerSort !== field) return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50 ml-1" />;
    return sellerSortDir === "desc"
      ? <ChevronDown className="h-3 w-3 text-primary ml-1" />
      : <ChevronUp className="h-3 w-3 text-primary ml-1" />;
  }

  const hasActiveFilters = sellerFilter !== "all" || productFilter !== "all" || datePreset !== "maximum";
  const maxProductOrders = sortedProductRows[0]?.orders ?? 1;
  const maxSellerOrders = sortedSellerRows[0]?.orders ?? 1;

  const TOOLTIP_STYLE = {
    borderRadius: "12px",
    border: "1px solid hsl(var(--border))",
    fontSize: "12px",
    background: "hsl(var(--card))",
    color: "hsl(var(--foreground))",
    boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
  };

  // ─── Loading ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-8 max-w-7xl p-1">
        {/* Header skeleton */}
        <div className="space-y-2 animate-pulse">
          <div className="h-7 w-48 rounded-lg bg-muted" />
          <div className="h-4 w-64 rounded bg-muted" />
        </div>
        {/* Filter bar skeleton */}
        <div className="rounded-2xl border bg-card p-4 flex gap-3 animate-pulse">
          <div className="h-9 w-40 rounded-lg bg-muted" />
          <div className="h-9 w-40 rounded-lg bg-muted" />
          <div className="h-9 w-48 rounded-lg bg-muted" />
        </div>
        <SkeletonGrid count={9} />
        <SkeletonGrid count={6} />
        <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading analytics…
        </div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 max-w-7xl p-1">

      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 animate-fade-in">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10">
              <BarChart2 className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Seller Analytics</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1.5 ml-11">
            Confirmation &amp; delivery performance across all sellers and products
          </p>
        </div>
        <Badge variant="outline" className="text-xs py-1 px-2.5 shrink-0">
          {filteredOrders.length.toLocaleString()} orders
        </Badge>
      </div>

      {/* ── Sticky Filter Bar ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md rounded-2xl border border-border/60 shadow-sm p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <SearchableSelect
            value={sellerFilter}
            onValueChange={handleSellerChange}
            options={sellerOptions}
            placeholder="Seller"
            allLabel="All Sellers"
            className="w-[160px]"
          />
          <SearchableSelect
            value={productFilter}
            onValueChange={setProductFilter}
            options={productOptions}
            placeholder="Product"
            allLabel="All Products"
            className="w-[160px]"
          />
          <DatePresetFilter
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            preset={datePreset}
            onPresetChange={setDatePreset}
          />
          {/* Date field toggle */}
          <div className="flex items-center rounded-lg border border-border/60 overflow-hidden h-9">
            <button
              onClick={() => setDateFieldMode("created")}
              className={cn(
                "px-3 h-full text-xs font-medium transition-colors",
                dateFieldMode === "created"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              Created
            </button>
            <button
              onClick={() => setDateFieldMode("updated")}
              className={cn(
                "px-3 h-full text-xs font-medium transition-colors",
                dateFieldMode === "updated"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              Updated
            </button>
          </div>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSellerFilter("all");
                setProductFilter("all");
                setDatePreset("maximum");
                setDateRange(undefined);
                setShowAllProducts(false);
              }}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* ── Section 1: Confirmation KPIs ─────────────────────────────────────── */}
      <div className="animate-slide-up" style={{ animationDelay: "50ms" }}>
        <SectionHeader
          icon={CheckCircle2}
          title="Confirmation Performance"
          subtitle="Based on all filtered orders"
          iconBg="bg-emerald-500/10"
          iconColor="text-emerald-500"
        />
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 rounded-2xl border border-dashed border-border/60 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8 opacity-40" />
            <p className="text-sm font-medium">No orders match the current filters</p>
            <p className="text-xs">Try adjusting the date range or seller selection</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <KPICard
              title="Total Orders"
              value={confirmationKPIs.total}
              icon={ShoppingCart}
              color="bg-indigo-500/10"
              iconColor="text-indigo-500"
              gradient="bg-gradient-to-r from-indigo-500 to-indigo-400"
              delay={0}
            />
            <KPICard
              title="New"
              value={confirmationKPIs.newOrders}
              icon={ArrowUpRight}
              color="bg-sky-500/10"
              iconColor="text-sky-500"
              gradient="bg-gradient-to-r from-sky-500 to-sky-400"
              total={confirmationKPIs.total}
              delay={50}
            />
            <KPICard
              title="Confirmed"
              value={confirmationKPIs.confirmedCount}
              icon={CheckCircle2}
              color="bg-emerald-500/10"
              iconColor="text-emerald-500"
              gradient="bg-gradient-to-r from-emerald-500 to-emerald-400"
              total={confirmationKPIs.total}
              delay={100}
            />
            <KPICard
              title="Confirmed via WhatsApp"
              value={confirmationKPIs.whatsapp}
              icon={MessageCircle}
              color="bg-green-500/10"
              iconColor="text-green-500"
              gradient="bg-gradient-to-r from-green-500 to-green-400"
              total={confirmationKPIs.total}
              delay={150}
            />
            <KPICard
              title="Confirmed via Agent"
              value={confirmationKPIs.agent}
              icon={Phone}
              color="bg-teal-500/10"
              iconColor="text-teal-500"
              gradient="bg-gradient-to-r from-teal-500 to-teal-400"
              total={confirmationKPIs.total}
              delay={200}
            />
            <KPICard
              title="No Answer"
              value={confirmationKPIs.noAnswer}
              icon={PhoneMissed}
              color="bg-amber-500/10"
              iconColor="text-amber-500"
              gradient="bg-gradient-to-r from-amber-500 to-amber-400"
              total={confirmationKPIs.total}
              delay={250}
            />
            <KPICard
              title="Postponed"
              value={confirmationKPIs.postponed}
              icon={Clock}
              color="bg-orange-500/10"
              iconColor="text-orange-500"
              gradient="bg-gradient-to-r from-orange-500 to-orange-400"
              total={confirmationKPIs.total}
              delay={300}
            />
            <KPICard
              title="Cancelled"
              value={confirmationKPIs.cancelled}
              icon={XCircle}
              color="bg-red-500/10"
              iconColor="text-red-500"
              gradient="bg-gradient-to-r from-red-500 to-red-400"
              total={confirmationKPIs.total}
              delay={350}
            />
            <KPICard
              title="Confirmation Rate"
              value={confirmationKPIs.confRate}
              isPercent
              icon={TrendingUp}
              color="bg-violet-500/10"
              iconColor="text-violet-500"
              gradient="bg-gradient-to-r from-violet-500 to-violet-400"
              delay={400}
            />
          </div>
        )}
      </div>

      {/* ── Section 2: Delivery KPIs ──────────────────────────────────────────── */}
      {deliveryKPIs.poolCount > 0 && (
        <div className="animate-slide-up" style={{ animationDelay: "100ms" }}>
          <SectionHeader
            icon={Truck}
            title="Delivery Performance"
            subtitle={`Based on ${deliveryKPIs.poolCount.toLocaleString()} confirmed orders`}
            iconBg="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
            <KPICard
              title="Booked"
              value={deliveryKPIs.booked}
              icon={Package}
              color="bg-violet-500/10"
              iconColor="text-violet-500"
              gradient="bg-gradient-to-r from-violet-500 to-violet-400"
              total={deliveryKPIs.poolCount}
              delay={0}
            />
            <KPICard
              title="Shipped / In Transit"
              value={deliveryKPIs.shipped}
              icon={Package}
              color="bg-blue-500/10"
              iconColor="text-blue-500"
              gradient="bg-gradient-to-r from-blue-500 to-blue-400"
              total={deliveryKPIs.poolCount}
              delay={0}
            />
            <KPICard
              title="Delivered"
              value={deliveryKPIs.delivered}
              icon={CheckCircle2}
              color="bg-emerald-500/10"
              iconColor="text-emerald-500"
              gradient="bg-gradient-to-r from-emerald-500 to-emerald-400"
              total={deliveryKPIs.poolCount}
              delay={60}
            />
            <KPICard
              title="Failed Attempt"
              value={deliveryKPIs.failedAttempt}
              icon={AlertCircle}
              color="bg-amber-500/10"
              iconColor="text-amber-500"
              gradient="bg-gradient-to-r from-amber-500 to-amber-400"
              total={deliveryKPIs.poolCount}
              delay={120}
            />
            <KPICard
              title="Returned"
              value={deliveryKPIs.returned}
              icon={ArrowUpRight}
              color="bg-red-500/10"
              iconColor="text-red-500"
              gradient="bg-gradient-to-r from-red-500 to-red-400"
              total={deliveryKPIs.poolCount}
              delay={180}
            />
            <KPICard
              title="In Return Process"
              value={deliveryKPIs.inReturnProcess}
              icon={Clock}
              color="bg-orange-500/10"
              iconColor="text-orange-500"
              gradient="bg-gradient-to-r from-orange-500 to-orange-400"
              total={deliveryKPIs.poolCount}
              delay={240}
            />
            <KPICard
              title="Delivery Rate"
              value={deliveryKPIs.delRate}
              isPercent
              icon={TrendingUp}
              color="bg-cyan-500/10"
              iconColor="text-cyan-500"
              gradient="bg-gradient-to-r from-cyan-500 to-cyan-400"
              delay={300}
            />
          </div>
        </div>
      )}

      {/* ── Trend Chart ───────────────────────────────────────────────────────── */}
      {trendData.length > 1 && (
        <div
          className="rounded-2xl border border-border/60 bg-card shadow-sm p-5 animate-slide-up"
          style={{ animationDelay: "150ms" }}
        >
          <SectionHeader
            icon={TrendingUp}
            title="Daily Order Trend"
            subtitle="Orders · Confirmed · Delivered"
            iconBg="bg-primary/10"
            iconColor="text-primary"
          />
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line
                type="monotone"
                dataKey="orders"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                name="Orders"
              />
              <Line
                type="monotone"
                dataKey="confirmed"
                stroke="hsl(142, 70%, 45%)"
                strokeWidth={2}
                dot={false}
                name="Confirmed"
              />
              <Line
                type="monotone"
                dataKey="delivered"
                stroke="hsl(220, 70%, 55%)"
                strokeWidth={2}
                dot={false}
                name="Delivered"
                strokeDasharray="4 4"
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-5 mt-3 justify-center">
            {[
              { label: "Orders", color: "hsl(var(--primary))" },
              { label: "Confirmed", color: "hsl(142, 70%, 45%)" },
              { label: "Delivered", color: "hsl(220, 70%, 55%)" },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="h-2 w-4 rounded-full" style={{ background: color }} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section 3: Product Performance ───────────────────────────────────── */}
      {sortedProductRows.length > 0 && (
        <div
          className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden animate-slide-up"
          style={{ animationDelay: "200ms" }}
        >
          <div className="p-5 border-b border-border/60">
            <SectionHeader
              icon={Package}
              title="Product Performance"
              subtitle={`${sortedProductRows.length} products — showing ${visibleProductRows.length}`}
              iconBg="bg-orange-500/10"
              iconColor="text-orange-500"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground w-[200px]">Product</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleProductSort("orders")}>
                    <span className="inline-flex items-center justify-end">Orders <SortIcon field="orders" /></span>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleProductSort("confirmed")}>
                    <span className="inline-flex items-center justify-end">Confirmed <SortIcon field="confirmed" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors min-w-[140px]" onClick={() => handleProductSort("confRate")}>
                    <span className="inline-flex items-center">Conf. Rate <SortIcon field="confRate" /></span>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleProductSort("shipped")}>
                    <span className="inline-flex items-center justify-end">Shipped <SortIcon field="shipped" /></span>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleProductSort("delivered")}>
                    <span className="inline-flex items-center justify-end">Delivered <SortIcon field="delivered" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors min-w-[140px]" onClick={() => handleProductSort("delRate")}>
                    <span className="inline-flex items-center">Del. Rate <SortIcon field="delRate" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleProductRows.map((row, i) => (
                  <tr key={row.name} className={cn("border-b border-border/40 hover:bg-muted/20 transition-colors", i % 2 === 0 ? "" : "bg-muted/5")}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-xs truncate max-w-[180px]" title={row.name}>{row.name}</div>
                      <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden w-full">
                        <div className="h-full rounded-full bg-orange-400/60 transition-all" style={{ width: `${(row.orders / maxProductOrders) * 100}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-xs">{row.orders.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">{row.confirmed.toLocaleString()}</td>
                    <td className="px-4 py-3"><MiniBar value={row.confRate} max={100} color="bg-emerald-500" /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">{row.shipped.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">{row.delivered.toLocaleString()}</td>
                    <td className="px-4 py-3"><MiniBar value={row.delRate} max={100} color="bg-blue-500" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sortedProductRows.length > 10 && (
            <div className="px-4 py-3 border-t border-border/40 flex items-center justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
                onClick={() => setShowAllProducts((v) => !v)}
              >
                {showAllProducts ? (
                  <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
                ) : (
                  <><ChevronDown className="h-3.5 w-3.5" /> Show more ({sortedProductRows.length - 10} more)</>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Section 4: Seller Leaderboard ────────────────────────────────────── */}
      {sellerRows.length > 0 && (
        <div
          className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden animate-slide-up"
          style={{ animationDelay: "250ms" }}
        >
          <div className="p-5 border-b border-border/60">
            <SectionHeader
              icon={Award}
              title="Seller Leaderboard"
              subtitle="Ranked by total orders in selected period"
              iconBg="bg-yellow-500/10"
              iconColor="text-yellow-500"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30">
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground w-12">Rank</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Seller</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSellerSort("orders")}>
                    <span className="inline-flex items-center justify-end">Orders <SellerSortIcon field="orders" /></span>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSellerSort("confirmed")}>
                    <span className="inline-flex items-center justify-end">Confirmed <SellerSortIcon field="confirmed" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors min-w-[120px]" onClick={() => handleSellerSort("confPct")}>
                    <span className="inline-flex items-center">Conf.% <SellerSortIcon field="confPct" /></span>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSellerSort("shipped")}>
                    <span className="inline-flex items-center justify-end">Shipped <SellerSortIcon field="shipped" /></span>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSellerSort("delivered")}>
                    <span className="inline-flex items-center justify-end">Delivered <SellerSortIcon field="delivered" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors min-w-[120px]" onClick={() => handleSellerSort("delPct")}>
                    <span className="inline-flex items-center">Del.% <SellerSortIcon field="delPct" /></span>
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSellerSort("revenue")}>
                    <span className="inline-flex items-center justify-end">Revenue <SellerSortIcon field="revenue" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedSellerRows.map((row, i) => {
                  const isGold = i === 0;
                  const isSilver = i === 1;
                  const isBronze = i === 2;
                  const medalColor = isGold
                    ? "text-yellow-500 bg-yellow-500/10"
                    : isSilver
                    ? "text-slate-400 bg-slate-400/10"
                    : isBronze
                    ? "text-orange-600 bg-orange-600/10"
                    : "text-muted-foreground bg-muted";
                  const rowBg = isGold
                    ? "bg-yellow-500/5"
                    : isSilver
                    ? "bg-slate-400/5"
                    : isBronze
                    ? "bg-orange-600/5"
                    : i % 2 === 0
                    ? ""
                    : "bg-muted/5";

                  return (
                    <tr
                      key={row.id}
                      className={cn("border-b border-border/40 hover:bg-muted/20 transition-colors", rowBg)}
                    >
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold",
                            medalColor
                          )}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-xs">{row.name}</div>
                        <div
                          className="mt-1 h-1 rounded-full overflow-hidden bg-muted"
                          style={{ width: "100%", maxWidth: "120px" }}
                        >
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              isGold
                                ? "bg-yellow-400"
                                : isSilver
                                ? "bg-slate-400"
                                : isBronze
                                ? "bg-orange-500"
                                : "bg-primary/40"
                            )}
                            style={{ width: `${(row.orders / maxSellerOrders) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs font-semibold">
                        {row.orders.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                        {row.confirmed.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <MiniBar value={row.confPct} max={100} color="bg-emerald-500" />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                        {row.shipped.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                        {row.delivered.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <MiniBar value={row.delPct} max={100} color="bg-blue-500" />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs font-medium">
                        {row.revenue > 0 ? (
                          <span>
                            {row.revenue >= 1_000_000
                              ? `${(row.revenue / 1_000_000).toFixed(1)}M`
                              : row.revenue >= 1_000
                              ? `${(row.revenue / 1_000).toFixed(0)}k`
                              : row.revenue.toLocaleString()}{" "}
                            <span className="text-muted-foreground font-normal">PKR</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Top Products Chart ────────────────────────────────────────────────── */}
      {sortedProductRows.length > 0 && (
        <div
          className="rounded-2xl border border-border/60 bg-card shadow-sm p-5 animate-slide-up"
          style={{ animationDelay: "300ms" }}
        >
          <SectionHeader
            icon={BarChart2}
            title="Top Products by Orders"
            subtitle="Top 10 products"
            iconBg="bg-indigo-500/10"
            iconColor="text-indigo-500"
          />
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={sortedProductRows.slice(0, 10)}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                dataKey="name"
                type="category"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                width={150}
                tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 22) + "…" : v}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: number, name: string) => [v.toLocaleString(), name]}
              />
              <Bar dataKey="orders" name="Orders" radius={[0, 6, 6, 0]} maxBarSize={24}>
                {sortedProductRows.slice(0, 10).map((_, i) => (
                  <Cell
                    key={i}
                    fill={`hsl(${220 + i * 15}, 70%, ${60 - i * 2}%)`}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Confirmation Status Breakdown Pie ─────────────────────────────────── */}
      {filteredOrders.length > 0 && (
        <div
          className="rounded-2xl border border-border/60 bg-card shadow-sm p-5 animate-slide-up"
          style={{ animationDelay: "350ms" }}
        >
          <SectionHeader
            icon={Users}
            title="Confirmation Status Breakdown"
            subtitle="Distribution of all filtered orders"
            iconBg="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <div className="flex flex-col lg:flex-row items-center gap-6">
            <ResponsiveContainer width="100%" height={260} className="max-w-[280px]">
              <PieChart>
                <Pie
                  data={[
                    { name: "Confirmed", value: confirmationKPIs.confirmedCount, fill: "hsl(142, 70%, 45%)" },
                    { name: "New", value: confirmationKPIs.newOrders, fill: "hsl(200, 80%, 55%)" },
                    { name: "No Answer", value: confirmationKPIs.noAnswer, fill: "hsl(38, 90%, 55%)" },
                    { name: "Postponed", value: confirmationKPIs.postponed, fill: "hsl(24, 85%, 55%)" },
                    { name: "Cancelled", value: confirmationKPIs.cancelled, fill: "hsl(0, 65%, 55%)" },
                  ].filter((d) => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={3}
                  dataKey="value"
                  nameKey="name"
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [v.toLocaleString(), ""]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              {[
                { label: "Confirmed", value: confirmationKPIs.confirmedCount, color: "bg-emerald-500" },
                { label: "New", value: confirmationKPIs.newOrders, color: "bg-sky-500" },
                { label: "No Answer", value: confirmationKPIs.noAnswer, color: "bg-amber-500" },
                { label: "Postponed", value: confirmationKPIs.postponed, color: "bg-orange-500" },
                { label: "Cancelled", value: confirmationKPIs.cancelled, color: "bg-red-500" },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", color)} />
                    <span className="text-xs font-medium">{label}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold tabular-nums">{value.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground ml-1.5">
                      {fmtPct(pct(value, confirmationKPIs.total))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
