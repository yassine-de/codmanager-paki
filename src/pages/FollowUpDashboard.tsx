import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import {
  ClipboardCheck,
  CheckCircle2,
  Hourglass,
  TrendingUp,
  PhoneCall,
  Sparkles,
} from "lucide-react";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const motivationalQuotes = [
  "Every follow-up is a chance to save a delivery! 📦",
  "You're the bridge between courier & customer. 🌉",
  "Patience + persistence = delivered orders. 💪",
  "One more call, one more confirmation! ⭐",
  "Champions follow up. You're a champion. 🏆",
];

interface FollowUpRow {
  order_id: string;
  follow_up_status: string;
  follow_up_updated_at: string | null;
  follow_up_assigned_to: string | null;
  delivery_status: string | null;
}

export default function FollowUpDashboard() {
  const { authUser, loading: authLoading } = useAuth();
  const userId = authUser?.id;
  const userName = authUser?.name || "Follow Up";
  const quote = motivationalQuotes[Math.floor(Date.now() / 86400000) % motivationalQuotes.length];

  const { data: rows = [] } = useQuery({
    queryKey: ["follow-up-dashboard", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_follow_ups_data");
      if (error) throw error;
      return (data ?? []) as FollowUpRow[];
    },
    enabled: !!userId && authUser?.role === "follow_up",
    refetchInterval: 30000,
  });

  const kpis = useMemo(() => {
    const total = rows.length;
    const pending = rows.filter((r) => r.follow_up_status === "pending").length;
    const treated = rows.filter((r) => r.follow_up_status !== "pending").length;
    const closed = rows.filter((r) => r.follow_up_status === "closed").length;
    const delivered = rows.filter((r) => r.delivery_status === "delivered").length;
    const conversionRate = treated > 0 ? Math.round((delivered / treated) * 100) : 0;

    const today = startOfDay(new Date());
    const treatedToday = rows.filter((r) => {
      if (!r.follow_up_updated_at) return false;
      const d = new Date(r.follow_up_updated_at);
      return d >= today && d <= endOfDay(new Date()) && r.follow_up_status !== "pending";
    }).length;

    return { total, pending, treated, closed, delivered, conversionRate, treatedToday };
  }, [rows]);

  const last7Days = useMemo(() => {
    const days: { date: string; label: string; treated: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = subDays(new Date(), i);
      const start = startOfDay(day);
      const end = endOfDay(day);
      const count = rows.filter((r) => {
        if (!r.follow_up_updated_at || r.follow_up_status === "pending") return false;
        const d = new Date(r.follow_up_updated_at);
        return d >= start && d <= end;
      }).length;
      days.push({ date: format(day, "yyyy-MM-dd"), label: format(day, "EEE"), treated: count });
    }
    return days;
  }, [rows]);

  const statusBreakdown = useMemo(() => {
    const buckets: Record<string, number> = {};
    rows.forEach((r) => {
      buckets[r.follow_up_status] = (buckets[r.follow_up_status] || 0) + 1;
    });
    return Object.entries(buckets).map(([status, count]) => ({
      status: status.replace(/_/g, " "),
      count,
    }));
  }, [rows]);

  if (!authLoading && authUser && authUser.role !== "follow_up") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6 max-w-[1500px] animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Welcome back, {userName}</h1>
        </div>
        <p className="text-muted-foreground text-sm">{quote}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          icon={Hourglass}
          label="Pending"
          value={kpis.pending}
          sub="Need action"
          tone="warning"
        />
        <KPICard
          icon={PhoneCall}
          label="Treated Today"
          value={kpis.treatedToday}
          sub={`of ${kpis.treated} total`}
          tone="info"
        />
        <KPICard
          icon={CheckCircle2}
          label="Delivered"
          value={kpis.delivered}
          sub={`${kpis.conversionRate}% conversion`}
          tone="success"
        />
        <KPICard
          icon={ClipboardCheck}
          label="Total Assigned"
          value={kpis.total}
          sub="All time"
          tone="muted"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Last 7 Days</h2>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={last7Days} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="treated" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Status Breakdown</h2>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={statusBreakdown}
                layout="vertical"
                margin={{ top: 0, right: 16, left: 16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <YAxis
                  dataKey="status"
                  type="category"
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                  width={120}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KPICard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: any;
  label: string;
  value: number;
  sub: string;
  tone: "muted" | "info" | "success" | "warning";
}) {
  const toneClasses = {
    muted: "text-muted-foreground bg-muted/50",
    info: "text-[hsl(210,60%,52%)] bg-[hsl(210,60%,52%)]/10",
    success: "text-[hsl(155,50%,42%)] bg-[hsl(155,50%,42%)]/10",
    warning: "text-[hsl(25,85%,55%)] bg-[hsl(25,85%,55%)]/10",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-muted-foreground mb-1">{label}</div>
            <div className="text-2xl font-semibold tracking-tight">{value.toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
          </div>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneClasses[tone]}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
