import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { KPICard } from "@/components/KPICard";
import { Truck, Package, CheckCircle2, XCircle, PhoneOff, Clock, AlertTriangle, RotateCcw, Navigation, Users, MapPin, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";

const rateColor = (rate: number) => rate >= 70 ? 'hsl(155, 50%, 42%)' : rate >= 40 ? 'hsl(38, 90%, 55%)' : 'hsl(0, 65%, 52%)';
const rateBadge = (rate: number) => rate >= 70 ? "bg-success/10 text-success" : rate >= 40 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive";

export default function DeliveryAnalytics() {
  const [sellerFilter, setSellerFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [expandedCity, setExpandedCity] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["delivery-analytics-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, confirmation_status, delivery_status, product_name, seller_id, agent_id, original_agent_id, customer_city, created_at, confirmed_at, delivered_at, shipping_status")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Collect order_ids that need shipped_at or delivered_at from history
      const needsShippedAt = (data || []).filter(o => 
        o.delivery_status && ['shipped','in_transit','with_courier','delivered','paid','returned'].includes(o.delivery_status)
      ).map(o => o.order_id);

      const needsDeliveredAt = (data || [])
        .filter(o => (o.delivery_status === 'delivered' || o.delivery_status === 'paid') && !o.delivered_at)
        .map(o => o.order_id);

      const allNeeded = [...new Set([...needsShippedAt, ...needsDeliveredAt])];

      let shippedDateMap: Record<string, string> = {};
      let deliveryDateMap: Record<string, string> = {};

      if (allNeeded.length > 0) {
        const { data: historyData } = await supabase
          .from("order_history")
          .select("order_id, created_at, new_value")
          .in("order_id", allNeeded)
          .eq("field_changed", "delivery_status")
          .in("new_value", ["shipped", "delivered"])
          .order("created_at", { ascending: true });
        if (historyData) {
          historyData.forEach(h => {
            if (h.new_value === 'shipped' && !shippedDateMap[h.order_id]) {
              shippedDateMap[h.order_id] = h.created_at;
            }
            if (h.new_value === 'delivered' && !deliveryDateMap[h.order_id]) {
              deliveryDateMap[h.order_id] = h.created_at;
            }
          });
        }
      }

      // Enrich orders with shipped_at and fallback delivered_at
      return (data || []).map(o => ({
        ...o,
        shipped_at: shippedDateMap[o.order_id] || null,
        delivered_at: o.delivered_at || deliveryDateMap[o.order_id] || null,
      }));
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

  const productOptions = useMemo(() => {
    const names = new Set(orders.map(o => o.product_name).filter(Boolean));
    return [...names].map(n => ({ value: n, label: n })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let filtered = [...orders];
    if (sellerFilter !== "all") filtered = filtered.filter(o => o.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(o => o.product_name === productFilter);
    if (dateRange?.from) filtered = filtered.filter(o => new Date(o.created_at) >= dateRange.from!);
    if (dateRange?.to) filtered = filtered.filter(o => new Date(o.created_at) <= dateRange.to!);
    return filtered;
  }, [orders, sellerFilter, productFilter, dateRange]);

  // Accurate delivery status definitions
  const inTransitStatuses = ["shipped", "in_transit", "with_courier"];
  const deliveredStatuses = ["delivered", "paid"];
  const allShippedStatuses = [...inTransitStatuses, ...deliveredStatuses, "returned"];

  const stats = useMemo(() => {
    // Confirmed = base for delivery rate
    const confirmed = filteredOrders.filter(o => o.confirmation_status === "confirmed").length;
    // Shipped = currently in transit (not yet delivered/returned)
    const inTransit = filteredOrders.filter(o => o.delivery_status && inTransitStatuses.includes(o.delivery_status)).length;
    // Delivered = successfully delivered
    const delivered = filteredOrders.filter(o => o.delivery_status && deliveredStatuses.includes(o.delivery_status)).length;
    // Returned
    const returned = filteredOrders.filter(o => o.delivery_status === "returned").length;
    // Total shipped (all that have been sent out)
    const totalShipped = inTransit + delivered + returned;

    // Compute avg delivery time: from shipped_at to delivered_at
    const deliveryTimes = filteredOrders
      .filter(o => (o as any).shipped_at && o.delivered_at)
      .map(o => {
        const days = Math.max(1, Math.round((new Date(o.delivered_at!).getTime() - new Date((o as any).shipped_at).getTime()) / 86400000));
        return days;
      });
    const avgDeliveryTime = deliveryTimes.length > 0 ? (deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length).toFixed(1) : '—';

    return {
      totalShipped,
      inTransit,
      inTransitRate: totalShipped > 0 ? Math.round((inTransit / totalShipped) * 100) : 0,
      delivered,
      deliveryRate: confirmed > 0 ? Math.round((delivered / confirmed) * 100) : 0,
      returned,
      returnedRate: totalShipped > 0 ? Math.round((returned / totalShipped) * 100) : 0,
      confirmed,
      avgDeliveryTime,
    };
  }, [filteredOrders]);

  // Delivery by confirmation agent — use original_agent_id as fallback
  const byConfAgent = useMemo(() => {
    const map: Record<string, { confirmed: number; delivered: number }> = {};
    filteredOrders.forEach(o => {
      const agentId = o.agent_id || o.original_agent_id;
      if (!agentId) return;
      if (!map[agentId]) map[agentId] = { confirmed: 0, delivered: 0 };
      if (o.confirmation_status === "confirmed") map[agentId].confirmed++;
      if (o.delivery_status && deliveredStatuses.includes(o.delivery_status)) map[agentId].delivered++;
    });
    return Object.entries(map)
      .map(([id, d]) => ({ name: profileNameMap[id] || id.slice(0, 8), confirmed: d.confirmed, delivered: d.delivered, rate: d.confirmed > 0 ? Math.round((d.delivered / d.confirmed) * 100) : 0 }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders, profileNameMap]);

  // Delivery by product — rate = delivered / confirmed
  const byProduct = useMemo(() => {
    const map: Record<string, { confirmed: number; delivered: number }> = {};
    filteredOrders.forEach(o => {
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { confirmed: 0, delivered: 0 };
      if (o.confirmation_status === "confirmed") map[name].confirmed++;
      if (o.delivery_status && deliveredStatuses.includes(o.delivery_status)) map[name].delivered++;
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, confirmed: d.confirmed, delivered: d.delivered, rate: d.confirmed > 0 ? Math.round((d.delivered / d.confirmed) * 100) : 0 }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  // Delivery by city
  const byCity = useMemo(() => {
    const map: Record<string, { shipped: number; delivered: number; inTransit: number }> = {};
    filteredOrders.forEach(o => {
      const city = o.customer_city || "Unknown";
      if (!map[city]) map[city] = { shipped: 0, delivered: 0, inTransit: 0 };
      if (o.delivery_status && allShippedStatuses.includes(o.delivery_status)) map[city].shipped++;
      if (o.delivery_status && deliveredStatuses.includes(o.delivery_status)) map[city].delivered++;
      if (o.delivery_status && inTransitStatuses.includes(o.delivery_status)) map[city].inTransit++;
    });
    return Object.entries(map)
      .map(([city, d]) => {
        const cityOrders = filteredOrders.filter(o => (o.customer_city || "Unknown") === city && o.confirmed_at && o.delivered_at);
        const times = cityOrders.map(o => Math.max(1, Math.round((new Date(o.delivered_at!).getTime() - new Date(o.confirmed_at!).getTime()) / 86400000)));
        const avgTime = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : '—';
        return { city, ...d, rate: d.shipped > 0 ? Math.round((d.delivered / d.shipped) * 100) : 0, avgTime };
      })
      .sort((a, b) => b.shipped - a.shipped);
  }, [filteredOrders]);

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
        <h1 className="text-2xl font-semibold">Delivery Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Shipping & delivery performance insights</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-lg border p-4">
        <SearchableSelect value={sellerFilter} onValueChange={setSellerFilter}
          options={sellerOptions} placeholder="Seller" allLabel="All Sellers" className="w-[160px]" />
        <SearchableSelect value={productFilter} onValueChange={setProductFilter}
          options={productOptions} placeholder="Product" allLabel="All Products" className="w-[160px]" />
        <DatePresetFilter dateRange={dateRange} onDateRangeChange={setDateRange} preset={datePreset} onPresetChange={setDatePreset} />
        {(sellerFilter !== "all" || productFilter !== "all" || dateRange) && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setSellerFilter("all"); setProductFilter("all"); setDatePreset("maximum"); setDateRange(undefined); }}>
            Clear
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Total Shipped" value={stats.totalShipped} icon={Package} iconBg="bg-info/10" iconColor="text-info" delay={0} />
        <KPICard title="Delivered" value={stats.delivered} subtitle={`${stats.deliveryRate}% of confirmed`} icon={CheckCircle2} iconBg="bg-success/10" iconColor="text-success" delay={50} />
        <KPICard title="In Transit" value={stats.inTransit} subtitle={`${stats.inTransitRate}% of shipped`} icon={Truck} iconBg="bg-warning/10" iconColor="text-warning" delay={100} />
        <KPICard title="Avg Delivery Time" value={`${stats.avgDeliveryTime} days`} icon={Clock} iconBg="bg-muted" iconColor="text-muted-foreground" delay={150} />
      </div>

      {/* Delivery Rate Gauge */}
      <div className="bg-card rounded-xl border overflow-hidden animate-slide-up hover:shadow-lg transition-all duration-300" style={{ animationDelay: '100ms' }}>
        <div className="flex flex-col items-center justify-center px-4 py-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Overall Delivery Rate</h2>
          {(() => {
            const rate = stats.deliveryRate;
            const cx = 160, cy = 140, r = 100, strokeW = 14;
            const totalArc = Math.PI;
            const circumference = totalArc * r;
            const progressOffset = circumference - (rate / 100) * circumference;
            const getColor = (v: number) => v <= 40 ? "hsl(0, 65%, 52%)" : v <= 70 ? "hsl(38, 90%, 55%)" : "hsl(155, 50%, 42%)";
            const statusColor = getColor(rate);
            const status = rate <= 40 ? "Poor" : rate <= 70 ? "Average" : "Good";
            const describeArc = (startA: number, endA: number, radius: number) => {
              const x1 = cx + radius * Math.cos(startA), y1 = cy - radius * Math.sin(startA);
              const x2 = cx + radius * Math.cos(endA), y2 = cy - radius * Math.sin(endA);
              return `M ${x1} ${y1} A ${radius} ${radius} 0 ${Math.abs(endA - startA) > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
            };
            const ticks = [0, 25, 50, 75, 100].map((v) => {
              const angle = Math.PI - (v / 100) * totalArc;
              const outerR = r + strokeW / 2 + 10;
              return { label: `${v}%`, x: cx + outerR * Math.cos(angle), y: cy - outerR * Math.sin(angle) };
            });
            return (
              <svg viewBox="0 0 320 170" className="w-full h-auto max-w-[480px] overflow-visible">
                <defs>
                  <linearGradient id="gauge-delivery-main" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="hsl(0, 65%, 52%)" />
                    <stop offset="45%" stopColor="hsl(38, 90%, 55%)" />
                    <stop offset="100%" stopColor="hsl(155, 50%, 42%)" />
                  </linearGradient>
                  <filter id="gauge-glow-delivery-main">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                <path d={describeArc(Math.PI, 0, r)} fill="none" stroke="hsl(35,12%,91%)" strokeWidth={strokeW} strokeLinecap="round" />
                <path d={describeArc(Math.PI, 0, r)} fill="none" stroke="url(#gauge-delivery-main)"
                  strokeWidth={strokeW} strokeLinecap="round" strokeDasharray={circumference}
                  strokeDashoffset={progressOffset} filter="url(#gauge-glow-delivery-main)"
                  style={{ transition: "stroke-dashoffset 0.8s ease-out" }} />
                {ticks.map((t) => (
                  <text key={t.label} x={t.x} y={t.y} textAnchor="middle" dominantBaseline="middle"
                    className="text-[9px] font-medium" fill="hsl(30,6%,60%)">{t.label}</text>
                ))}
                <text x={cx} y={cy - 16} textAnchor="middle" dominantBaseline="middle"
                  className="text-[40px] font-bold tabular-nums" fill="hsl(var(--foreground))"
                  style={{ letterSpacing: "-0.03em" }}>{rate}%</text>
                <text x={cx} y={cy + 8} textAnchor="middle" dominantBaseline="middle"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em]" fill="hsl(30,6%,55%)">Delivery Rate</text>
                <text x={cx} y={cy + 22} textAnchor="middle" dominantBaseline="middle"
                  className="text-[10px] font-bold" fill={statusColor}>{status}</text>
                <text x={cx - 70} y={cy + 48} textAnchor="middle" className="text-[10px] font-medium" fill="hsl(30,6%,55%)">
                  {stats.confirmed} Confirmed
                </text>
                <text x={cx} y={cy + 48} textAnchor="middle" className="text-[10px] font-medium" fill="hsl(155,50%,42%)">
                  {stats.delivered} Delivered
                </text>
              </svg>
            );
          })()}
        </div>
      </div>

      {/* Status Distribution */}
      <div className="bg-card rounded-xl border p-5 animate-slide-up" style={{ animationDelay: '120ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Status Distribution</h2>
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="w-full md:w-1/2">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Delivered', value: stats.delivered },
                    { name: 'In Transit', value: stats.inTransit },
                    { name: 'Returned', value: stats.returned },
                  ].filter(d => d.value > 0)}
                  cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value"
                >
                  <Cell fill="hsl(155, 50%, 42%)" />
                  <Cell fill="hsl(210, 60%, 52%)" />
                  <Cell fill="hsl(0, 65%, 52%)" />
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="w-full md:w-1/2 space-y-2.5">
            {[
              { name: 'Delivered', value: stats.delivered, color: 'hsl(155, 50%, 42%)', pct: stats.deliveryRate },
              { name: 'In Transit', value: stats.inTransit, color: 'hsl(210, 60%, 52%)', pct: stats.inTransitRate },
              { name: 'Returned', value: stats.returned, color: 'hsl(0, 65%, 52%)', pct: stats.returnedRate },
            ].filter(d => d.value > 0).map((item) => (
              <div key={item.name} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-sm font-medium flex-1">{item.name}</span>
                <span className="text-sm font-bold tabular-nums">{item.value}</span>
                <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{item.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Performance by Confirmation Agents */}
      {byConfAgent.length > 0 && (
        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '140ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-info" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Delivery by Confirmation Agents</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2 pr-4">Rank</th>
                  <th className="text-left py-2 pr-4">Agent</th>
                  <th className="text-right py-2 pr-4">Confirmed</th>
                  <th className="text-right py-2 pr-4">Delivered</th>
                  <th className="text-right py-2">Del. Rate</th>
                </tr>
              </thead>
              <tbody>
                {byConfAgent.map((a, i) => (
                  <tr key={a.name} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="py-2.5 pr-4">
                      <span className={cn("inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold",
                        i === 0 ? "bg-warning/20 text-warning" : i === 1 ? "bg-muted text-muted-foreground" : "text-muted-foreground"
                      )}>{i + 1}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-medium">{a.name}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{a.confirmed}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-success">{a.delivered}</td>
                    <td className="py-2.5 text-right">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", rateBadge(a.rate))}>{a.rate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delivery by Product Chart */}
      {byProduct.length > 0 && (
        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '180ms' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Delivery Rate by Product</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byProduct} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" unit="%" />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={120} />
              <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
              <Bar dataKey="rate" radius={[0, 4, 4, 0]} name="Delivery Rate">
                {byProduct.map((entry) => (<Cell key={entry.name} fill={rateColor(entry.rate)} />))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Delivery by City */}
      {byCity.length > 0 && (
        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '200ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Delivery Rate by City</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2 pr-4">City</th>
                  <th className="text-right py-2 pr-4">Shipped</th>
                  <th className="text-right py-2 pr-4">In Transit</th>
                  <th className="text-right py-2 pr-4">Delivered</th>
                  <th className="text-right py-2 pr-4">Rate</th>
                  <th className="text-right py-2 pr-4">Avg Time</th>
                  <th className="text-right py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {byCity.map((c) => (
                  <>
                    <tr key={c.city} className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => setExpandedCity(expandedCity === c.city ? null : c.city)}>
                      <td className="py-2.5 pr-4 font-medium">{c.city}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{c.shipped}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-info">{c.inTransit}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-success">{c.delivered}</td>
                      <td className="py-2.5 pr-4 text-right">
                        <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold", rateBadge(c.rate))}>{c.rate}%</span>
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground">{c.avgTime}d</td>
                      <td className="py-2.5 text-right">
                        {expandedCity === c.city ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                      </td>
                    </tr>
                    {expandedCity === c.city && (
                      <tr key={`${c.city}-detail`}>
                        <td colSpan={7} className="bg-muted/30 px-6 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                            <div className="bg-card rounded-lg border p-3">
                              <p className="text-muted-foreground font-medium mb-1">Total Shipped</p>
                              <p className="text-lg font-bold">{c.shipped}</p>
                            </div>
                            <div className="bg-card rounded-lg border p-3">
                              <p className="text-muted-foreground font-medium mb-1">Delivered</p>
                              <p className="text-lg font-bold text-success">{c.delivered}</p>
                              <p className="text-muted-foreground mt-0.5">{c.rate}% delivery rate</p>
                            </div>
                            <div className="bg-card rounded-lg border p-3">
                              <p className="text-muted-foreground font-medium mb-1">Avg Delivery</p>
                              <p className="text-lg font-bold">{c.avgTime} days</p>
                              <p className="text-muted-foreground mt-0.5">{c.inTransit} in transit</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
