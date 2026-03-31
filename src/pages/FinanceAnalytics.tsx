import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { KPICard } from "@/components/KPICard";
import { Truck, DollarSign, Package, TrendingUp, ChevronDown, CheckCircle2, Wallet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { supabase } from "@/integrations/supabase/client";

const CONFIRMATION_RATE = 0.35; // $0.35 per confirmed order
const COD_FEE_RATE = 0.05; // 5% COD fees

export default function FinanceAnalytics() {
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["finance-analytics-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, confirmation_status, delivery_status, product_name, seller_id, price, quantity, shipping_cost, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch seller rates for shipping fee calc
  const { data: sellerRatesData = [] } = useQuery({
    queryKey: ["seller-rates-finance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("seller_rates").select("*");
      if (error) throw error;
      return data;
    },
  });

  // Fetch sourcing requests
  const { data: sourcingRequests = [] } = useQuery({
    queryKey: ["finance-sourcing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sourcing_requests")
        .select("id, seller_id, product_name, quantity, unit_price, shipping_cost, total_price, created_at");
      if (error) throw error;
      return data;
    },
  });

  const profileNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach(p => { map[p.user_id] = p.name; });
    return map;
  }, [profiles]);

  const sellerOptions = useMemo(() => {
    const ids = new Set([...orders.map(o => o.seller_id), ...sourcingRequests.map(s => s.seller_id)]);
    return [...ids].map(id => ({ value: id, label: profileNameMap[id] || id.slice(0, 8) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, sourcingRequests, profileNameMap]);

  const productOptions = useMemo(() => {
    const names = new Set([...orders.map(o => o.product_name).filter(Boolean), ...sourcingRequests.map(s => s.product_name).filter(Boolean)]);
    return [...names].map(n => ({ value: n, label: n })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, sourcingRequests]);

  const filteredOrders = useMemo(() => {
    let filtered = [...orders];
    if (sellerFilter !== "all") filtered = filtered.filter(o => o.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(o => o.product_name === productFilter);
    if (dateRange?.from) filtered = filtered.filter(o => new Date(o.created_at) >= dateRange.from!);
    if (dateRange?.to) filtered = filtered.filter(o => new Date(o.created_at) <= dateRange.to!);
    return filtered;
  }, [orders, sellerFilter, productFilter, dateRange]);

  const filteredSourcing = useMemo(() => {
    let filtered = [...sourcingRequests];
    if (sellerFilter !== "all") filtered = filtered.filter(r => r.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(r => r.product_name === productFilter);
    if (dateRange?.from) filtered = filtered.filter(r => new Date(r.created_at) >= dateRange.from!);
    if (dateRange?.to) filtered = filtered.filter(r => new Date(r.created_at) <= dateRange.to!);
    return filtered;
  }, [sourcingRequests, sellerFilter, productFilter, dateRange]);

  // Shipping stats — shipped orders generate shipping revenue
  const shippedOrders = useMemo(() => {
    return filteredOrders.filter(o => o.delivery_status && ["shipped", "pending", "delivered"].includes(o.delivery_status));
  }, [filteredOrders]);

  // Shipping revenue = sum of shipping_cost from shipped orders
  const shippingRevenue = useMemo(() => {
    return shippedOrders.reduce((sum, o) => sum + (o.shipping_cost || 0), 0);
  }, [shippedOrders]);

  // Confirmation stats
  const confirmationStats = useMemo(() => {
    const confirmed = filteredOrders.filter(o => o.confirmation_status === "confirmed");
    const count = confirmed.length;
    const profit = count * CONFIRMATION_RATE;
    return { count, profit, rate: CONFIRMATION_RATE };
  }, [filteredOrders]);

  // COD fees (5% of delivered revenue)
  const codStats = useMemo(() => {
    const deliveredOrders = filteredOrders.filter(o => o.delivery_status === "delivered");
    const deliveredRevenue = deliveredOrders.reduce((sum, o) => sum + (o.price * o.quantity), 0);
    const codFees = deliveredRevenue * COD_FEE_RATE;
    return { deliveredRevenue, codFees, deliveredCount: deliveredOrders.length };
  }, [filteredOrders]);

  // Sourcing stats
  const sourcingStats = useMemo(() => {
    const totalUnits = filteredSourcing.reduce((s, r) => s + r.quantity, 0);
    const totalCost = filteredSourcing.reduce((s, r) => s + (r.total_price || 0), 0);
    const estimatedRevenue = totalCost * 1.3;
    const profit = estimatedRevenue - totalCost;
    return { totalUnits, totalCost, profit };
  }, [filteredSourcing]);

  const totalProfit = shippingRevenue + confirmationStats.profit + codStats.codFees + sourcingStats.profit;

  // Top profit by seller
  const profitBySeller = useMemo(() => {
    const map: Record<string, { shippingProfit: number; codProfit: number; sourcingProfit: number }> = {};

    filteredOrders.forEach(o => {
      const id = o.seller_id;
      if (!map[id]) map[id] = { shippingProfit: 0, codProfit: 0, sourcingProfit: 0 };
      if (o.delivery_status && ["shipped", "pending", "delivered"].includes(o.delivery_status)) {
        map[id].shippingProfit += (o.shipping_cost || 0);
      }
      if (o.delivery_status === "delivered") {
        map[id].codProfit += (o.price * o.quantity) * COD_FEE_RATE;
      }
    });

    filteredSourcing.forEach(r => {
      const id = r.seller_id;
      if (!map[id]) map[id] = { shippingProfit: 0, codProfit: 0, sourcingProfit: 0 };
      map[id].sourcingProfit += (r.total_price || 0) * 0.3;
    });

    return Object.entries(map)
      .map(([id, d]) => ({
        name: profileNameMap[id] || id.slice(0, 8),
        total: Math.round(d.shippingProfit + d.codProfit + d.sourcingProfit),
        shipping: Math.round(d.shippingProfit),
        cod: Math.round(d.codProfit),
        sourcing: Math.round(d.sourcingProfit),
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredOrders, filteredSourcing, profileNameMap]);

  // Top profit by product
  const profitByProduct = useMemo(() => {
    const map: Record<string, { revenue: number; count: number }> = {};
    filteredOrders.forEach(o => {
      if (o.delivery_status === "delivered") {
        const name = o.product_name || "Unknown";
        if (!map[name]) map[name] = { revenue: 0, count: 0 };
        map[name].revenue += o.price * o.quantity;
        map[name].count += o.quantity;
      }
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, revenue: d.revenue, count: d.count }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredOrders]);

  const chartColors = ['hsl(var(--primary))', 'hsl(155, 50%, 42%)', 'hsl(38, 90%, 55%)', 'hsl(0, 65%, 52%)', 'hsl(220, 70%, 55%)'];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold">Finance</h1>
        <p className="text-muted-foreground text-sm mt-1">Shipping revenue, COD fees, sourcing profit & financial overview</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-lg border p-4">
        <SearchableSelect value={sellerFilter} onValueChange={setSellerFilter}
          options={sellerOptions} placeholder="Seller" allLabel="All Sellers" className="w-[180px]" />
        <SearchableSelect value={productFilter} onValueChange={setProductFilter}
          options={productOptions} placeholder="Product" allLabel="All Products" className="w-[180px]" />
        <DatePresetFilter dateRange={dateRange} onDateRangeChange={setDateRange} preset={datePreset} onPresetChange={setDatePreset} />
        {(sellerFilter !== "all" || productFilter !== "all" || dateRange) && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setSellerFilter("all"); setProductFilter("all"); setDatePreset("maximum"); setDateRange(undefined); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Total Profit Hero */}
      <div className="bg-gradient-to-br from-primary/10 via-card to-success/10 rounded-xl border-2 border-primary/20 p-6 animate-slide-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-primary/15">
            <Wallet className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground font-medium">Total Revenue</p>
            <p className="text-3xl font-bold tabular-nums tracking-tight">{totalProfit.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} PKR</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Shipping</p>
            <p className="text-lg font-bold tabular-nums">{shippingRevenue.toLocaleString()} PKR</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{shippedOrders.length} orders</p>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Confirmation</p>
            <p className="text-lg font-bold tabular-nums">${confirmationStats.profit.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{confirmationStats.count} × ${CONFIRMATION_RATE}</p>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">COD Fees (5%)</p>
            <p className="text-lg font-bold tabular-nums">{codStats.codFees.toLocaleString(undefined, { minimumFractionDigits: 2 })} PKR</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{codStats.deliveredCount} delivered orders</p>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Sourcing</p>
            <p className="text-lg font-bold tabular-nums">{sourcingStats.profit.toLocaleString()} PKR</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{sourcingStats.totalUnits} units · 30% margin</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard title="Shipped Orders" value={shippedOrders.length} icon={Truck} iconBg="bg-primary/10" iconColor="text-primary" delay={0} />
        <KPICard title="Shipping Revenue" value={`${shippingRevenue.toLocaleString()} PKR`} icon={DollarSign} iconBg="bg-success/10" iconColor="text-success" delay={50} />
        <KPICard title="Confirmed Orders" value={confirmationStats.count} subtitle={`$${confirmationStats.profit.toFixed(2)} profit`} icon={CheckCircle2} iconBg="bg-info/10" iconColor="text-info" delay={75} />
        <KPICard title="COD Fees" value={`${codStats.codFees.toFixed(2)} PKR`} subtitle={`5% of ${codStats.deliveredRevenue.toLocaleString()} PKR`} icon={DollarSign} iconBg="bg-warning/10" iconColor="text-warning" delay={100} />
        <KPICard title="Sourcing Profit" value={`${sourcingStats.profit.toLocaleString()} PKR`} subtitle="~30% margin" icon={TrendingUp} iconBg="bg-success/10" iconColor="text-success" delay={150} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Profit by Seller */}
        {profitBySeller.length > 0 && (
          <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '100ms' }}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Revenue by Seller</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={profitBySeller} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${v} PKR`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={110} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toLocaleString()} PKR`, name]}
                  contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }}
                />
                <Bar dataKey="shipping" stackId="a" name="Shipping" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
                <Bar dataKey="cod" stackId="a" name="COD Fees" fill="hsl(38, 90%, 55%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="sourcing" stackId="a" name="Sourcing" fill="hsl(155, 50%, 42%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 flex gap-4 text-xs">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(var(--primary))' }} /> Shipping</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(38, 90%, 55%)' }} /> COD Fees</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(155, 50%, 42%)' }} /> Sourcing</div>
            </div>
          </div>
        )}

        {/* Top Revenue by Product */}
        <ProductRevenueChart data={profitByProduct} chartColors={chartColors} />
      </div>
    </div>
  );
}

function ProductRevenueChart({ data, chartColors }: { data: { name: string; revenue: number; count: number }[]; chartColors: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleData = showAll ? data : data.slice(0, 6);
  const hasMore = data.length > 6;

  if (data.length === 0) {
    return (
      <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Revenue by Product</h2>
        <p className="text-muted-foreground text-sm text-center py-10">No delivered orders yet</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Revenue by Product</h2>
      <ResponsiveContainer width="100%" height={visibleData.length * 44 + 30}>
        <BarChart data={visibleData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={120} />
          <Tooltip formatter={(v: number) => `${v.toLocaleString()} PKR`} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} name="Revenue (PKR)">
            {visibleData.map((_, i) => (
              <Cell key={i} fill={chartColors[i % chartColors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hasMore && (
        <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll(!showAll)}>
          <ChevronDown className={cn("w-3.5 h-3.5 mr-1 transition-transform", showAll && "rotate-180")} />
          {showAll ? "Show less" : `Show ${data.length - 6} more products`}
        </Button>
      )}
    </div>
  );
}
