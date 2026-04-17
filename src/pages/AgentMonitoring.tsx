import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Timer, AlertTriangle, Trophy, Turtle } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceStrict, format } from "date-fns";

type Activity = {
  id: string;
  agent_id: string;
  activity_type: string;
  order_id: string | null;
  metadata: any;
  created_at: string;
};

type AgentProfile = { user_id: string; name: string };

const IDLE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

function formatGap(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function activityLabel(type: string): string {
  const map: Record<string, string> = {
    claim: "🎯 Claim",
    edit_note: "📝 Note edit",
    edit_price: "💰 Price edit",
    edit_other: "✏️ Edit",
    reschedule: "📅 Reschedule",
  };
  if (map[type]) return map[type];
  if (type.startsWith("confirmation_")) return `✅ ${type.replace("confirmation_", "")}`;
  if (type.startsWith("delivery_")) return `📦 ${type.replace("delivery_", "")}`;
  if (type.startsWith("shipping_")) return `🚚 ${type.replace("shipping_", "")}`;
  return type;
}

export default function AgentMonitoring() {
  const [days, setDays] = useState(1);

  // Fetch activity log
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["agent-activity-log", days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("agent_activity_log")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as Activity[];
    },
    refetchInterval: 30000,
  });

  // Fetch agent names — include ALL agents (even those without profiles) so activities aren't dropped
  const { data: agents = [] } = useQuery({
    queryKey: ["agent-monitoring-profiles"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "agent");
      const ids = (roles || []).map((r) => r.user_id);
      if (!ids.length) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", ids);
      const profileMap = new Map((profiles || []).map((p) => [p.user_id, p.name]));
      return ids.map((id) => ({
        user_id: id,
        name: profileMap.get(id) || `Agent ${id.slice(0, 8)}`,
      })) as AgentProfile[];
    },
  });

  // Quick name lookup for any agent_id (handles activities from agents not in roles list)
  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.user_id, a.name);
    return m;
  }, [agents]);

  // Group activities per agent + compute gaps
  const perAgent = useMemo(() => {
    const map = new Map<string, { activities: Activity[]; gaps: { activity: Activity; gapMs: number; prev: Activity }[] }>();
    for (const agent of agents) {
      map.set(agent.user_id, { activities: [], gaps: [] });
    }
    for (const a of activities) {
      if (!map.has(a.agent_id)) {
        map.set(a.agent_id, { activities: [], gaps: [] });
      }
      map.get(a.agent_id)!.activities.push(a);
    }
    // Compute gaps per agent
    for (const [, val] of map.entries()) {
      const sorted = val.activities;
      for (let i = 1; i < sorted.length; i++) {
        const gapMs = new Date(sorted[i].created_at).getTime() - new Date(sorted[i - 1].created_at).getTime();
        if (gapMs >= IDLE_THRESHOLD_MS) {
          val.gaps.push({ activity: sorted[i], prev: sorted[i - 1], gapMs });
        }
      }
      // Sort gaps: longest first
      val.gaps.sort((a, b) => b.gapMs - a.gapMs);
    }
    return map;
  }, [activities, agents]);

  // KPIs
  const kpis = useMemo(() => {
    const allGaps: number[] = [];
    let totalActions = 0;
    let bestAgent: { name: string; avg: number } | null = null;
    let worstAgent: { name: string; avg: number } | null = null;

    for (const agent of agents) {
      const data = perAgent.get(agent.user_id);
      if (!data || data.activities.length < 2) continue;
      totalActions += data.activities.length;
      const agentGaps: number[] = [];
      for (let i = 1; i < data.activities.length; i++) {
        const g = new Date(data.activities[i].created_at).getTime() - new Date(data.activities[i - 1].created_at).getTime();
        // Cap at 30min so a long break doesn't skew average
        agentGaps.push(Math.min(g, 30 * 60 * 1000));
        allGaps.push(Math.min(g, 30 * 60 * 1000));
      }
      const avg = agentGaps.reduce((s, x) => s + x, 0) / agentGaps.length;
      if (!bestAgent || avg < bestAgent.avg) bestAgent = { name: agent.name, avg };
      if (!worstAgent || avg > worstAgent.avg) worstAgent = { name: agent.name, avg };
    }

    const avgReaction = allGaps.length ? allGaps.reduce((s, x) => s + x, 0) / allGaps.length : 0;
    const slowCount = Array.from(perAgent.values()).reduce((s, v) => s + v.gaps.length, 0);

    return { avgReaction, slowCount, bestAgent, worstAgent, totalActions };
  }, [perAgent, agents]);

  const rangeLabel = days === 1 ? "Today" : `Last ${days} days`;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="animate-fade-in flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agent Monitoring</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track agent productivity & idle time. Gaps &gt; 3 minutes are flagged.
          </p>
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {[
            { v: 1, l: "Today" },
            { v: 7, l: "7d" },
            { v: 30, l: "30d" },
          ].map((opt) => (
            <button
              key={opt.v}
              onClick={() => setDays(opt.v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                days === opt.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.l}
            </button>
          ))}
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Timer className="h-4 w-4" /> Avg Reaction Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis.avgReaction ? formatGap(kpis.avgReaction) : "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">{rangeLabel}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Idle Gaps &gt; 3min
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis.slowCount}</div>
            <div className="text-xs text-muted-foreground mt-1">Across all agents</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Trophy className="h-4 w-4 text-emerald-500" /> Fastest Agent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold truncate">{kpis.bestAgent?.name || "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {kpis.bestAgent ? `Ø ${formatGap(kpis.bestAgent.avg)}` : "No data"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Turtle className="h-4 w-4 text-rose-500" /> Slowest Agent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold truncate">{kpis.worstAgent?.name || "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {kpis.worstAgent ? `Ø ${formatGap(kpis.worstAgent.avg)}` : "No data"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-agent tabs */}
      {isLoading ? (
        <Skeleton className="h-[400px] w-full" />
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">No agents found.</CardContent>
        </Card>
      ) : (
        <Tabs defaultValue={agents[0]?.user_id} className="w-full">
          <TabsList className="flex-wrap h-auto">
            {agents.map((agent) => {
              const data = perAgent.get(agent.user_id);
              const slowCount = data?.gaps.length || 0;
              return (
                <TabsTrigger key={agent.user_id} value={agent.user_id} className="gap-2">
                  {agent.name}
                  {slowCount > 0 && (
                    <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 h-5 px-1.5 text-[10px]">
                      {slowCount}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {agents.map((agent) => {
            const data = perAgent.get(agent.user_id);
            const gaps = data?.gaps || [];
            const totalActs = data?.activities.length || 0;
            return (
              <TabsContent key={agent.user_id} value={agent.user_id} className="mt-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{agent.name}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          {totalActs} actions · {gaps.length} idle gaps &gt; 3min
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {gaps.length === 0 ? (
                      <div className="p-12 text-center text-muted-foreground text-sm">
                        ✅ No idle gaps over 3 minutes in this period.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Agent</TableHead>
                            <TableHead>Idle Duration</TableHead>
                            <TableHead>From</TableHead>
                            <TableHead>To</TableHead>
                            <TableHead>Next Action</TableHead>
                            <TableHead>Order</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gaps.map((g, idx) => {
                            const severe = g.gapMs >= 10 * 60 * 1000;
                            return (
                              <TableRow key={idx}>
                                <TableCell className="font-medium text-sm">{agentNameById.get(g.activity.agent_id) || agent.name}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant="secondary"
                                    className={
                                      severe
                                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-400 font-mono"
                                        : "bg-amber-500/15 text-amber-700 dark:text-amber-400 font-mono"
                                    }
                                  >
                                    {formatGap(g.gapMs)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground font-mono">
                                  {format(new Date(g.prev.created_at), "MMM d, HH:mm:ss")}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground font-mono">
                                  {format(new Date(g.activity.created_at), "MMM d, HH:mm:ss")}
                                </TableCell>
                                <TableCell className="text-sm">{activityLabel(g.activity.activity_type)}</TableCell>
                                <TableCell>
                                  {g.activity.order_id ? (
                                    <Link
                                      to={`/orders/${g.activity.order_id}`}
                                      className="text-primary hover:underline text-xs font-mono"
                                    >
                                      {g.activity.order_id}
                                    </Link>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}
