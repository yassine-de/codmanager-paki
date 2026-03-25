import { mockOrders, sellerNames, productNames, type Order } from "@/lib/data";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { KPICard } from "@/components/KPICard";
import { Phone, CheckCircle2, PhoneCall, Clock, XCircle, AlertTriangle, Truck, Users, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DatePresetFilter, type DatePresetValue, getDateRangeFromPreset } from "@/components/DatePresetFilter";
import { DateRange } from "react-day-picker";

const agentNames = ['Karim B.', 'Sara M.', 'Youssef H.', 'Nadia K.', 'Omar T.'];

const cancelReasons = ['Client changed mind', 'Too expensive', 'Found elsewhere', 'No longer needed', 'Wrong product', 'Delivery too slow'];

function getAgentFromOrder(order: Order): string {
  const assignEvent = order.history.find(h => h.type === 'assigned' || h.type === 'confirmation');
  return assignEvent?.agent || order.history[0]?.agent || 'Unknown';
}

function getCancelReason(): string {
  return cancelReasons[Math.floor(Math.random() * cancelReasons.length)];
}

export default function ConfirmationAnalytics() {
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const filteredOrders = useMemo(() => {
    let orders = [...mockOrders];
    if (agentFilter !== "all") {
      orders = orders.filter(o => getAgentFromOrder(o) === agentFilter);
    }
    if (sellerFilter !== "all") {
      orders = orders.filter(o => o.seller === sellerFilter);
    }
    if (productFilter !== "all") {
      orders = orders.filter(o => o.products.some(p => p.name === productFilter));
    }
    if (dateRange?.from) {
      orders = orders.filter(o => new Date(o.createdAt) >= dateRange.from!);
    }
    if (dateRange?.to) {
      orders = orders.filter(o => new Date(o.createdAt) <= dateRange.to!);
    }
    return orders;
  }, [agentFilter, sellerFilter, productFilter, dateRange]);

  const stats = useMemo(() => {
    const total = filteredOrders.length;
    const confirmed = filteredOrders.filter(o => ['confirmed', 'shipped', 'delivered', 'in_transit', 'with_courier'].includes(o.status)).length;
    const answered = filteredOrders.filter(o => !['no_answer'].includes(o.status)).length;
    const cancelled = filteredOrders.filter(o => o.status === 'cancelled').length;
    const postponed = filteredOrders.filter(o => o.status === 'postponed').length;
    const delivered = filteredOrders.filter(o => o.status === 'delivered').length;
    const shipped = filteredOrders.filter(o => ['shipped', 'in_transit', 'with_courier', 'delivered', 'returned'].includes(o.status)).length;

    return {
      treated: total,
      confirmed,
      confirmationRate: total > 0 ? Math.round((confirmed / total) * 100) : 0,
      answeredRate: total > 0 ? Math.round((answered / total) * 100) : 0,
      firstCallAvg: `${Math.floor(Math.random() * 3) + 1}m ${Math.floor(Math.random() * 50) + 10}s`,
      handlingTime: `${Math.floor(Math.random() * 5) + 2}m ${Math.floor(Math.random() * 50) + 10}s`,
      cancelled,
      cancelledRate: total > 0 ? Math.round((cancelled / total) * 100) : 0,
      postponed,
      postponedRate: total > 0 ? Math.round((postponed / total) * 100) : 0,
      delivered,
      deliveredRate: shipped > 0 ? Math.round((delivered / shipped) * 100) : 0,
    };
  }, [filteredOrders]);

  // Agent scores
  const agentScores = useMemo(() => {
    const map: Record<string, { total: number; confirmed: number; delivered: number; shipped: number }> = {};
    mockOrders.forEach(o => {
      const agent = getAgentFromOrder(o);
      if (!map[agent]) map[agent] = { total: 0, confirmed: 0, delivered: 0, shipped: 0 };
      map[agent].total++;
      if (['confirmed', 'shipped', 'delivered', 'in_transit', 'with_courier'].includes(o.status)) map[agent].confirmed++;
      if (o.status === 'delivered') map[agent].delivered++;
      if (['shipped', 'in_transit', 'with_courier', 'delivered', 'returned'].includes(o.status)) map[agent].shipped++;
    });
    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        total: d.total,
        confirmed: d.confirmed,
        confirmationRate: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0,
        delivered: d.delivered,
        deliveryRate: d.shipped > 0 ? Math.round((d.delivered / d.shipped) * 100) : 0,
      }))
      .sort((a, b) => b.confirmationRate - a.confirmationRate);
  }, []);

  // Cancel reasons
  const cancelData = useMemo(() => {
    const cancelledOrders = filteredOrders.filter(o => o.status === 'cancelled');
    const reasons: Record<string, number> = {};
    cancelledOrders.forEach(() => {
      const reason = getCancelReason();
      reasons[reason] = (reasons[reason] || 0) + 1;
    });
    const total = cancelledOrders.length;
    return Object.entries(reasons)
      .map(([reason, count]) => ({ reason, count, rate: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [filteredOrders]);

  // Confirmation rate by product
  const confirmByProduct = useMemo(() => {
    const map: Record<string, { total: number; confirmed: number }> = {};
    filteredOrders.forEach(o => {
      o.products.forEach(p => {
        if (!map[p.name]) map[p.name] = { total: 0, confirmed: 0 };
        map[p.name].total++;
        if (['confirmed', 'shipped', 'delivered', 'in_transit', 'with_courier'].includes(o.status)) map[p.name].confirmed++;
      });
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, rate: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0, total: d.total }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  // Delivery rate by product
  const deliveryByProduct = useMemo(() => {
    const map: Record<string, { shipped: number; delivered: number }> = {};
    filteredOrders.forEach(o => {
      o.products.forEach(p => {
        if (!map[p.name]) map[p.name] = { shipped: 0, delivered: 0 };
        if (['shipped', 'in_transit', 'with_courier', 'delivered', 'returned'].includes(o.status)) map[p.name].shipped++;
        if (o.status === 'delivered') map[p.name].delivered++;
      });
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, rate: d.shipped > 0 ? Math.round((d.delivered / d.shipped) * 100) : 0, shipped: d.shipped }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  const rateColor = (rate: number) => rate >= 70 ? 'hsl(155, 50%, 42%)' : rate >= 40 ? 'hsl(38, 90%, 55%)' : 'hsl(0, 65%, 52%)';

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold">Confirmation Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Agent performance & confirmation insights</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-lg border p-4">
        <SearchableSelect
          value={agentFilter}
          onValueChange={setAgentFilter}
          options={agentNames.map(a => ({ value: a, label: a }))}
          placeholder="Agent"
          allLabel="All Agents"
          className="w-[160px]"
        />

        <SearchableSelect
          value={sellerFilter}
          onValueChange={setSellerFilter}
          options={sellerNames.map(s => ({ value: s, label: s }))}
          placeholder="Seller"
          allLabel="All Sellers"
          className="w-[160px]"
        />

        <SearchableSelect
          value={productFilter}
          onValueChange={setProductFilter}
          options={productNames.map(p => ({ value: p, label: p }))}
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

        {(agentFilter !== "all" || sellerFilter !== "all" || productFilter !== "all" || dateRange) && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setAgentFilter("all"); setSellerFilter("all"); setProductFilter("all"); setDatePreset("maximum"); setDateRange(undefined); }}>
            Clear
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPICard title="Total Orders" value={stats.treated} icon={ShoppingCart} iconBg="bg-primary/10" iconColor="text-primary" delay={0} />
        <KPICard title="Treated Orders" value={stats.treated} icon={Phone} iconBg="bg-info/10" iconColor="text-info" delay={50} />
        <KPICard title="Confirmed" value={stats.confirmed} subtitle={`${stats.confirmationRate}% rate`} icon={CheckCircle2} iconBg="bg-success/10" iconColor="text-success" delay={50} />
        <KPICard title="Answered Rate" value={`${stats.answeredRate}%`} icon={PhoneCall} iconBg="bg-primary/10" iconColor="text-primary" delay={100} />
        <KPICard title="First Call Avg" value={stats.firstCallAvg} icon={Clock} iconBg="bg-warning/10" iconColor="text-warning" delay={150} />
        <KPICard title="Handling Time" value={stats.handlingTime} icon={Clock} iconBg="bg-muted" iconColor="text-muted-foreground" delay={200} />
        <KPICard title="Cancelled" value={stats.cancelled} subtitle={`${stats.cancelledRate}% rate`} icon={XCircle} iconBg="bg-destructive/10" iconColor="text-destructive" delay={250} />
        <KPICard title="Reported (Postponed)" value={stats.postponed} subtitle={`${stats.postponedRate}% rate`} icon={AlertTriangle} iconBg="bg-warning/10" iconColor="text-warning" delay={300} />
        <KPICard title="Delivered" value={stats.delivered} subtitle={`${stats.deliveredRate}% delivery rate`} icon={Truck} iconBg="bg-success/10" iconColor="text-success" delay={350} />
      </div>

      {/* Agent Scores Table */}
      <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '100ms' }}>
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Agent Scores</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="text-left py-2 pr-4">Rank</th>
                <th className="text-left py-2 pr-4">Agent</th>
                <th className="text-right py-2 pr-4">Orders</th>
                <th className="text-right py-2 pr-4">Confirmed</th>
                <th className="text-right py-2 pr-4">Conf. Rate</th>
                <th className="text-right py-2 pr-4">Delivered</th>
                <th className="text-right py-2">Del. Rate</th>
              </tr>
            </thead>
            <tbody>
              {agentScores.map((a, i) => (
                <tr key={a.name} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                  <td className="py-2.5 pr-4">
                    <span className={cn(
                      "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold",
                      i === 0 ? "bg-warning/20 text-warning" : i === 1 ? "bg-muted text-muted-foreground" : i === 2 ? "bg-warning/10 text-warning" : "text-muted-foreground"
                    )}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-medium">{a.name}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{a.total}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{a.confirmed}</td>
                  <td className="py-2.5 pr-4 text-right">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold",
                      a.confirmationRate >= 70 ? "bg-success/10 text-success" : a.confirmationRate >= 40 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
                    )}>
                      {a.confirmationRate}%
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{a.delivered}</td>
                  <td className="py-2.5 text-right">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold",
                      a.deliveryRate >= 70 ? "bg-success/10 text-success" : a.deliveryRate >= 40 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
                    )}>
                      {a.deliveryRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cancel Reasons */}
      <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Cancellation Reasons</h2>
        {cancelData.length === 0 ? (
          <p className="text-muted-foreground text-sm">No cancellations in selected period</p>
        ) : (
          <div className="space-y-3">
            {cancelData.map(r => (
              <div key={r.reason} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium">{r.reason}</span>
                    <span className="text-xs text-muted-foreground">{r.count} orders · {r.rate}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-destructive/70 rounded-full transition-all" style={{ width: `${r.rate}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Confirmation Rate by Product */}
        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '200ms' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Confirmation Rate by Product</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={confirmByProduct} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" unit="%" />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={110} />
              <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
              <Bar dataKey="rate" radius={[0, 4, 4, 0]} name="Confirmation Rate">
                {confirmByProduct.map((entry) => (
                  <Cell key={entry.name} fill={rateColor(entry.rate)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Delivery Rate by Product */}
        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '250ms' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Delivery Rate by Product</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={deliveryByProduct} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" unit="%" />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={110} />
              <Tooltip formatter={(v: number) => `${v}%`} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
              <Bar dataKey="rate" radius={[0, 4, 4, 0]} name="Delivery Rate">
                {deliveryByProduct.map((entry) => (
                  <Cell key={entry.name} fill={rateColor(entry.rate)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
