import { mockOrders, sellerNames, productNames } from "@/lib/data";
import { mockSourcingRequests } from "@/lib/sourcing-data";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { KPICard } from "@/components/KPICard";
import { Truck, DollarSign, Package, TrendingUp, ChevronDown, CheckCircle2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";

const SHIPPING_RATE = 1.5;

export default function FinanceAnalytics() {
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  // Filtered orders for shipping
  const filteredOrders = useMemo(() => {
    let orders = [...mockOrders];
    if (sellerFilter !== "all") orders = orders.filter(o => o.seller === sellerFilter);
    if (productFilter !== "all") orders = orders.filter(o => o.products.some(p => p.name === productFilter));
    if (dateRange?.from) orders = orders.filter(o => new Date(o.createdAt) >= dateRange.from!);
    if (dateRange?.to) orders = orders.filter(o => new Date(o.createdAt) <= dateRange.to!);
    return orders;
  }, [sellerFilter, productFilter, dateRange]);

  // Filtered sourcing
  const filteredSourcing = useMemo(() => {
    let reqs = [...mockSourcingRequests];
    if (sellerFilter !== "all") reqs = reqs.filter(r => r.seller === sellerFilter);
    if (productFilter !== "all") reqs = reqs.filter(r => r.productName === productFilter);
    if (dateRange?.from) reqs = reqs.filter(r => new Date(r.createdAt) >= dateRange.from!);
    if (dateRange?.to) reqs = reqs.filter(r => new Date(r.createdAt) <= dateRange.to!);
    return reqs;
  }, [sellerFilter, productFilter, dateRange]);

  // Shipping stats
  const shippedOrders = useMemo(() => {
    return filteredOrders.filter(o => ['shipped', 'in_transit', 'with_courier', 'delivered', 'returned'].includes(o.status));
  }, [filteredOrders]);

  const shippingRevenue = shippedOrders.length * SHIPPING_RATE;

  // Confirmation stats
  const confirmationStats = useMemo(() => {
    const confirmed = filteredOrders.filter(o => ['confirmed', 'shipped', 'delivered', 'in_transit', 'with_courier'].includes(o.status));
    const count = confirmed.length;
    const CONFIRMATION_RATE = 0.35; // $0.35 per confirmed order
    const profit = count * CONFIRMATION_RATE;
    return { count, profit, rate: CONFIRMATION_RATE };
  }, [filteredOrders]);

  // Sourcing stats
  const sourcingStats = useMemo(() => {
    const totalUnits = filteredSourcing.reduce((s, r) => s + r.quantity, 0);
    const totalCost = filteredSourcing.reduce((s, r) => s + r.totalPrice, 0);
    const estimatedRevenue = totalCost * 1.3;
    const profit = estimatedRevenue - totalCost;
    return { totalUnits, totalCost, profit };
  }, [filteredSourcing]);

  // Total profit
  const totalProfit = shippingRevenue + confirmationStats.profit + sourcingStats.profit;

  // Top profit by seller
  const profitBySeller = useMemo(() => {
    const map: Record<string, { shippingProfit: number; sourcingProfit: number }> = {};

    // Shipping profit by seller
    filteredOrders.forEach(o => {
      if (!map[o.seller]) map[o.seller] = { shippingProfit: 0, sourcingProfit: 0 };
      if (['shipped', 'in_transit', 'with_courier', 'delivered', 'returned'].includes(o.status)) {
        map[o.seller].shippingProfit += SHIPPING_RATE;
      }
    });

    // Sourcing profit by seller
    filteredSourcing.forEach(r => {
      if (!map[r.seller]) map[r.seller] = { shippingProfit: 0, sourcingProfit: 0 };
      map[r.seller].sourcingProfit += r.totalPrice * 0.3; // 30% margin
    });

    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        total: Math.round(d.shippingProfit + d.sourcingProfit),
        shipping: Math.round(d.shippingProfit),
        sourcing: Math.round(d.sourcingProfit),
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredOrders, filteredSourcing]);

  // Top profit by product
  const profitByProduct = useMemo(() => {
    const map: Record<string, { revenue: number; count: number }> = {};

    filteredOrders.forEach(o => {
      if (o.status === 'delivered') {
        o.products.forEach(p => {
          if (!map[p.name]) map[p.name] = { revenue: 0, count: 0 };
          map[p.name].revenue += p.qty * p.price;
          map[p.name].count += p.qty;
        });
      }
    });

    // Add sourcing cost offset
    filteredSourcing.forEach(r => {
      if (!map[r.productName]) map[r.productName] = { revenue: 0, count: 0 };
      map[r.productName].count += r.quantity;
    });

    return Object.entries(map)
      .map(([name, d]) => ({ name, revenue: d.revenue, count: d.count }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredOrders, filteredSourcing]);

  const chartColors = ['hsl(var(--primary))', 'hsl(155, 50%, 42%)', 'hsl(38, 90%, 55%)', 'hsl(0, 65%, 52%)', 'hsl(220, 70%, 55%)'];

  const sourcingProductNames = [...new Set(mockSourcingRequests.map(r => r.productName))];
  const allProducts = [...new Set([...productNames, ...sourcingProductNames])];

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold">Finance</h1>
        <p className="text-muted-foreground text-sm mt-1">Shipping revenue, sourcing profit & financial overview</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-lg border p-4">
        <SearchableSelect
          value={sellerFilter}
          onValueChange={setSellerFilter}
          options={sellerNames.map(s => ({ value: s, label: s }))}
          placeholder="Seller"
          allLabel="All Sellers"
          className="w-[180px]"
        />
        <SearchableSelect
          value={productFilter}
          onValueChange={setProductFilter}
          options={allProducts.map(p => ({ value: p, label: p }))}
          placeholder="Product"
          allLabel="All Products"
          className="w-[180px]"
        />
        <DatePresetFilter
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          preset={datePreset}
          onPresetChange={setDatePreset}
        />
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
            <p className="text-sm text-muted-foreground font-medium">Total Profit</p>
            <p className="text-3xl font-bold tabular-nums tracking-tight">${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Shipping</p>
            <p className="text-lg font-bold tabular-nums">${shippingRevenue.toLocaleString(undefined, { minimumFractionDigits: 1 })}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{shippedOrders.length} orders × ${SHIPPING_RATE}</p>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Confirmation</p>
            <p className="text-lg font-bold tabular-nums">${confirmationStats.profit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{confirmationStats.count} orders × ${confirmationStats.rate}</p>
          </div>
          <div className="bg-background/60 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Sourcing</p>
            <p className="text-lg font-bold tabular-nums">{sourcingStats.profit.toLocaleString()} MAD</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{sourcingStats.totalUnits} units · 30% margin</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KPICard
          title="Shipped Orders"
          value={shippedOrders.length}
          icon={Truck}
          iconBg="bg-primary/10"
          iconColor="text-primary"
          delay={0}
        />
        <KPICard
          title="Shipping Revenue"
          value={`$${shippingRevenue.toLocaleString(undefined, { minimumFractionDigits: 1 })}`}
          subtitle={`${shippedOrders.length} × $${SHIPPING_RATE}`}
          icon={DollarSign}
          iconBg="bg-success/10"
          iconColor="text-success"
          delay={50}
        />
        <KPICard
          title="Confirmed Orders"
          value={confirmationStats.count}
          subtitle={`$${confirmationStats.profit.toFixed(2)} profit`}
          icon={CheckCircle2}
          iconBg="bg-info/10"
          iconColor="text-info"
          delay={75}
        />
        <KPICard
          title="Sourced Units"
          value={sourcingStats.totalUnits.toLocaleString()}
          icon={Package}
          iconBg="bg-info/10"
          iconColor="text-info"
          delay={100}
        />
        <KPICard
          title="Sourcing Profit"
          value={`${sourcingStats.profit.toLocaleString()} MAD`}
          subtitle="~30% margin"
          icon={TrendingUp}
          iconBg="bg-success/10"
          iconColor="text-success"
          delay={150}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Profit by Seller */}
        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '100ms' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Profit by Seller</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={profitBySeller} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${v}`} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={110} />
              <Tooltip
                formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }}
              />
              <Bar dataKey="shipping" stackId="a" name="Shipping" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
              <Bar dataKey="sourcing" stackId="a" name="Sourcing" fill="hsl(155, 50%, 42%)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 flex gap-4 text-xs">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(var(--primary))' }} /> Shipping</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(155, 50%, 42%)' }} /> Sourcing</div>
          </div>
        </div>

        {/* Top Profit by Product */}
        <ProductRevenueChart data={profitByProduct} chartColors={chartColors} />
      </div>
    </div>
  );
}

function ProductRevenueChart({ data, chartColors }: { data: { name: string; revenue: number; count: number }[]; chartColors: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const visibleData = showAll ? data : data.slice(0, 6);
  const hasMore = data.length > 6;

  return (
    <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Revenue by Product</h2>
      <ResponsiveContainer width="100%" height={visibleData.length * 44 + 30}>
        <BarChart data={visibleData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={120} />
          <Tooltip formatter={(v: number) => `${v.toLocaleString()} MAD`} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
          <Bar dataKey="revenue" radius={[0, 4, 4, 0]} name="Revenue (MAD)">
            {visibleData.map((_, i) => (
              <Cell key={i} fill={chartColors[i % chartColors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowAll(!showAll)}
        >
          <ChevronDown className={cn("w-3.5 h-3.5 mr-1 transition-transform", showAll && "rotate-180")} />
          {showAll ? "Show less" : `Show ${data.length - 6} more products`}
        </Button>
      )}
    </div>
  );
}
