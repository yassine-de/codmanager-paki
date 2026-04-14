import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { KPICard } from "@/components/KPICard";
import { ShoppingCart, CheckCircle2, Truck, Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { supabase } from "@/integrations/supabase/client";

export default function SellerAnalytics() {
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["seller-analytics-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, confirmation_status, delivery_status, product_name, seller_id, price, quantity, created_at, delivered_at")
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

  const profileNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach(p => { map[p.user_id] = p.name; });
    return map;
  }, [profiles]);

  const sellerOptions = useMemo(() => {
    const ids = new Set(orders.map(o => o.seller_id));
    return [...ids].map(id => ({ value: id, label: profileNameMap[id] || id.slice(0, 8) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, profileNameMap]);

  const filteredOrders = useMemo(() => {
    let filtered = [...orders];
    if (sellerFilter !== "all") filtered = filtered.filter(o => o.seller_id === sellerFilter);
    if (dateRange?.from) filtered = filtered.filter(o => new Date(o.created_at) >= dateRange.from!);
    if (dateRange?.to) filtered = filtered.filter(o => new Date(o.created_at) <= dateRange.to!);
    return filtered;
  }, [orders, sellerFilter, dateRange]);

  const deliveredStatuses = ["delivered", "paid"];
  const shippedStatuses = ["shipped", "in_transit", "with_courier", "delivered", "paid", "returned"];

  const stats = useMemo(() => {
    const total = filteredOrders.length;
    const confirmed = filteredOrders.filter(o => o.confirmation_status === "confirmed").length;
    // Shipped = all orders that left warehouse (in transit + delivered + returned)
    const shipped = filteredOrders.filter(o => o.delivery_status && shippedStatuses.includes(o.delivery_status)).length;
    // Delivered = successfully received by customer
    const delivered = filteredOrders.filter(o => o.delivery_status && deliveredStatuses.includes(o.delivery_status)).length;
    return { total, confirmed, shipped, delivered };
  }, [filteredOrders]);

  // Top sellers by orders
  const topSellersByOrders = useMemo(() => {
    const days = 16;
    const rangeFrom = dateRange?.from || subDays(new Date(), days);
    const rangeTo = dateRange?.to || new Date();

    const dayLabels: string[] = [];
    let cur = startOfDay(rangeFrom);
    const end = endOfDay(rangeTo);
    while (cur <= end) {
      dayLabels.push(format(cur, "MMM d"));
      cur = new Date(cur.getTime() + 86400000);
    }

    const sellerIds = sellerFilter !== "all" ? [sellerFilter] : [...new Set(orders.map(o => o.seller_id))];
    const sellerDailyMap: Record<string, Record<string, number>> = {};

    sellerIds.forEach(id => {
      sellerDailyMap[id] = {};
      dayLabels.forEach(d => { sellerDailyMap[id][d] = 0; });
    });

    orders.forEach(o => {
      if (sellerFilter !== "all" && o.seller_id !== sellerFilter) return;
      const d = new Date(o.created_at);
      if (d >= startOfDay(rangeFrom) && d <= endOfDay(rangeTo)) {
        const label = format(d, "MMM d");
        if (sellerDailyMap[o.seller_id]?.[label] !== undefined) {
          sellerDailyMap[o.seller_id][label]++;
        }
      }
    });

    const sellerTotals = Object.entries(sellerDailyMap).map(([id, days]) => ({
      name: profileNameMap[id] || id.slice(0, 8),
      total: Object.values(days).reduce((a, b) => a + b, 0),
    })).sort((a, b) => b.total - a.total);

    return { sellers: sellerTotals };
  }, [orders, sellerFilter, dateRange, profileNameMap]);

  // Top products by orders
  const topProductsByOrders = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOrders.forEach(o => {
      const name = o.product_name || "Unknown";
      map[name] = (map[name] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredOrders]);

  // Top sellers by LTV
  const topSellersByLTV = useMemo(() => {
    const map: Record<string, { revenue: number; orders: number; delivered: number }> = {};
    filteredOrders.forEach(o => {
      const id = o.seller_id;
      if (!map[id]) map[id] = { revenue: 0, orders: 0, delivered: 0 };
      map[id].orders++;
      if (o.delivery_status && deliveredStatuses.includes(o.delivery_status)) {
        map[id].revenue += o.price * o.quantity;
        map[id].delivered++;
      }
    });
    return Object.entries(map)
      .map(([id, d]) => ({ name: profileNameMap[id] || id.slice(0, 8), revenue: d.revenue, orders: d.orders, delivered: d.delivered }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredOrders, profileNameMap]);

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
        <h1 className="text-2xl font-semibold">Seller Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Seller performance & product insights</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-lg border p-4">
        <SearchableSelect value={sellerFilter} onValueChange={setSellerFilter}
          options={sellerOptions} placeholder="Seller" allLabel="All Sellers" className="w-[180px]" />
        <DatePresetFilter dateRange={dateRange} onDateRangeChange={setDateRange} preset={datePreset} onPresetChange={setDatePreset} />
        {(sellerFilter !== "all" || dateRange) && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setSellerFilter("all"); setDatePreset("maximum"); setDateRange(undefined); }}>
            Clear
          </Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Total Orders" value={stats.total} icon={ShoppingCart} iconBg="bg-info/10" iconColor="text-info" delay={0} />
        <KPICard title="Confirmed" value={stats.confirmed} subtitle={`${stats.total > 0 ? Math.round((stats.confirmed / stats.total) * 100) : 0}%`} icon={CheckCircle2} iconBg="bg-success/10" iconColor="text-success" delay={50} />
        <KPICard title="Shipped" value={stats.shipped} icon={Package} iconBg="bg-primary/10" iconColor="text-primary" delay={100} />
        <KPICard title="Delivered" value={stats.delivered} subtitle={`${stats.confirmed > 0 ? Math.round((stats.delivered / stats.confirmed) * 100) : 0}%`} icon={Truck} iconBg="bg-success/10" iconColor="text-success" delay={150} />
      </div>

      {/* Top Sellers by Orders */}
      <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '100ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-5">
          Top Sellers by Orders {!dateRange ? "(Last 16 Days)" : ""}
        </h2>
        <div className="space-y-3">
          {topSellersByOrders.sellers.map((s, i) => {
            const maxOrders = topSellersByOrders.sellers[0]?.total || 1;
            const pct = Math.round((s.total / maxOrders) * 100);
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
            return (
              <div key={s.name} className={cn(
                "relative flex items-center gap-4 rounded-xl border p-4 transition-all hover:shadow-md",
                i === 0 ? "bg-warning/5 border-warning/20" : "bg-muted/30"
              )}>
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-background border-2 flex items-center justify-center text-sm font-bold"
                  style={{ borderColor: chartColors[i % chartColors.length] }}>
                  {medal || i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sm truncate">{s.name}</span>
                    <span className="text-sm font-bold tabular-nums ml-2">{s.total} <span className="text-xs text-muted-foreground font-normal">orders</span></span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: chartColors[i % chartColors.length] }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products by Orders */}
        {topProductsByOrders.length > 0 && (
          <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Products by Orders</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topProductsByOrders} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" width={120} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} name="Units" fill="hsl(var(--primary))">
                  {topProductsByOrders.map((_, i) => (
                    <Cell key={i} fill={chartColors[i % chartColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top Sellers by LTV */}
        {topSellersByLTV.length > 0 && (
          <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '200ms' }}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Sellers by Revenue (LTV)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topSellersByLTV} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={110} />
                <Tooltip formatter={(v: number) => `${v.toLocaleString()} PKR`} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]} name="Revenue (PKR)">
                  {topSellersByLTV.map((_, i) => (
                    <Cell key={i} fill={chartColors[i % chartColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 space-y-2">
              {topSellersByLTV.map((s, i) => (
                <div key={s.name} className="flex items-center justify-between text-xs border-b last:border-0 pb-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold",
                      i === 0 ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"
                    )}>{i + 1}</span>
                    <span className="font-medium">{s.name}</span>
                  </div>
                  <div className="flex gap-4 text-muted-foreground">
                    <span>{s.delivered} delivered</span>
                    <span className="font-semibold text-foreground">{s.revenue.toLocaleString()} PKR</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
