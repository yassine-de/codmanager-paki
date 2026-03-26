import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { KPICard } from "@/components/KPICard";
import { Phone, CheckCircle2, PhoneCall, Clock, XCircle, AlertTriangle, Truck, Users, ShoppingCart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";

export default function ConfirmationAnalytics() {
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  // Fetch all orders
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["confirmation-analytics-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, confirmation_status, delivery_status, cancel_reason, product_name, seller_id, agent_id, created_at, confirmed_at, delivered_at, price, quantity, postpone_date")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch profiles for sellers & agents
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch agent roles
  const { data: agentRoles = [] } = useQuery({
    queryKey: ["agent-roles-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id").eq("role", "agent");
      if (error) throw error;
      return data;
    },
  });

  const profileNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach(p => { map[p.user_id] = p.name; });
    return map;
  }, [profiles]);

  const agentIds = useMemo(() => agentRoles.map(r => r.user_id), [agentRoles]);

  const agentOptions = useMemo(() => {
    return agentIds.map(id => ({
      value: id,
      label: profileNameMap[id] || id.slice(0, 8),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [agentIds, profileNameMap]);

  const sellerOptions = useMemo(() => {
    const ids = new Set(orders.map(o => o.seller_id));
    return [...ids].map(id => ({
      value: id,
      label: profileNameMap[id] || id.slice(0, 8),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, profileNameMap]);

  const productOptions = useMemo(() => {
    const names = new Set(orders.map(o => o.product_name).filter(Boolean));
    return [...names].map(n => ({ value: n, label: n })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders]);

  // Filter orders
  const filteredOrders = useMemo(() => {
    let filtered = [...orders];
    if (agentFilter !== "all") filtered = filtered.filter(o => o.agent_id === agentFilter);
    if (sellerFilter !== "all") filtered = filtered.filter(o => o.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(o => o.product_name === productFilter);
    if (dateRange?.from) filtered = filtered.filter(o => new Date(o.created_at) >= dateRange.from!);
    if (dateRange?.to) filtered = filtered.filter(o => new Date(o.created_at) <= dateRange.to!);
    return filtered;
  }, [orders, agentFilter, sellerFilter, productFilter, dateRange]);

  // Stats — same formulas as before, mapped to real DB statuses
  const stats = useMemo(() => {
    const total = filteredOrders.length;
    const confirmed = filteredOrders.filter(o => o.confirmation_status === "confirmed").length;
    const cancelled = filteredOrders.filter(o => o.confirmation_status === "cancelled").length;
    const answered = filteredOrders.filter(o => ["confirmed", "cancelled", "reported"].includes(o.confirmation_status) || o.postpone_date !== null).length;
    const postponed = filteredOrders.filter(o => o.postpone_date !== null).length;
    const delivered = filteredOrders.filter(o => o.delivery_status === "delivered").length;
    const shipped = filteredOrders.filter(o => o.delivery_status && ["shipped", "pending", "delivered"].includes(o.delivery_status)).length;

    return {
      total,
      confirmed,
      confirmationRate: answered > 0 ? Math.round((confirmed / answered) * 100) : 0,
      answeredRate: total > 0 ? Math.round((answered / total) * 100) : 0,
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
    orders.forEach(o => {
      const agentId = o.agent_id;
      if (!agentId) return;
      if (!map[agentId]) map[agentId] = { total: 0, confirmed: 0, delivered: 0, shipped: 0 };
      map[agentId].total++;
      if (o.confirmation_status === "confirmed") map[agentId].confirmed++;
      if (o.delivery_status === "delivered") map[agentId].delivered++;
      if (o.delivery_status && ["shipped", "pending", "delivered"].includes(o.delivery_status)) map[agentId].shipped++;
    });
    return Object.entries(map)
      .map(([id, d]) => ({
        id,
        name: profileNameMap[id] || id.slice(0, 8),
        total: d.total,
        confirmed: d.confirmed,
        confirmationRate: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0,
        delivered: d.delivered,
        deliveryRate: d.shipped > 0 ? Math.round((d.delivered / d.shipped) * 100) : 0,
      }))
      .sort((a, b) => b.confirmationRate - a.confirmationRate);
  }, [orders, profileNameMap]);

  // Cancel reasons
  const cancelData = useMemo(() => {
    const cancelledOrders = filteredOrders.filter(o => o.confirmation_status === "cancelled");
    const reasons: Record<string, number> = {};
    cancelledOrders.forEach(o => {
      const reason = o.cancel_reason || "Not specified";
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
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { total: 0, confirmed: 0 };
      map[name].total++;
      if (o.confirmation_status === "confirmed") map[name].confirmed++;
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, rate: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0, total: d.total }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  // Delivery rate by product
  const deliveryByProduct = useMemo(() => {
    const map: Record<string, { shipped: number; delivered: number }> = {};
    filteredOrders.forEach(o => {
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { shipped: 0, delivered: 0 };
      if (o.delivery_status && ["shipped", "pending", "delivered"].includes(o.delivery_status)) map[name].shipped++;
      if (o.delivery_status === "delivered") map[name].delivered++;
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, rate: d.shipped > 0 ? Math.round((d.delivered / d.shipped) * 100) : 0, shipped: d.shipped }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  const rateColor = (rate: number) => rate >= 70 ? 'hsl(155, 50%, 42%)' : rate >= 40 ? 'hsl(38, 90%, 55%)' : 'hsl(0, 65%, 52%)';

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
        <h1 className="text-2xl font-semibold">Confirmation Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Agent performance & confirmation insights</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-lg border p-4">
        <SearchableSelect
          value={agentFilter}
          onValueChange={setAgentFilter}
          options={agentOptions}
          placeholder="Agent"
          allLabel="All Agents"
          className="w-[160px]"
        />
        <SearchableSelect
          value={sellerFilter}
          onValueChange={setSellerFilter}
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
        {(agentFilter !== "all" || sellerFilter !== "all" || productFilter !== "all" || dateRange) && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setAgentFilter("all"); setSellerFilter("all"); setProductFilter("all"); setDatePreset("maximum"); setDateRange(undefined); }}>
            Clear
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPICard title="Total Orders" value={stats.total} icon={ShoppingCart} iconBg="bg-primary/10" iconColor="text-primary" delay={0} />
        <KPICard title="Confirmed" value={stats.confirmed} subtitle={`${stats.confirmationRate}% rate`} icon={CheckCircle2} iconBg="bg-success/10" iconColor="text-success" delay={50} />
        <KPICard title="Answered Rate" value={`${stats.answeredRate}%`} icon={PhoneCall} iconBg="bg-primary/10" iconColor="text-primary" delay={100} />
        <KPICard title="Cancelled" value={stats.cancelled} subtitle={`${stats.cancelledRate}% rate`} icon={XCircle} iconBg="bg-destructive/10" iconColor="text-destructive" delay={150} />
        <KPICard title="Reported (Postponed)" value={stats.postponed} subtitle={`${stats.postponedRate}% rate`} icon={AlertTriangle} iconBg="bg-warning/10" iconColor="text-warning" delay={200} />
        <KPICard title="Delivered" value={stats.delivered} subtitle={`${stats.deliveredRate}% delivery rate`} icon={Truck} iconBg="bg-success/10" iconColor="text-success" delay={250} />
      </div>

      {/* Agent Scores Table */}
      {agentScores.length > 0 && (
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
                  <tr key={a.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
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
      )}

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
        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '200ms' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Confirmation Rate by Product</h2>
          {confirmByProduct.length > 0 ? (
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
          ) : (
            <p className="text-muted-foreground text-sm text-center py-10">No data</p>
          )}
        </div>

        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '250ms' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Delivery Rate by Product</h2>
          {deliveryByProduct.length > 0 ? (
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
          ) : (
            <p className="text-muted-foreground text-sm text-center py-10">No data</p>
          )}
        </div>
      </div>
    </div>
  );
}
