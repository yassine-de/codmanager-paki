import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { mockOrders } from "@/lib/data";
import { mockProducts } from "@/lib/products-data";
import { format, subDays, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { CheckCircle2, Clock, PhoneOff, XCircle, TrendingUp, Trophy, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { DatePresetFilter, getDateRangeFromPreset, type DatePresetValue } from "@/components/DatePresetFilter";
import type { DateRange } from "react-day-picker";

const motivationalQuotes = [
  "Every call is a chance to make someone's day! 🔥",
  "You're crushing it — keep the momentum going! 💪",
  "Top agents don't stop, they keep dialing! 🚀",
  "Your next confirmation is just one call away! ⭐",
  "Champions are made in moments like this! 🏆",
];

const COLORS = {
  confirmed: "hsl(155, 50%, 42%)",
  postponed: "hsl(40, 80%, 50%)",
  noAnswer: "hsl(220, 60%, 55%)",
  cancelled: "hsl(0, 65%, 52%)",
};

const AgentDashboard = () => {
  const { authUser } = useAuth();
  const agentName = authUser?.name || "Agent";
  const quote = motivationalQuotes[Math.floor(Date.now() / 86400000) % motivationalQuotes.length];

  const [datePreset, setDatePreset] = useState<DatePresetValue>("7d");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDateRangeFromPreset("7d"));

  const filteredOrders = useMemo(() => {
    return mockOrders.filter((o) => {
      if (!dateRange?.from) return true;
      const d = new Date(o.createdAt);
      const from = startOfDay(dateRange.from);
      const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
      return isWithinInterval(d, { start: from, end: to });
    });
  }, [dateRange]);

  const stats = useMemo(() => {
    const total = filteredOrders.length;
    const confirmed = filteredOrders.filter((o) => ["confirmed", "shipped", "delivered", "in_transit", "with_courier"].includes(o.status)).length;
    const postponed = filteredOrders.filter((o) => o.status === "postponed").length;
    const noAnswer = filteredOrders.filter((o) => o.status === "no_answer").length;
    const cancelled = filteredOrders.filter((o) => o.status === "cancelled").length;
    return {
      total,
      confirmed,
      confirmedPct: total ? Math.round((confirmed / total) * 100) : 0,
      postponed,
      postponedPct: total ? Math.round((postponed / total) * 100) : 0,
      noAnswer,
      noAnswerPct: total ? Math.round((noAnswer / total) * 100) : 0,
      cancelled,
      cancelledPct: total ? Math.round((cancelled / total) * 100) : 0,
    };
  }, [filteredOrders]);

  // Pie chart data
  const pieData = [
    { name: "Confirmed", value: stats.confirmed, color: COLORS.confirmed },
    { name: "Postponed", value: stats.postponed, color: COLORS.postponed },
    { name: "No Answer", value: stats.noAnswer, color: COLORS.noAnswer },
    { name: "Cancelled", value: stats.cancelled, color: COLORS.cancelled },
  ];

  // Agent ranking (mock)
  const agentRanking = useMemo(() => {
    const agents = ["Karim B.", "Sara M.", "Youssef H.", "Nadia K.", "Omar T.", agentName];
    return agents
      .map((name) => ({
        name,
        confirmed: Math.floor(Math.random() * 50) + 10,
        isCurrentAgent: name === agentName,
      }))
      .sort((a, b) => b.confirmed - a.confirmed);
  }, [agentName]);

  const currentRank = agentRanking.findIndex((a) => a.isCurrentAgent) + 1;

  // Top products by confirmation rate
  const topByConfirmation = useMemo(() => {
    const productMap = new Map<string, { total: number; confirmed: number }>();
    filteredOrders.forEach((o) => {
      o.products.forEach((p) => {
        const entry = productMap.get(p.name) || { total: 0, confirmed: 0 };
        entry.total++;
        if (["confirmed", "shipped", "delivered", "in_transit", "with_courier"].includes(o.status)) entry.confirmed++;
        productMap.set(p.name, entry);
      });
    });
    return Array.from(productMap.entries())
      .map(([name, d]) => ({ name, rate: d.total ? Math.round((d.confirmed / d.total) * 100) : 0, total: d.total }))
      .filter((p) => p.total >= 2)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 8);
  }, [filteredOrders]);

  // Top products by delivery rate
  const topByDelivery = useMemo(() => {
    const productMap = new Map<string, { shipped: number; delivered: number }>();
    filteredOrders.forEach((o) => {
      o.products.forEach((p) => {
        const entry = productMap.get(p.name) || { shipped: 0, delivered: 0 };
        if (["shipped", "delivered", "in_transit", "with_courier", "returned"].includes(o.status)) entry.shipped++;
        if (o.status === "delivered") entry.delivered++;
        productMap.set(p.name, entry);
      });
    });
    return Array.from(productMap.entries())
      .map(([name, d]) => ({ name, rate: d.shipped ? Math.round((d.delivered / d.shipped) * 100) : 0, shipped: d.shipped }))
      .filter((p) => p.shipped >= 2)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 8);
  }, [filteredOrders]);

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-5 p-4 md:p-6 max-w-[1400px] mx-auto">
      {/* Welcome + Date filter header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" />
            Welcome back, {agentName}!
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{quote}</p>
        </div>
        <DatePresetFilter
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          preset={datePreset}
          onPresetChange={setDatePreset}
        />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-l-4 border-l-primary/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
              <TrendingUp className="h-3.5 w-3.5" /> Orders Treated
            </div>
            <p className="text-3xl font-bold text-foreground mt-1">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4" style={{ borderLeftColor: COLORS.confirmed }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: COLORS.confirmed }}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Confirmed
            </div>
            <p className="text-3xl font-bold text-foreground mt-1">{stats.confirmed}</p>
            <p className="text-xs text-muted-foreground">{stats.confirmedPct}%</p>
          </CardContent>
        </Card>
        <Card className="border-l-4" style={{ borderLeftColor: COLORS.postponed }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: COLORS.postponed }}>
              <Clock className="h-3.5 w-3.5" /> Postponed
            </div>
            <p className="text-3xl font-bold text-foreground mt-1">{stats.postponed}</p>
            <p className="text-xs text-muted-foreground">{stats.postponedPct}%</p>
          </CardContent>
        </Card>
        <Card className="border-l-4" style={{ borderLeftColor: COLORS.noAnswer }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: COLORS.noAnswer }}>
              <PhoneOff className="h-3.5 w-3.5" /> No Answer
            </div>
            <p className="text-3xl font-bold text-foreground mt-1">{stats.noAnswer}</p>
            <p className="text-xs text-muted-foreground">{stats.noAnswerPct}%</p>
          </CardContent>
        </Card>
        <Card className="border-l-4" style={{ borderLeftColor: COLORS.cancelled }}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: COLORS.cancelled }}>
              <XCircle className="h-3.5 w-3.5" /> Cancelled
            </div>
            <p className="text-3xl font-bold text-foreground mt-1">{stats.cancelled}</p>
            <p className="text-xs text-muted-foreground">{stats.cancelledPct}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status Distribution Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">📊 Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} innerRadius={45} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Agent Ranking */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" /> Your Ranking
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                #{currentRank} of {agentRanking.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {agentRanking.map((agent, i) => (
                <div
                  key={agent.name}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    agent.isCurrentAgent ? "bg-primary/10 border border-primary/20 font-semibold" : "hover:bg-muted/50"
                  )}
                >
                  <span className="w-6 text-center text-base">{i < 3 ? medals[i] : `#${i + 1}`}</span>
                  <span className="flex-1 truncate">
                    {agent.name} {agent.isCurrentAgent && <Star className="inline h-3.5 w-3.5 text-primary ml-1" />}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">{agent.confirmed} confirmed</span>
                  <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${(agent.confirmed / (agentRanking[0]?.confirmed || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Product Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Products by Confirmation Rate */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">✅ Top Products — Confirmation Rate</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topByConfirmation} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Bar dataKey="rate" fill={COLORS.confirmed} radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Products by Delivery Rate */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">📦 Top Products — Delivery Rate</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topByDelivery} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Bar dataKey="rate" fill="hsl(220, 60%, 55%)" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AgentDashboard;
