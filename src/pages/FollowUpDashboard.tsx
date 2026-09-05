import { useMemo, useState } from "react";
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
  ShieldCheck,
  ListTodo,
  type LucideIcon,
} from "lucide-react";
import { formatPKT as format, startOfDayPKT as startOfDay, endOfDayPKT as endOfDay, subDaysPKT as subDays } from "@/lib/timezone";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { DatePresetFilter, getDateRangeFromPreset, type DatePresetValue } from "@/components/DatePresetFilter";
import type { DateRange } from "react-day-picker";

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

const motivationalQuotes = [
  "Every follow-up is a chance to save a delivery! 📦",
  "You're the bridge between courier & customer. 🌉",
  "Patience + persistence = delivered orders. 💪",
  "One more call, one more confirmation! ⭐",
  "Champions follow up. You're a champion. 🏆",
];

interface PortfolioRow {
  order_id: string;
  follow_up_status: string;
}

interface QueueRow {
  order_id: string;
  follow_up_assigned_to: string | null;
  follow_up_status: string;
}

interface OrderEvent {
  order_id: string;
  created_at: string;
}

export default function FollowUpDashboard() {
  const { authUser, loading: authLoading } = useAuth();
  const userId = authUser?.id;
  const userName = authUser?.name || "Follow Up";
  const quote = motivationalQuotes[Math.floor(Date.now() / 86400000) % motivationalQuotes.length];

  // Controls "Treated"/"Delivered"/"Saved Orders"/"Last 7 Days" below —
  // Pending/Total Assigned/Status Breakdown/Active Follow-Ups stay all-time or
  // current-state snapshots (not activity in a period). Defaults to "today".
  const [datePreset, setDatePreset] = useState<DatePresetValue>("today");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDateRangeFromPreset("today"));
  const resolvedDateRange = useMemo(() => {
    const from = dateRange?.from ? startOfDay(dateRange.from) : null;
    const to = dateRange?.to
      ? endOfDay(dateRange.to)
      : dateRange?.from
        ? endOfDay(dateRange.from)
        : null;
    return { from, to };
  }, [dateRange]);

  // PERMANENT PORTFOLIO (population A) — every order ever assigned to this
  // agent (orders.follow_up_assigned_to), no eligibility/timing filter. This
  // is the ONLY source for ownership-based historical KPIs (Total Assigned,
  // Treated, Delivered, Saved Orders, Last 7 Days, Pending, Status Breakdown).
  // It can never shrink just because an order resolves and drops out of the
  // live work queue below.
  const { data: portfolio = [] } = useQuery({
    queryKey: ["follow-up-portfolio", userId],
    queryFn: async () => {
      const pageSize = 1000;
      let from = 0;
      const all: PortfolioRow[] = [];
      while (true) {
        const { data, error } = await supabase.rpc("get_my_follow_up_portfolio").range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as PortfolioRow[];
        all.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    enabled: !!userId && authUser?.role === "follow_up",
    refetchInterval: 30000,
  });

  // LIVE WORK QUEUE (population B) — get_follow_ups_data() deliberately drops
  // orders once they no longer need active attention (delivered with no
  // pending follow-up, shipped <2 days ago and still pending, etc). Used for
  // "Active Follow-Ups", "Pending", and "Status Breakdown" — all three are
  // current-workload views, not historical/ownership KPIs, so this is the
  // correct scope for them (unlike Total Assigned/Treated/Delivered/Saved
  // below, which must never depend on live queue membership).
  const { data: queueRows = [] } = useQuery({
    queryKey: ["follow-up-queue", userId],
    queryFn: async () => {
      const pageSize = 1000;
      let from = 0;
      const all: QueueRow[] = [];
      while (true) {
        const { data, error } = await supabase.rpc("get_follow_ups_data").range(from, from + pageSize - 1);
        if (error) throw error;
        const page = (data ?? []) as QueueRow[];
        all.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    enabled: !!userId && authUser?.role === "follow_up",
    refetchInterval: 30000,
  });

  const activeFollowUps = useMemo(
    () => queueRows.filter((r) => r.follow_up_assigned_to === userId).length,
    [queueRows, userId],
  );

  // Pending = current ACTIONABLE workload only, from the live queue — never
  // the raw portfolio. An order delivered on the first attempt and never
  // needing follow-up has no order_follow_ups row at all; scoring it as
  // "pending" just because that column defaults to pending would make a
  // successful, untouched order look like backlog. get_follow_ups_data()
  // already excludes exactly those orders, so the queue is the correct scope.
  const pending = useMemo(
    () => queueRows.filter((r) => r.follow_up_assigned_to === userId && r.follow_up_status === "pending").length,
    [queueRows, userId],
  );

  // Status Breakdown = current follow-up workload states, from the live
  // queue — same reasoning as Pending. Already-delivered, never-touched
  // orders (which never enter the queue) must not distort this chart.
  const statusBreakdown = useMemo(() => {
    const buckets: Record<string, number> = {};
    queueRows
      .filter((r) => r.follow_up_assigned_to === userId)
      .forEach((r) => {
        buckets[r.follow_up_status] = (buckets[r.follow_up_status] || 0) + 1;
      });
    return Object.entries(buckets).map(([status, count]) => ({
      status: status.replace(/_/g, " "),
      count,
    }));
  }, [queueRows, userId]);

  const portfolioOrderIdsSignature = useMemo(
    () => Array.from(new Set(portfolio.map((r) => r.order_id))).sort().join(","),
    [portfolio],
  );

  // Every meaningful follow_up_status action SHE made on HER portfolio — every
  // event, not just the latest one. An order treated in August and touched
  // again in September must still show as treated in August; collapsing to
  // "her latest action" would silently erase the August activity. Scoped to
  // the FULL permanent portfolio, independent of whether the order still
  // qualifies for today's live queue.
  const { data: followUpActions = [] } = useQuery({
    queryKey: ["follow-up-dashboard-actions", userId, portfolioOrderIdsSignature],
    queryFn: async () => {
      const orderIds = Array.from(new Set(portfolio.map((r) => r.order_id)));
      if (orderIds.length === 0 || !userId) return [];
      const all: OrderEvent[] = [];
      const chunkSize = 200;
      for (let i = 0; i < orderIds.length; i += chunkSize) {
        const chunk = orderIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("order_history")
          .select("order_id, created_at")
          .eq("field_changed", "follow_up_status")
          .eq("changed_by", userId)
          .not("new_value", "is", null)
          .neq("new_value", "pending")
          .in("order_id", chunk);
        if (error) throw error;
        all.push(...((data || []) as OrderEvent[]));
      }
      return all;
    },
    enabled: !!userId && authUser?.role === "follow_up" && portfolio.length > 0,
    staleTime: 0,
  });

  // Distinct orders with >=1 qualifying action whose OWN timestamp falls in
  // the selected period — each period only ever "sees" its own events.
  const periodTreatedOrderIds = useMemo(() => {
    const { from, to } = resolvedDateRange;
    const inRange = (d: Date) => !from || !to || (d >= from && d <= to);
    const set = new Set<string>();
    followUpActions.forEach((h) => {
      if (inRange(new Date(h.created_at))) set.add(h.order_id);
    });
    return set;
  }, [followUpActions, resolvedDateRange]);

  // Every order she has EVER meaningfully treated (all-time), and — for the
  // Delivered performance rule below — the EARLIEST such action per order.
  const everTreatedOrderIds = useMemo(
    () => new Set(followUpActions.map((h) => h.order_id)),
    [followUpActions],
  );
  const firstActionAtByOrder = useMemo(() => {
    const map: Record<string, string> = {};
    followUpActions.forEach((h) => {
      const prev = map[h.order_id];
      if (!prev || new Date(h.created_at) < new Date(prev)) map[h.order_id] = h.created_at;
    });
    return map;
  }, [followUpActions]);

  // Delivered: the real delivery_status transition to delivered/paid, from
  // order_history — not the order's current status and not orders.updated_at,
  // and not gated on still being in the live queue. An order I treated today
  // that was actually delivered weeks ago must not count as "delivered today";
  // an order that resolved and left the queue must not lose its delivery credit.
  const { data: deliveredAtByOrder = {} } = useQuery({
    queryKey: ["follow-up-dashboard-delivered-at", portfolioOrderIdsSignature],
    queryFn: async () => {
      const orderIds = Array.from(new Set(portfolio.map((r) => r.order_id)));
      if (orderIds.length === 0) return {};
      const map: Record<string, string> = {};
      const chunkSize = 200;
      for (let i = 0; i < orderIds.length; i += chunkSize) {
        const chunk = orderIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("order_history")
          .select("order_id, created_at")
          .eq("field_changed", "delivery_status")
          .in("new_value", ["delivered", "paid"])
          .in("order_id", chunk);
        if (error) throw error;
        (data || []).forEach((h) => {
          const prev = map[h.order_id];
          if (!prev || new Date(h.created_at) > new Date(prev)) map[h.order_id] = h.created_at;
        });
      }
      return map;
    },
    enabled: !!userId && authUser?.role === "follow_up" && portfolio.length > 0,
    staleTime: 0,
  });

  // Delivered is an AGENT PERFORMANCE KPI, not "any order in my portfolio that
  // happened to get delivered" — an order delivered on the first attempt with
  // zero follow-up work must NOT count here, even though it's part of Total
  // Assigned. Requires: (1) she has >=1 meaningful action on it, AND (2) the
  // real delivered/paid transition happened AFTER her first such action.
  const deliveredAllTimeOrderIds = useMemo(() => {
    const set = new Set<string>();
    everTreatedOrderIds.forEach((orderId) => {
      const deliveredAt = deliveredAtByOrder[orderId];
      const firstActionAt = firstActionAtByOrder[orderId];
      if (!deliveredAt || !firstActionAt) return;
      if (new Date(deliveredAt).getTime() >= new Date(firstActionAt).getTime()) set.add(orderId);
    });
    return set;
  }, [everTreatedOrderIds, deliveredAtByOrder, firstActionAtByOrder]);

  const periodDeliveredOrderIds = useMemo(() => {
    const { from, to } = resolvedDateRange;
    const inRange = (d: Date) => !from || !to || (d >= from && d <= to);
    const set = new Set<string>();
    deliveredAllTimeOrderIds.forEach((orderId) => {
      if (inRange(new Date(deliveredAtByOrder[orderId]))) set.add(orderId);
    });
    return set;
  }, [deliveredAllTimeOrderIds, deliveredAtByOrder, resolvedDateRange]);

  // Saved Orders: she made a re_attempted rescue action at some point (her
  // EARLIEST one, per order), and the order was later delivered. Scoped to the
  // period by the DELIVERY date, not the re-attempt date — a rescue from last
  // month that finally pays off this month must count as saved THIS month,
  // and this must stay measurable even after the order leaves the live queue.
  const { data: reAttemptedAtByOrder = {} } = useQuery({
    queryKey: ["follow-up-dashboard-reattempted-at", userId, portfolioOrderIdsSignature],
    queryFn: async () => {
      const orderIds = Array.from(new Set(portfolio.map((r) => r.order_id)));
      if (orderIds.length === 0 || !userId) return {};
      const map: Record<string, string> = {};
      const chunkSize = 200;
      for (let i = 0; i < orderIds.length; i += chunkSize) {
        const chunk = orderIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("order_history")
          .select("order_id, created_at")
          .eq("field_changed", "follow_up_status")
          .eq("changed_by", userId)
          .eq("new_value", "re_attempted")
          .in("order_id", chunk);
        if (error) throw error;
        (data || []).forEach((h) => {
          const prev = map[h.order_id];
          if (!prev || new Date(h.created_at) < new Date(prev)) map[h.order_id] = h.created_at;
        });
      }
      return map;
    },
    enabled: !!userId && authUser?.role === "follow_up" && portfolio.length > 0,
    staleTime: 0,
  });

  const savedOrderIdsAllTime = useMemo(() => {
    const set = new Set<string>();
    Object.keys(reAttemptedAtByOrder).forEach((orderId) => {
      const deliveredAt = deliveredAtByOrder[orderId];
      if (!deliveredAt) return;
      if (new Date(deliveredAt).getTime() >= new Date(reAttemptedAtByOrder[orderId]).getTime()) {
        set.add(orderId);
      }
    });
    return set;
  }, [reAttemptedAtByOrder, deliveredAtByOrder]);

  const savedOrdersCount = useMemo(() => {
    const { from, to } = resolvedDateRange;
    const inRange = (d: Date) => !from || !to || (d >= from && d <= to);
    let count = 0;
    savedOrderIdsAllTime.forEach((orderId) => {
      if (inRange(new Date(deliveredAtByOrder[orderId]))) count++;
    });
    return count;
  }, [savedOrderIdsAllTime, deliveredAtByOrder, resolvedDateRange]);

  // All-time rescue rate — deliberately period-independent (a stable "career"
  // success rate), since pairing a period-scoped Saved count against a
  // period-scoped re-attempt count would mix two different date bases again
  // (delivery date vs re-attempt date), same trap as Treated vs Delivered.
  const totalReattemptedAllTime = useMemo(
    () => Object.keys(reAttemptedAtByOrder).length,
    [reAttemptedAtByOrder],
  );

  const kpis = useMemo(() => {
    // Total Assigned = the full permanent portfolio, all-time — it only ever
    // grows (a new order gets assigned) or stays flat; it never shrinks just
    // because an order resolves and drops out of today's live queue. This can
    // legitimately include orders that never needed follow-up at all.
    const total = portfolio.length;

    // Treated all-time = every order she has EVER meaningfully acted on
    // (independent of Total Assigned's untouched orders, and independent of
    // Pending, which now comes from the live queue instead — these three are
    // no longer arithmetically tied to each other by design).
    const treatedAllTime = everTreatedOrderIds.size;

    // Treated/Delivered are real event counts inside the selected period —
    // different populations by date basis (treated uses the action date,
    // delivered uses the delivery date), so an order treated in one period
    // can deliver in another. deliveredPct here is intentionally period-
    // reactive (moves with the date filter, per her request) rather than the
    // all-time-only version — it can exceed 100% in a period where more old
    // treatments finally deliver than new ones get treated; that is a real
    // signal (a delayed payoff month), not a bug.
    const treated = periodTreatedOrderIds.size;
    const delivered = periodDeliveredOrderIds.size;
    const deliveredAllTime = deliveredAllTimeOrderIds.size;

    return {
      total,
      pending,
      pendingPct: pct(pending, activeFollowUps),
      treatedAllTime,
      treated,
      treatedPct: pct(treated, treatedAllTime),
      delivered,
      deliveredAllTime,
      deliveredPct: pct(delivered, treated),
      savedOrders: savedOrdersCount,
      savedRatePct: pct(savedOrderIdsAllTime.size, totalReattemptedAllTime),
      activeFollowUps,
      activeFollowUpsPct: pct(activeFollowUps, total),
    };
  }, [
    portfolio,
    pending,
    everTreatedOrderIds,
    periodTreatedOrderIds,
    periodDeliveredOrderIds,
    deliveredAllTimeOrderIds,
    savedOrdersCount,
    savedOrderIdsAllTime,
    totalReattemptedAllTime,
    activeFollowUps,
  ]);

  // Each day: distinct orders with >=1 qualifying action whose OWN timestamp
  // falls on that exact calendar day — from the real event log, independent
  // of the period filter above, of orders.created_at/updated_at, and of
  // whether those orders remain in today's active queue.
  const last7Days = useMemo(() => {
    const days: { date: string; label: string; treated: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = subDays(new Date(), i);
      const start = startOfDay(day);
      const end = endOfDay(day);
      const orderIdsThatDay = new Set<string>();
      followUpActions.forEach((h) => {
        const d = new Date(h.created_at);
        if (d >= start && d <= end) orderIdsThatDay.add(h.order_id);
      });
      days.push({ date: format(day, "yyyy-MM-dd"), label: format(day, "EEE"), treated: orderIdsThatDay.size });
    }
    return days;
  }, [followUpActions]);

  if (!authLoading && authUser && authUser.role !== "follow_up") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6 max-w-[1500px] animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold">Welcome back, {userName}</h1>
          </div>
          <p className="text-muted-foreground text-sm">{quote}</p>
        </div>
        <DatePresetFilter
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          preset={datePreset}
          onPresetChange={setDatePreset}
        />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        <KPICard
          icon={ClipboardCheck}
          label="Total Assigned"
          value={kpis.total}
          sub="All time"
          tone="muted"
        />
        <KPICard
          icon={PhoneCall}
          label="Treated"
          value={kpis.treated}
          sub={`${kpis.treatedPct}% of ${kpis.treatedAllTime} total`}
          tone="info"
        />
        <KPICard
          icon={CheckCircle2}
          label="Delivered"
          value={kpis.delivered}
          sub={`${kpis.deliveredPct}% of treated`}
          tone="success"
        />
        <KPICard
          icon={ShieldCheck}
          label="Saved Orders"
          value={kpis.savedOrders}
          sub={`${kpis.savedRatePct}% of re-attempts saved`}
          tone="success"
        />
        <KPICard
          icon={Hourglass}
          label="Pending"
          value={kpis.pending}
          sub={`${kpis.pendingPct}% of active queue`}
          tone="warning"
        />
        <KPICard
          icon={ListTodo}
          label="Active Follow-Ups"
          value={kpis.activeFollowUps}
          sub={`${kpis.activeFollowUpsPct}% of total assigned`}
          tone="warning"
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
  icon: LucideIcon;
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
