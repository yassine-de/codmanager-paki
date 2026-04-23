import { useMemo } from "react";
import { KPICard } from "@/components/KPICard";
import { cn } from "@/lib/utils";
import {
  ShoppingCart, CheckCircle2, PhoneOff, Clock, XCircle, Users, TrendingUp, BarChart3, ClipboardCheck, Timer, Hourglass, PhoneMissed,
} from "lucide-react";

interface Order {
  agent_id: string | null;
  original_agent_id: string | null;
  confirmation_status: string;
  postpone_date: string | null;
}

interface AgentScore {
  id: string;
  confirmed: number;
  confirmationRate: number;
  delivered: number;
  deliveryRate: number;
}

interface DailyConfirmationReportProps {
  orders: Order[];
  profileNameMap: Record<string, string>;
  agentIds: string[];
  agentScores?: AgentScore[];
  treatedOrders?: number;
  firstCallAvg?: string;
  handlingTime?: string;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: "hsl(155, 50%, 42%)",
  no_answer: "hsl(38, 90%, 55%)",
  postponed: "hsl(220, 60%, 55%)",
  cancelled: "hsl(0, 65%, 52%)",
  new: "hsl(210, 15%, 60%)",
  other: "hsl(270, 40%, 55%)",
};

function getPerformanceLabel(confirmRate: number, workloadPct: number, avgWorkload: number) {
  if (workloadPct < avgWorkload * 0.5) return { label: "Low workload", color: "text-warning", bg: "bg-warning/10" };
  if (confirmRate >= 70) return { label: "Strong performer", color: "text-success", bg: "bg-success/10" };
  if (confirmRate >= 50) return { label: "Average", color: "text-muted-foreground", bg: "bg-muted" };
  return { label: "Needs improvement", color: "text-destructive", bg: "bg-destructive/10" };
}

function getInsights(agents: AgentRow[], avgWorkload: number): string[] {
  const insights: string[] = [];
  const workloads = agents.map(a => a.workloadPct);
  const maxW = Math.max(...workloads);
  const minW = Math.min(...workloads);
  if (agents.length > 1 && maxW - minW > 25) {
    insights.push("⚠️ Workload is not balanced across agents");
  }
  agents.forEach(a => {
    if (a.noAnswerRate > 40) insights.push(`🔴 ${a.name} has high no-answer rate (${a.noAnswerRate}%)`);
    if (a.total > 0 && a.confirmRate < 40) insights.push(`🔴 ${a.name} is underperforming (${a.confirmRate}% confirmation)`);
    if (a.confirmRate >= 70 && a.total >= avgWorkload * 0.8) insights.push(`🟢 ${a.name} is a top performer`);
    if (a.workloadPct < avgWorkload * 0.5 && a.total > 0) insights.push(`🟡 ${a.name} handled fewer orders than others`);
  });
  return insights.slice(0, 6);
}

interface AgentRow {
  id: string;
  name: string;
  total: number;
  newOrders: number;
  noAnswer: number;
  postponed: number;
  confirmed: number;
  cancelled: number;
  confirmRate: number;
  noAnswerRate: number;
  postponedRate: number;
  workloadPct: number;
}

