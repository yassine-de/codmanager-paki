import { mockOrders, getKPIs, type OrderStatus } from "@/lib/data";
import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'hsl(38, 90%, 55%)',
  confirmed: 'hsl(210, 60%, 52%)',
  shipped: 'hsl(155, 30%, 32%)',
  delivered: 'hsl(155, 50%, 42%)',
  cancelled: 'hsl(0, 65%, 52%)',
  returned: 'hsl(30, 6%, 50%)',
  postponed: 'hsl(38, 70%, 50%)',
  no_answer: 'hsl(30, 10%, 45%)',
  double: 'hsl(0, 55%, 45%)',
  wrong_number: 'hsl(0, 50%, 50%)',
  in_transit: 'hsl(210, 50%, 55%)',
  with_courier: 'hsl(155, 35%, 38%)',
};

export default function Analytics() {
  const kpis = getKPIs(mockOrders);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    mockOrders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, []);

  const dailyData = useMemo(() => {
    const days: Record<string, number> = {};
    mockOrders.forEach(o => {
      const day = new Date(o.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' });
      days[day] = (days[day] || 0) + 1;
    });
    return Object.entries(days)
      .map(([day, orders]) => ({ day, orders }))
      .slice(-14);
  }, []);

  const cityData = useMemo(() => {
    const cities: Record<string, { orders: number; revenue: number }> = {};
    mockOrders.forEach(o => {
      if (!cities[o.city]) cities[o.city] = { orders: 0, revenue: 0 };
      cities[o.city].orders++;
      if (o.status === 'delivered') cities[o.city].revenue += o.total;
    });
    return Object.entries(cities)
      .map(([city, data]) => ({ city, ...data }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 8);
  }, []);

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Performance insights for your COD operations</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Orders by Day */}
        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '80ms' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Orders per Day</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(35, 12%, 88%)" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(30, 6%, 50%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(30, 6%, 50%)" />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(35, 12%, 88%)', fontSize: '13px' }}
              />
              <Bar dataKey="orders" fill="hsl(155, 30%, 32%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status Distribution */}
        <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '160ms' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Status Distribution</h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={statusData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                label={({ name, value }) => `${name} (${value})`}
              >
                {statusData.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name as OrderStatus] || '#999'} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* By City */}
        <div className="bg-card rounded-lg border p-5 lg:col-span-2 animate-slide-up" style={{ animationDelay: '240ms' }}>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Cities</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={cityData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(35, 12%, 88%)" />
              <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(30, 6%, 50%)" />
              <YAxis dataKey="city" type="category" tick={{ fontSize: 12 }} stroke="hsl(30, 6%, 50%)" width={90} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(35, 12%, 88%)', fontSize: '13px' }}
              />
              <Bar dataKey="orders" fill="hsl(155, 30%, 32%)" radius={[0, 4, 4, 0]} name="Orders" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
