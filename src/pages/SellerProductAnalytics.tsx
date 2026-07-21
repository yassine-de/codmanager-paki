import React, { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Package, CheckCircle2, XCircle, Truck, BarChart2,
  ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight,
  TrendingUp, TrendingDown, AlertCircle, PhoneMissed, PhoneOff,
} from "lucide-react";
import {
  startOfDayPKT as startOfDay,
  endOfDayPKT as endOfDay,
} from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { confirmationRatePercent } from "@/lib/confirmation-rate";
import { isInShippedDeliveryPool } from "@/lib/delivery-rate";

// ─── Types ────────────────────────────────────────────────────────────────────

type Order = {
  id: string;
  confirmation_status: string;
  delivery_status: string | null;
  product_name: string;
  cancel_reason: string | null;
  created_at: string;
  confirmed_at: string | null;
  delivered_at: string | null;
  updated_at: string;
};

// Date basis (same logic as the seller Dashboard & admin Seller Analytics):
//   created → cohort view, every metric filtered by created_at.
//   updated → event view, each metric filtered by its own event date
//             (confirmed_at for confirmed, delivered_at for delivered, else updated_at).
type DateBasis = "created" | "updated";

type SortDir = "asc" | "desc";
type ProductSortField = "name" | "total" | "confirmed" | "confRate" | "delivered" | "delRate" | "cancelled" | "wrongNumber";

// ─── Constants ────────────────────────────────────────────────────────────────

// Only safe fields: no agent, no channel, no carrier internals, no seller_id leaks
const ORDER_SELECT =
  "id, confirmation_status, delivery_status, product_name, cancel_reason, created_at, confirmed_at, delivered_at, updated_at";

const PAGE_SIZE = 1000;

