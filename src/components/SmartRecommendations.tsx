import { useMemo } from "react";
import {
  AlertTriangle,
  TrendingUp,
  PhoneOff,
  RotateCcw,
  Zap,
  Award,
  Lightbulb,
  Clock,
  Target,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AgentOrderData {
  agent_id: string;
  original_agent_id: string | null;
  confirmation_status: string;
  delivery_status: string | null;
  created_at: string;
  assigned_at: string | null;
  confirmed_at: string | null;
  attempt_count: number;
  postpone_date: string | null;
}

interface OrderHistoryEntry {
  order_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

interface CallData {
  agent_id: string;
  duration: number | null;
}

interface Props {
  orders: AgentOrderData[];
  orderHistory: OrderHistoryEntry[];
  calls: CallData[];
  profileNameMap: Record<string, string>;
  agentIds: string[];
}

interface AgentInsight {
  agentId: string;
  name: string;
  totalProcessed: number;
  confirmed: number;
  cancelled: number;
  noAnswer: number;
  postponed: number;
  confirmationRate: number;
  noAnswerRate: number;
  cancellationRate: number;
  avgTimePerOrderMs: number | null;
  avgRetries: number;
  retrySuccessRate: number;
  confirmedAfterRetry: number;
  totalRetried: number;
  efficiencyScore: number;
  primaryRecommendation: string;
  issues: Issue[];
  level: "critical" | "warning" | "good";
}

interface Issue {
  message: string;
  severity: "critical" | "warning" | "info";
}

function formatMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function SmartRecommendations({ orders, orderHistory, calls, profileNameMap, agentIds }: Props) {
  const insights = useMemo(() => {
    // Build handling time from order_history: agent_id claim → first status change
    const agentClaimMap: Record<string, { time: string; agentId: string }> = {};
    const firstChangeAfterClaim: Record<string, string> = {};

    orderHistory.forEach((h) => {
      if (h.field_changed === "agent_id" && !h.old_value && h.new_value && !agentClaimMap[h.order_id]) {
        agentClaimMap[h.order_id] = { time: h.created_at, agentId: h.new_value };
      }
    });

    orderHistory.forEach((h) => {
      if (h.field_changed === "confirmation_status" && agentClaimMap[h.order_id] && !firstChangeAfterClaim[h.order_id]) {
        const claimTime = new Date(agentClaimMap[h.order_id].time).getTime();
        const changeTime = new Date(h.created_at).getTime();
        if (changeTime >= claimTime) {
          firstChangeAfterClaim[h.order_id] = h.created_at;
        }
      }
    });

    // Handling times per agent from history
    const handlingTimeByAgent: Record<string, number[]> = {};
    const allHandlingTimes: number[] = [];
    for (const [orderId, changeTime] of Object.entries(firstChangeAfterClaim)) {
      const claim = agentClaimMap[orderId];
      if (!claim) continue;
      const diff = new Date(changeTime).getTime() - new Date(claim.time).getTime();
      if (diff > 0 && diff < 86400000) {
        if (!handlingTimeByAgent[claim.agentId]) handlingTimeByAgent[claim.agentId] = [];
        handlingTimeByAgent[claim.agentId].push(diff);
        allHandlingTimes.push(diff);
      }
    }

    const teamAvgHandlingMs = allHandlingTimes.length > 0
      ? allHandlingTimes.reduce((s, v) => s + v, 0) / allHandlingTimes.length
      : 0;

    // Group orders by the agent who processed them (use original_agent_id if agent_id is null)
    const agentOrders: Record<string, AgentOrderData[]> = {};
    orders.forEach((o) => {
      const effectiveAgent = o.agent_id || o.original_agent_id;
      if (!effectiveAgent) return;
      if (!agentOrders[effectiveAgent]) agentOrders[effectiveAgent] = [];
      agentOrders[effectiveAgent].push(o);
    });

    const allInsights: AgentInsight[] = [];

    for (const agentId of agentIds) {
      const aOrders = agentOrders[agentId] || [];
      if (aOrders.length === 0) continue;

      // Only count processed orders (status changed from new)
      const processed = aOrders.filter(
        (o) => !["new"].includes(o.confirmation_status)
      );
      const totalProcessed = processed.length;
      if (totalProcessed === 0) continue;

      const confirmed = processed.filter((o) => o.confirmation_status === "confirmed").length;
      const cancelled = processed.filter((o) => o.confirmation_status === "cancelled").length;
      const noAnswer = processed.filter((o) => o.confirmation_status === "no_answer" || o.confirmation_status === "unreachable").length;
      const postponed = processed.filter((o) => o.confirmation_status === "postponed").length;

      const confirmationRate = Math.round((confirmed / totalProcessed) * 100);
      const noAnswerRate = Math.round((noAnswer / totalProcessed) * 100);
      const cancellationRate = Math.round((cancelled / totalProcessed) * 100);

      // Retry performance: orders with attempt_count > 1
      const retriedOrders = processed.filter((o) => o.attempt_count > 1);
      const totalRetried = retriedOrders.length;
      const confirmedAfterRetry = retriedOrders.filter((o) => o.confirmation_status === "confirmed").length;
      const retrySuccessRate = totalRetried > 0 ? Math.round((confirmedAfterRetry / totalRetried) * 100) : 0;

      // Avg retries (only for orders that had retries)
      const totalRetryAttempts = processed.reduce((s, o) => s + (o.attempt_count || 0), 0);
      const avgRetries = totalProcessed > 0 ? Math.round((totalRetryAttempts / totalProcessed) * 10) / 10 : 0;

      // Handling time
      const handlingTimes = handlingTimeByAgent[agentId] || [];
      const avgTimePerOrderMs = handlingTimes.length > 0
        ? handlingTimes.reduce((s, v) => s + v, 0) / handlingTimes.length
        : null;

      // ===== EFFICIENCY SCORE (0-100) =====
      // Weights: confirmation_rate 40%, no_answer_rate 25%, speed 20%, retry_dependency 15%

      // 1. Confirmation component (0-40): confirmationRate maps linearly to 0-40
      const confScore = (confirmationRate / 100) * 40;

      // 2. No answer component (0-25): lower is better. 0% no_answer = 25pts, 100% = 0pts
      const naScore = ((100 - noAnswerRate) / 100) * 25;

      // 3. Speed component (0-20): compare to team average, cap at 2x slower = 0pts
      let speedScore = 20; // default if no data
      if (avgTimePerOrderMs !== null && teamAvgHandlingMs > 0) {
        const ratio = avgTimePerOrderMs / teamAvgHandlingMs;
        // ratio 0.5 = fastest → 20pts, ratio 1.0 = avg → 15pts, ratio 2.0+ = slow → 0pts
        speedScore = Math.max(0, Math.min(20, Math.round(20 * (1 - (ratio - 0.5) / 1.5))));
      }

      // 4. Retry dependency (0-15): lower avgRetries is better. 0 retries = 15pts, 3+ = 0pts
      const retryDepScore = Math.max(0, Math.min(15, Math.round(15 * (1 - avgRetries / 3))));

      const efficiencyScore = Math.min(100, Math.max(0, Math.round(confScore + naScore + speedScore + retryDepScore)));

      // ===== ISSUE DETECTION =====
      const issues: Issue[] = [];

      if (confirmationRate < 50) {
        issues.push({ message: "Low confirmation rate — needs closing training", severity: "critical" });
      }
      if (noAnswerRate > 40) {
        issues.push({ message: "High no answer rate — improve call timing", severity: "critical" });
      }
      if (avgTimePerOrderMs && teamAvgHandlingMs > 0 && avgTimePerOrderMs > teamAvgHandlingMs * 1.5) {
        issues.push({ message: "Agent is slow — improve handling efficiency", severity: "warning" });
      }
      if (avgRetries > 2) {
        issues.push({ message: "Too many retries — low first-call success", severity: "warning" });
      }
      if (cancellationRate > 40) {
        issues.push({ message: "High cancellation rate — review product/pitch fit", severity: "warning" });
      }
      if (confirmationRate >= 70 && noAnswerRate <= 25) {
        issues.push({ message: "High performer — use as team benchmark", severity: "info" });
      }

      // ===== PRIMARY RECOMMENDATION =====
      let primaryRecommendation = "Maintain current performance";
      const criticals = issues.filter((i) => i.severity === "critical");
      const warnings = issues.filter((i) => i.severity === "warning");

      if (criticals.length > 0) {
        if (criticals[0].message.includes("confirmation")) {
          primaryRecommendation = "Schedule closing technique training session";
        } else if (criticals[0].message.includes("no answer")) {
          primaryRecommendation = "Adjust calling schedule to peak hours";
        }
      } else if (warnings.length > 0) {
        if (warnings[0].message.includes("slow")) {
          primaryRecommendation = "Pair with top performer for workflow coaching";
        } else if (warnings[0].message.includes("retries")) {
          primaryRecommendation = "Focus on first-call resolution techniques";
        } else if (warnings[0].message.includes("cancellation")) {
          primaryRecommendation = "Review pitch script and objection handling";
        }
      } else if (confirmationRate >= 70) {
        primaryRecommendation = "Consider for mentor role — share best practices";
      }

      let level: "critical" | "warning" | "good" = "good";
      if (issues.some((i) => i.severity === "critical")) level = "critical";
      else if (issues.some((i) => i.severity === "warning")) level = "warning";

      allInsights.push({
        agentId,
        name: profileNameMap[agentId] || agentId.slice(0, 8),
        totalProcessed,
        confirmed,
        cancelled,
        noAnswer,
        postponed,
        confirmationRate,
        noAnswerRate,
        cancellationRate,
        avgTimePerOrderMs,
        avgRetries,
        retrySuccessRate,
        confirmedAfterRetry,
        totalRetried,
        efficiencyScore,
        primaryRecommendation,
        issues,
        level,
      });
    }

    // Sort: critical first, then warning, then good
    return allInsights.sort((a, b) => {
      const levelOrder = { critical: 0, warning: 1, good: 2 };
      if (levelOrder[a.level] !== levelOrder[b.level]) return levelOrder[a.level] - levelOrder[b.level];
      return a.efficiencyScore - b.efficiencyScore;
    });
  }, [orders, orderHistory, calls, profileNameMap, agentIds]);

  if (insights.length === 0) return null;

  const levelStyles = {
    critical: "border-destructive/30 bg-destructive/5",
    warning: "border-warning/30 bg-warning/5",
    good: "border-success/30 bg-success/5",
  };

  const levelIcon = {
    critical: <AlertTriangle className="h-4 w-4 text-destructive" />,
    warning: <AlertTriangle className="h-4 w-4 text-warning" />,
    good: <Award className="h-4 w-4 text-success" />,
  };

  const severityBadge = {
    critical: "bg-destructive/10 text-destructive border-destructive/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    info: "bg-success/10 text-success border-success/20",
  };

  const scoreColor = (score: number) =>
    score >= 75 ? "text-success" : score >= 50 ? "text-warning" : "text-destructive";

  const scoreRing = (score: number) =>
    score >= 75 ? "border-success" : score >= 50 ? "border-warning" : "border-destructive";

  return (
    <div className="space-y-4 animate-slide-up" style={{ animationDelay: "300ms" }}>
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Performance Insights & Recommendations
        </h2>
        <span className="text-xs text-muted-foreground">
          ({insights.length} agent{insights.length !== 1 ? "s" : ""})
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {insights.map((agent) => (
          <div
            key={agent.agentId}
            className={cn(
              "rounded-xl border p-5 space-y-4 transition-all hover:shadow-md",
              levelStyles[agent.level]
            )}
          >
            {/* Header with Score */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {levelIcon[agent.level]}
                <h3 className="font-semibold text-sm">{agent.name}</h3>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{agent.totalProcessed} processed</span>
                <div className={cn("flex items-center justify-center w-11 h-11 rounded-full border-2", scoreRing(agent.efficiencyScore))}>
                  <span className={cn("text-sm font-bold tabular-nums", scoreColor(agent.efficiencyScore))}>
                    {agent.efficiencyScore}
                  </span>
                </div>
              </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center p-2 rounded-lg bg-background/50">
                <div className="flex items-center justify-center mb-0.5">
                  <TrendingUp className="h-3 w-3 text-muted-foreground" />
                </div>
                <p className={cn("text-base font-bold tabular-nums",
                  agent.confirmationRate >= 70 ? "text-success" : agent.confirmationRate >= 50 ? "text-warning" : "text-destructive"
                )}>
                  {agent.confirmationRate}%
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">Confirmed</p>
              </div>

              <div className="text-center p-2 rounded-lg bg-background/50">
                <div className="flex items-center justify-center mb-0.5">
                  <PhoneOff className="h-3 w-3 text-muted-foreground" />
                </div>
                <p className={cn("text-base font-bold tabular-nums",
                  agent.noAnswerRate <= 25 ? "text-success" : agent.noAnswerRate <= 40 ? "text-warning" : "text-destructive"
                )}>
                  {agent.noAnswerRate}%
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">No Answer</p>
              </div>

              <div className="text-center p-2 rounded-lg bg-background/50">
                <div className="flex items-center justify-center mb-0.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                </div>
                <p className="text-base font-bold tabular-nums">
                  {agent.avgTimePerOrderMs !== null ? formatMs(agent.avgTimePerOrderMs) : "N/A"}
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">Avg Time</p>
              </div>

              <div className="text-center p-2 rounded-lg bg-background/50">
                <div className="flex items-center justify-center mb-0.5">
                  <RotateCcw className="h-3 w-3 text-muted-foreground" />
                </div>
                <p className="text-base font-bold tabular-nums">{agent.avgRetries}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">Avg Retries</p>
              </div>
            </div>

            {/* Retry performance row */}
            {agent.totalRetried > 0 && (
              <div className="flex items-center gap-2 text-xs bg-background/50 rounded-lg px-3 py-2">
                <Target className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Retry success:</span>
                <span className={cn("font-semibold", agent.retrySuccessRate >= 50 ? "text-success" : "text-warning")}>
                  {agent.retrySuccessRate}%
                </span>
                <span className="text-muted-foreground">({agent.confirmedAfterRetry}/{agent.totalRetried} orders)</span>
              </div>
            )}

            {/* Status breakdown bar */}
            <div className="space-y-1">
              <div className="flex h-2 rounded-full overflow-hidden">
                {agent.confirmed > 0 && (
                  <div className="bg-success" style={{ width: `${(agent.confirmed / agent.totalProcessed) * 100}%` }} />
                )}
                {agent.noAnswer > 0 && (
                  <div className="bg-blue-500" style={{ width: `${(agent.noAnswer / agent.totalProcessed) * 100}%` }} />
                )}
                {agent.cancelled > 0 && (
                  <div className="bg-destructive" style={{ width: `${(agent.cancelled / agent.totalProcessed) * 100}%` }} />
                )}
                {agent.postponed > 0 && (
                  <div className="bg-warning" style={{ width: `${(agent.postponed / agent.totalProcessed) * 100}%` }} />
                )}
              </div>
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success inline-block" />{agent.confirmed} confirmed</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />{agent.noAnswer} no answer</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive inline-block" />{agent.cancelled} cancelled</span>
                {agent.postponed > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning inline-block" />{agent.postponed} postponed</span>}
              </div>
            </div>

            {/* Issues */}
            {agent.issues.length > 0 && (
              <div className="space-y-1.5">
                {agent.issues.map((issue, i) => (
                  <div key={i} className={cn("text-xs px-2.5 py-1.5 rounded-lg border", severityBadge[issue.severity])}>
                    {issue.message}
                  </div>
                ))}
              </div>
            )}

            {/* Primary Recommendation */}
            <div className="border-t border-border/50 pt-3">
              <div className="flex items-start gap-2">
                <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">
                    Recommendation
                  </p>
                  <p className="text-xs font-medium text-foreground">{agent.primaryRecommendation}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