export function DailyConfirmationReport({ orders, profileNameMap, agentIds, agentScores = [], treatedOrders, firstCallAvg, handlingTime }: DailyConfirmationReportProps) {
  // Global summary
  // "Handled" = agent claimed AND submitted any action (status is not "new")
  // Use original_agent_id as fallback for released/redistributed orders
  const handledOrders = useMemo(() => orders.filter(o => (o.agent_id || o.original_agent_id) && o.confirmation_status !== "new"), [orders]);

  const summary = useMemo(() => {
    const total = handledOrders.length;
    const confirmed = handledOrders.filter(o => o.confirmation_status === "confirmed").length;
    const noAnswer = handledOrders.filter(o => o.confirmation_status === "no_answer").length;
    const postponed = handledOrders.filter(o => o.postpone_date !== null || o.confirmation_status === "postponed").length;
    const cancelled = handledOrders.filter(o => o.confirmation_status === "cancelled").length;
    const wrongNumber = handledOrders.filter(o => o.confirmation_status === "wrong_number").length;
    return {
      total, confirmed, noAnswer, postponed, cancelled, wrongNumber,
      confirmRate: total > 0 ? Math.round((confirmed / total) * 100) : 0,
      noAnswerRate: total > 0 ? Math.round((noAnswer / total) * 100) : 0,
      postponedRate: total > 0 ? Math.round((postponed / total) * 100) : 0,
      cancelledRate: total > 0 ? Math.round((cancelled / total) * 100) : 0,
      wrongNumberRate: total > 0 ? Math.round((wrongNumber / total) * 100) : 0,
    };
  }, [handledOrders]);

  // Per agent breakdown
  const agentRows: AgentRow[] = useMemo(() => {
    const map: Record<string, { total: number; new: number; noAnswer: number; postponed: number; confirmed: number; cancelled: number }> = {};
    // Count handled orders — attribute to agent_id, fallback to original_agent_id for released orders
    handledOrders.forEach(o => {
      const aid = o.agent_id || o.original_agent_id;
      if (!aid) return;
      if (!map[aid]) map[aid] = { total: 0, new: 0, noAnswer: 0, postponed: 0, confirmed: 0, cancelled: 0 };
      map[aid].total++;
      if (o.confirmation_status === "no_answer") map[aid].noAnswer++;
      if (o.postpone_date || o.confirmation_status === "postponed") map[aid].postponed++;
      if (o.confirmation_status === "confirmed") map[aid].confirmed++;
      if (o.confirmation_status === "cancelled") map[aid].cancelled++;
    });
    const totalAll = handledOrders.length || 1;
    return Object.entries(map)
      .map(([id, d]) => ({
        id,
        name: profileNameMap[id] || id.slice(0, 8),
        total: d.total,
        newOrders: d.new,
        noAnswer: d.noAnswer,
        postponed: d.postponed,
        confirmed: d.confirmed,
        cancelled: d.cancelled,
        confirmRate: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0,
        noAnswerRate: d.total > 0 ? Math.round((d.noAnswer / d.total) * 100) : 0,
        postponedRate: d.total > 0 ? Math.round((d.postponed / d.total) * 100) : 0,
        workloadPct: Math.round((d.total / totalAll) * 100),
      }))
      .sort((a, b) => b.total - a.total);
  }, [handledOrders, profileNameMap]);

  const avgWorkload = agentRows.length > 0 ? 100 / agentRows.length : 100;

  // Status distribution for pie chart
  const pieData = useMemo(() => [
    { name: "Confirmed", value: summary.confirmed, fill: STATUS_COLORS.confirmed },
    { name: "No Answer", value: summary.noAnswer, fill: STATUS_COLORS.no_answer },
    { name: "Postponed", value: summary.postponed, fill: STATUS_COLORS.postponed },
    { name: "Cancelled", value: summary.cancelled, fill: STATUS_COLORS.cancelled },
  ].filter(d => d.value > 0), [summary]);

  // Bar chart data
  const barData = useMemo(() => agentRows.map(a => ({
    name: a.name,
    total: a.total,
    confirmed: a.confirmed,
    noAnswer: a.noAnswer,
  })), [agentRows]);

  const insights = useMemo(() => getInsights(agentRows, avgWorkload), [agentRows, avgWorkload]);

  const rateBadge = (rate: number) => (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold",
      rate >= 70 ? "bg-success/10 text-success" : rate >= 40 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
    )}>
      {rate}%
    </span>
  );

  if (orders.length === 0) {
    return (
      <div className="bg-card rounded-lg border p-8 text-center">
        <p className="text-muted-foreground text-sm">No orders for the selected period</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Daily Performance Overview</h2>
      </div>

      {/* Global Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <KPICard title="Orders Handled" value={summary.total} icon={ShoppingCart} iconBg="bg-primary/10" iconColor="text-primary" />
        {treatedOrders !== undefined && (
          <KPICard title="Treated Orders" value={treatedOrders} icon={ClipboardCheck} iconBg="bg-accent/10" iconColor="text-accent-foreground" />
        )}
        {firstCallAvg !== undefined && (
          <KPICard title="First Call Avg" value={firstCallAvg} icon={Timer} iconBg="bg-accent/10" iconColor="text-accent-foreground" />
        )}
        {handlingTime !== undefined && (
          <KPICard title="Handling Time" value={handlingTime} icon={Hourglass} iconBg="bg-accent/10" iconColor="text-accent-foreground" />
        )}
        <KPICard title="Confirmed" value={summary.confirmed} subtitle={`${summary.confirmRate}%`} icon={CheckCircle2} iconBg="bg-success/10" iconColor="text-success" />
        <KPICard title="No Answer" value={summary.noAnswer} subtitle={`${summary.noAnswerRate}%`} icon={PhoneOff} iconBg="bg-warning/10" iconColor="text-warning" />
        <KPICard title="Postponed" value={summary.postponed} subtitle={`${summary.postponedRate}%`} icon={Clock} iconBg="bg-primary/10" iconColor="text-primary" />
        <KPICard title="Cancelled" value={summary.cancelled} subtitle={`${summary.cancelledRate}%`} icon={XCircle} iconBg="bg-destructive/10" iconColor="text-destructive" />
        <KPICard title="Wrong Number" value={summary.wrongNumber} subtitle={`${summary.wrongNumberRate}%`} icon={PhoneMissed} iconBg="bg-muted" iconColor="text-muted-foreground" />
      </div>

      {/* Per Agent Table — merged Agent Scores + Breakdown */}
      {agentRows.length > 0 && (() => {
        const scoresMap: Record<string, AgentScore> = {};
        agentScores.forEach(s => { scoresMap[s.id] = s; });
        // Sort by confirmation rate (from scores) desc, fallback to handled count
        const rankedRows = [...agentRows].sort((a, b) => {
          const ra = scoresMap[a.id]?.confirmationRate ?? a.confirmRate;
          const rb = scoresMap[b.id]?.confirmationRate ?? b.confirmRate;
          if (rb !== ra) return rb - ra;
          return b.total - a.total;
        });
        return (
          <div className="bg-card rounded-lg border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Agent Performance Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 pr-3">Rank</th>
                    <th className="text-left py-2 pr-3">Agent</th>
                    <th className="text-right py-2 pr-3">Handled</th>
                    <th className="text-right py-2 pr-3">No Answer</th>
                    <th className="text-right py-2 pr-3">Postponed</th>
                    <th className="text-right py-2 pr-3">Confirmed</th>
                    <th className="text-right py-2 pr-3">Cancelled</th>
                    <th className="text-right py-2 pr-3">Conf. Rate</th>
                    <th className="text-right py-2 pr-3">Delivered</th>
                    <th className="text-right py-2 pr-3">Del. Rate</th>
                    <th className="text-right py-2 pr-3">Workload</th>
                    <th className="text-left py-2">Insight</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedRows.map((a, i) => {
                    const perf = getPerformanceLabel(a.confirmRate, a.workloadPct, avgWorkload);
                    const score = scoresMap[a.id];
                    const confRate = score?.confirmationRate ?? a.confirmRate;
                    const delivered = score?.delivered ?? 0;
                    const delRate = score?.deliveryRate ?? 0;
                    return (
                      <tr key={a.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 pr-3">
                          <span className={cn(
                            "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold",
                            i === 0 ? "bg-warning/20 text-warning" : i === 1 ? "bg-muted text-muted-foreground" : i === 2 ? "bg-warning/10 text-warning" : "text-muted-foreground"
                          )}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 font-medium">{a.name}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{a.total}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{a.noAnswer}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{a.postponed}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{a.confirmed}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{a.cancelled}</td>
                        <td className="py-2.5 pr-3 text-right">{rateBadge(confRate)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{delivered}</td>
                        <td className="py-2.5 pr-3 text-right">{rateBadge(delRate)}</td>
                        <td className="py-2.5 pr-3 text-right">
                          <span className="text-xs font-medium tabular-nums">{a.workloadPct}%</span>
                        </td>
                        <td className="py-2.5">
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", perf.bg, perf.color)}>
                            {perf.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Insights Panel */}
      {insights.length > 0 && (
        <div className="bg-card rounded-lg border p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Performance Insights</h3>
          </div>
          <div className="space-y-2">
            {insights.map((msg, i) => (
              <p key={i} className="text-sm">{msg}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