const CONFIRMED_STATUSES = ["confirmed"];
const CANCELLED_STATUSES = ["cancelled"];
const DELIVERED_STATUSES = ["delivered", "paid"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(num: number, den: number): number {
  return den === 0 ? 0 : (num / den) * 100;
}

function fmtPct(n: number): string {
  return n.toFixed(1) + "%";
}

function rateColor(rate: number): string {
  if (rate >= 50) return "hsl(155, 50%, 42%)";           // green
  if (rate >= 20) return "hsl(25, 65%, 42%)";            // marron
  return "hsl(0, 65%, 52%)";                             // red
}

function rateBadgeClass(rate: number): string {
  if (rate >= 50) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (rate >= 20) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
}

function rateGradient(rate: number): string {
  if (rate >= 50) return "from-emerald-500 to-green-400";
  if (rate >= 20) return "from-orange-700 to-amber-600";  // marron gradient
  return "from-red-500 to-rose-400";
}

function isWithinRange(date: Date, range: DateRange | undefined): boolean {
  if (!range?.from) return true;
  if (date < startOfDay(range.from)) return false;
  if (range.to && date > endOfDay(range.to)) return false;
  if (!range.to && date > endOfDay(range.from)) return false;
  return true;
}

// ─── Fetch (seller-scoped, never leaks other sellers' data) ──────────────────

async function fetchSellerOrders(sellerId: string): Promise<Order[]> {
  const rows: Order[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("seller_id", sellerId)          // hard-locked to current seller
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
      className="relative overflow-hidden rounded-2xl bg-card border border-border/60 shadow-sm hover:shadow-md transition-all duration-300"
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
        <div className="text-2xl font-bold tracking-tight">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        <p className="text-xs text-muted-foreground font-medium mt-0.5">{title}</p>
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
  );
}

function SortIcon({ field, active, dir }: { field: string; active: string; dir: SortDir }) {
  if (active !== field) return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50 inline ml-1" />;
  return dir === "desc"
    ? <ChevronDown className="h-3 w-3 text-primary inline ml-1" />
    : <ChevronUp className="h-3 w-3 text-primary inline ml-1" />;
}

// Cancellation reason badge colours
const REASON_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#8b5cf6", "#14b8a6", "#f97316", "#ec4899", "#64748b",
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SellerProductAnalytics() {
  const { authUser } = useAuth();
  const sellerId = authUser?.id ?? "";

  const [productFilter, setProductFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [dateBasis, setDateBasis] = useState<DateBasis>("created");

  const [productSort, setProductSort] = useState<ProductSortField>("total");
  const [productSortDir, setProductSortDir] = useState<SortDir>("desc");
  const [showAllProducts, setShowAllProducts] = useState(false);

  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [showAllReasons, setShowAllReasons] = useState(false);

  // ── Data Fetch ────────────────────────────────────────────────────────────

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["seller-product-analytics", sellerId],
    queryFn: () => fetchSellerOrders(sellerId),
    enabled: !!sellerId,
  });

  // ── Derived Options ───────────────────────────────────────────────────────

  const productOptions = useMemo(() => {
    const names = [...new Set(orders.map((o) => o.product_name).filter(Boolean))];
    return names.sort().map((n) => ({ value: n, label: n }));
  }, [orders]);

  // ── Basis-aware date predicate ────────────────────────────────────────────
  // created → check created_at; updated → check the given event date (fallback updated_at).
  const inRangeByEvent = useCallback((o: Order, eventIso: string | null) => {
    if (!dateRange?.from) return true;
    const d = dateBasis === "created" ? o.created_at : (eventIso ?? o.updated_at);
    return isWithinRange(new Date(d), dateRange);
  }, [dateBasis, dateRange]);

  // Product-filtered base (NOT date-filtered — each metric applies its own event date).
  const base = useMemo(
    () => orders.filter((o) => productFilter === "all" || o.product_name === productFilter),
    [orders, productFilter],
  );

  // ── Filtered Orders (generic basis — used for total / empty-state) ─────────
  const filteredOrders = useMemo(
    () => base.filter((o) => inRangeByEvent(o, o.updated_at)),
    [base, inRangeByEvent],
  );

  // ── Global KPIs ──────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const total = base.filter((o) => inRangeByEvent(o, o.updated_at)).length;
    const confirmed = base.filter(
      (o) => CONFIRMED_STATUSES.includes(o.confirmation_status) && inRangeByEvent(o, o.confirmed_at)
    ).length;
    const cancelled = base.filter((o) => CANCELLED_STATUSES.includes(o.confirmation_status) && inRangeByEvent(o, o.updated_at)).length;
    const delivered = base.filter((o) => DELIVERED_STATUSES.includes(o.delivery_status || "") && inRangeByEvent(o, o.delivered_at)).length;
    const shipped = base.filter((o) => isInShippedDeliveryPool(o.delivery_status) && inRangeByEvent(o, o.updated_at)).length;
    const wrongNumber = base.filter((o) => o.confirmation_status === "wrong_number" && inRangeByEvent(o, o.updated_at)).length;
    const unreachable = base.filter((o) => o.confirmation_status === "unreachable" && inRangeByEvent(o, o.updated_at)).length;
    const newOrders = base.filter((o) => o.confirmation_status === "new" && inRangeByEvent(o, o.created_at)).length;
    return {
      total,
      confirmed,
      shipped,
      cancelled,
      delivered,
      wrongNumber,
      unreachable,
      confRate: confirmationRatePercent(confirmed, total, newOrders),
      delRate: pct(delivered, shipped),
      cancelRate: pct(cancelled, total),
      wrongNumberRate: pct(wrongNumber, total),
      unreachableRate: pct(unreachable, total),
    };
  }, [base, inRangeByEvent]);

  // ── Per-Product Rows ──────────────────────────────────────────────────────

  const productRows = useMemo(() => {
    const map: Record<string, {
      total: number; newOrders: number; confirmed: number; shipped: number; delivered: number; cancelled: number; wrongNumber: number;
      reasons: Record<string, number>;
    }> = {};
    base.forEach((o) => {
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { total: 0, newOrders: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0, wrongNumber: 0, reasons: {} };
      if (inRangeByEvent(o, o.updated_at)) map[name].total++;
      if (o.confirmation_status === "new" && inRangeByEvent(o, o.updated_at)) map[name].newOrders++;
      if (CONFIRMED_STATUSES.includes(o.confirmation_status) && inRangeByEvent(o, o.confirmed_at)) map[name].confirmed++;
      if (isInShippedDeliveryPool(o.delivery_status) && inRangeByEvent(o, o.updated_at)) map[name].shipped++;
      if (DELIVERED_STATUSES.includes(o.delivery_status || "") && inRangeByEvent(o, o.delivered_at)) map[name].delivered++;
      if (CANCELLED_STATUSES.includes(o.confirmation_status) && inRangeByEvent(o, o.updated_at)) {
        map[name].cancelled++;
        const reason = o.cancel_reason?.trim() || "Not specified";
        map[name].reasons[reason] = (map[name].reasons[reason] || 0) + 1;
      }
      if (o.confirmation_status === "wrong_number" && inRangeByEvent(o, o.updated_at)) map[name].wrongNumber++;
    });
    return Object.entries(map).map(([name, d]) => ({
      name,
      total: d.total,
      confirmed: d.confirmed,
      delivered: d.delivered,
      cancelled: d.cancelled,
      wrongNumber: d.wrongNumber,
      confRate: confirmationRatePercent(d.confirmed, d.total, d.newOrders),
      delRate: pct(d.delivered, d.shipped),
      cancelRate: pct(d.cancelled, d.total),
      reasons: Object.entries(d.reasons)
        .map(([reason, count]) => ({ reason, count, pct: pct(count, d.cancelled) }))
        .sort((a, b) => b.count - a.count),
    }));
  }, [base, inRangeByEvent]);

  const sortedProductRows = useMemo(() => {
    return [...productRows].sort((a, b) => {
      const av = a[productSort], bv = b[productSort];
      if (typeof av === "string" && typeof bv === "string") {
        return productSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const diff = (av as number) - (bv as number);
      return productSortDir === "desc" ? -diff : diff;
    });
  }, [productRows, productSort, productSortDir]);

  const visibleProductRows = showAllProducts ? sortedProductRows : sortedProductRows.slice(0, 10);

  // ── Global Cancellation Reasons ───────────────────────────────────────────

  const globalReasons = useMemo(() => {
    const map: Record<string, number> = {};
    base.forEach((o) => {
      if (!CANCELLED_STATUSES.includes(o.confirmation_status)) return;
      if (!inRangeByEvent(o, o.updated_at)) return;
      const reason = o.cancel_reason?.trim() || "Not specified";
      map[reason] = (map[reason] || 0) + 1;
    });
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map)
      .map(([reason, count]) => ({ reason, count, pct: pct(count, total) }))
      .sort((a, b) => b.count - a.count);
  }, [base, inRangeByEvent]);

  // ── Sort toggle ───────────────────────────────────────────────────────────

  function toggleSort(field: ProductSortField) {
    if (productSort === field) setProductSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setProductSort(field); setProductSortDir("desc"); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!sellerId) return null;

  return (
    <div className="space-y-6 max-w-6xl">

      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-md">
          <BarChart2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Analytics</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Product performance · confirmation & delivery rates</p>
        </div>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-background/80 border border-border/60 rounded-2xl p-3 shadow-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <DatePresetFilter
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            preset={datePreset}
            onPresetChange={setDatePreset}
          />
          <SearchableSelect
            value={productFilter}
            onValueChange={setProductFilter}
            options={productOptions}
            placeholder="Product"
            allLabel="All Products"
            className="w-48"
          />
          {/* Date basis: filter every metric by created_at (cohort) or by each
              metric's own event date (confirmed_at / delivered_at) */}
          <div className="inline-flex items-center rounded-lg border bg-background p-0.5 text-xs">
            {([
              { value: "created", label: "Created" },
              { value: "updated", label: "Updated" },
            ] as { value: DateBasis; label: string }[]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDateBasis(opt.value)}
                className={
                  "px-3 py-1.5 rounded-md font-medium transition-colors " +
                  (dateBasis === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          {(productFilter !== "all" || !!dateRange || dateBasis !== "created") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => { setProductFilter("all"); setDateRange(undefined); setDatePreset("maximum"); setDateBasis("created"); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        /* ── Skeleton ─────────────────────────────────────────────────────── */
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border bg-card overflow-hidden animate-pulse">
                <div className="h-1 bg-muted" />
                <div className="p-4 space-y-3">
                  <div className="w-8 h-8 rounded-xl bg-muted" />
                  <div className="h-6 w-14 rounded bg-muted" />
                  <div className="h-3 w-20 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border bg-card p-5 animate-pulse space-y-3">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-48 rounded bg-muted" />
          </div>
        </div>
      ) : (
        <>
          {/* ── Section 1: KPI Cards ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
              subtitle={fmtPct(kpis.confRate) + " rate"}
              icon={CheckCircle2}
              colorBg="bg-emerald-100 dark:bg-emerald-900/30"
              colorIcon="text-emerald-600 dark:text-emerald-300"
              gradient="from-emerald-500 to-green-400"
              delay={50}
              pool={kpis.total}
            />
            <KPICard
              title="Delivered"
              value={kpis.delivered}
              subtitle={fmtPct(kpis.delRate) + " of shipped"}
              icon={Truck}
              colorBg="bg-blue-100 dark:bg-blue-900/30"
              colorIcon="text-blue-600 dark:text-blue-300"
              gradient="from-blue-500 to-cyan-400"
              delay={100}
              pool={kpis.shipped}
            />
            <KPICard
              title="Cancelled"
              value={kpis.cancelled}
              subtitle={fmtPct(kpis.cancelRate) + " rate"}
              icon={XCircle}
              colorBg="bg-red-100 dark:bg-red-900/30"
              colorIcon="text-red-600 dark:text-red-300"
              gradient="from-red-500 to-rose-400"
              delay={150}
              pool={kpis.total}
            />
            <KPICard
              title="Wrong Numbers"
              value={kpis.wrongNumber}
              subtitle={fmtPct(kpis.wrongNumberRate) + " rate"}
              icon={PhoneMissed}
              colorBg="bg-slate-100 dark:bg-slate-800/60"
              colorIcon="text-slate-500 dark:text-slate-400"
              gradient="from-slate-500 to-slate-400"
              delay={200}
              pool={kpis.total}
            />
            <KPICard
              title="Unreachable"
              value={kpis.unreachable}
              subtitle={fmtPct(kpis.unreachableRate) + " rate"}
              icon={PhoneOff}
              colorBg="bg-gray-100 dark:bg-gray-800/60"
              colorIcon="text-gray-500 dark:text-gray-400"
              gradient="from-gray-500 to-gray-400"
              delay={250}
              pool={kpis.total}
            />
          </div>

          {/* ── Section 2: Rate summary pills ────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Confirmation Rate", value: kpis.confRate, sub: `${kpis.confirmed} / ${kpis.total} orders`, icon: TrendingUp },
              { label: "Delivery Rate", value: kpis.delRate, sub: `${kpis.delivered} / ${kpis.shipped} shipped`, icon: Truck },
              { label: "Cancellation Rate", value: kpis.cancelRate, sub: `${kpis.cancelled} / ${kpis.total} orders`, icon: TrendingDown },
            ].map(({ label, value, sub, icon: Icon }) => (
              <div
                key={label}
                className="relative overflow-hidden rounded-2xl bg-card border border-border/60 shadow-sm p-5"
              >
                <div className={cn("absolute top-0 left-0 right-0 h-1 bg-gradient-to-r", rateGradient(value))} />
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 rounded-xl bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <Badge className={cn("text-xs font-semibold border-0", rateBadgeClass(value))}>
                    {value >= 70 ? "Excellent" : value >= 40 ? "Average" : "Low"}
                  </Badge>
                </div>
                <div className="text-4xl font-bold tracking-tight" style={{ color: rateColor(value) }}>
                  {fmtPct(value)}
                </div>
                <p className="text-sm font-medium text-foreground mt-1">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
                <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", rateGradient(value))}
                    style={{ width: `${Math.min(value, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ── Section 3: Product Performance Table ─────────────────────── */}
          {sortedProductRows.length > 0 && (
            <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 rounded-xl bg-violet-100 dark:bg-violet-900/30">
                  <Package className="h-4 w-4 text-violet-600 dark:text-violet-300" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Product Performance</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {sortedProductRows.length} product{sortedProductRows.length !== 1 ? "s" : ""} · click a row to see cancellation reasons
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-xs text-muted-foreground">
                      <th className="text-left py-2.5 w-7 font-semibold">#</th>
                      {(
                        [
                          { key: "name",      label: "Product",      align: "left"  },
                          { key: "total",     label: "Orders",       align: "right" },
                          { key: "confirmed", label: "Confirmed",    align: "right" },
                          { key: "confRate",  label: "Conf. Rate",   align: "right" },
                          { key: "delivered", label: "Delivered",    align: "right" },
                          { key: "delRate",   label: "Del. Rate",    align: "right" },
                          { key: "cancelled",    label: "Cancelled",      align: "right" },
                          { key: "wrongNumber",  label: "Wrong Numbers",  align: "right" },
                        ] as { key: ProductSortField; label: string; align: string }[]
                      ).map(({ key, label, align }) => (
                        <th
                          key={key}
                          className={cn(
                            "py-2.5 font-semibold cursor-pointer hover:text-foreground select-none",
                            align === "left" ? "text-left pr-4" : "text-right px-3",
                            (key === "confRate" || key === "delRate") && "min-w-[120px]",
                          )}
                          onClick={() => toggleSort(key)}
                        >
                          {label} <SortIcon field={key} active={productSort} dir={productSortDir} />
                        </th>
                      ))}
                      <th className="py-2.5 w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProductRows.map((row, i) => {
                      const isExpanded = expandedProduct === row.name;
                      return (
                        <React.Fragment key={row.name}>
                          <tr
                            className={cn(
                              "border-b border-border/40 transition-colors cursor-pointer",
                              isExpanded
                                ? "bg-muted/60 border-b-0"
                                : "hover:bg-muted/30"
                            )}
                            onClick={() => setExpandedProduct(isExpanded ? null : row.name)}
                          >
                            <td className="py-2.5 text-xs text-muted-foreground font-medium">{i + 1}</td>
                            <td className="py-2.5 pr-4">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: rateColor(row.confRate) }} />
                                <span className="font-medium text-sm leading-tight">{row.name}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                              {row.total.toLocaleString()}
                            </td>
                            {/* Confirmed */}
                            <td className="py-2.5 px-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                              {row.confirmed.toLocaleString()}
                            </td>
                            {/* Conf rate */}
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="w-10 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${Math.min(row.confRate, 100)}%`, backgroundColor: rateColor(row.confRate) }} />
                                </div>
                                <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[42px] text-center", rateBadgeClass(row.confRate))}>
                                  {fmtPct(row.confRate)}
                                </span>
                              </div>
                            </td>
                            {/* Delivered */}
                            <td className="py-2.5 px-3 text-right tabular-nums text-blue-600 dark:text-blue-400 font-medium">
                              {row.delivered.toLocaleString()}
                            </td>
                            {/* Del rate */}
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="w-10 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${Math.min(row.delRate, 100)}%`, backgroundColor: rateColor(row.delRate) }} />
                                </div>
                                <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[42px] text-center", rateBadgeClass(row.delRate))}>
                                  {fmtPct(row.delRate)}
                                </span>
                              </div>
                            </td>
                            {/* Cancelled */}
                            <td className="py-2.5 px-3 text-right tabular-nums text-red-600 dark:text-red-400 font-medium">
                              {row.cancelled.toLocaleString()}
                            </td>
                            {/* Wrong Numbers */}
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400 font-medium">
                              {row.wrongNumber > 0 ? row.wrongNumber.toLocaleString() : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            {/* Expand icon */}
                            <td className="py-2.5 pl-2 text-right">
                              {row.cancelled > 0 && (
                                <ChevronRight
                                  className={cn(
                                    "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                                    isExpanded && "rotate-90"
                                  )}
                                />
                              )}
                            </td>
                          </tr>

                          {/* ── Expanded: cancellation reasons for this product ── */}
                          {isExpanded && row.cancelled > 0 && (
                            <tr className="border-b border-border/40">
                              <td colSpan={10} className="px-4 pt-2 pb-4 bg-muted/40">
                                <div className="flex items-center gap-2 mb-3">
                                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                    Cancellation Reasons — {row.name}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {row.reasons.map(({ reason, count, pct: p }, ri) => (
                                    <div
                                      key={reason}
                                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border/60 bg-card text-xs"
                                    >
                                      <span
                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: REASON_COLORS[ri % REASON_COLORS.length] }}
                                      />
                                      <span className="font-medium text-foreground">{reason}</span>
                                      <span className="text-muted-foreground">{count}</span>
                                      <span
                                        className="font-bold tabular-nums"
                                        style={{ color: REASON_COLORS[ri % REASON_COLORS.length] }}
                                      >
                                        {fmtPct(p)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                {/* Mini bar chart for reasons */}
                                {row.reasons.length > 1 && (
                                  <div className="mt-3 space-y-1.5">
                                    {row.reasons.map(({ reason, pct: p }, ri) => (
                                      <div key={reason} className="flex items-center gap-2">
                                        <span className="text-[11px] text-muted-foreground w-36 truncate flex-shrink-0">{reason}</span>
                                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                          <div
                                            className="h-full rounded-full transition-all duration-500"
                                            style={{ width: `${Math.min(p, 100)}%`, backgroundColor: REASON_COLORS[ri % REASON_COLORS.length] }}
                                          />
                                        </div>
                                        <span className="text-[11px] font-semibold tabular-nums w-10 text-right" style={{ color: REASON_COLORS[ri % REASON_COLORS.length] }}>
                                          {fmtPct(p)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {sortedProductRows.length > 10 && (
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
                      <><ChevronRight className="h-3.5 w-3.5" /> Show All {sortedProductRows.length} Products</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Section 4: Global Cancellation Reasons ───────────────────── */}
          {globalReasons.length > 0 && (
            <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 rounded-xl bg-red-100 dark:bg-red-900/30">
                  <XCircle className="h-4 w-4 text-red-600 dark:text-red-300" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Cancellation Reasons</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {kpis.cancelled} cancelled orders · all products combined
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {(showAllReasons ? globalReasons : globalReasons.slice(0, 5)).map(({ reason, count, pct: p }, i) => (
                  <div key={reason} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: REASON_COLORS[i % REASON_COLORS.length] }}
                        />
                        <span className="font-medium text-foreground truncate">{reason}</span>
                      </div>
                      <div className="flex items-center gap-3 tabular-nums flex-shrink-0 ml-3">
                        <span className="text-muted-foreground">{count} orders</span>
                        <span
                          className="font-bold w-11 text-right"
                          style={{ color: REASON_COLORS[i % REASON_COLORS.length] }}
                        >
                          {fmtPct(p)}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(p, 100)}%`, backgroundColor: REASON_COLORS[i % REASON_COLORS.length] }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {globalReasons.length > 5 && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => setShowAllReasons((v) => !v)}
                  >
                    {showAllReasons ? (
                      <><ChevronUp className="h-3.5 w-3.5" /> Show Less</>
                    ) : (
                      <><ChevronRight className="h-3.5 w-3.5" /> Show All {globalReasons.length} Reasons</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Empty state ───────────────────────────────────────────────── */}
          {filteredOrders.length === 0 && (
            <div className="rounded-2xl bg-card border border-border/60 p-16 text-center">
              <div className="w-12 h-12 rounded-2xl bg-muted mx-auto flex items-center justify-center mb-4">
                <Package className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">No orders match the selected filters.</p>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting the date range or product filter.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
