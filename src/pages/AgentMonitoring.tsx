import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Activity, Timer, AlertTriangle, Trophy, Turtle, ListFilter, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceStrict } from "date-fns";
import { formatPKT as format } from "@/lib/timezone";
import { DatePresetFilter, getDateRangeFromPreset, type DatePresetValue } from "@/components/DatePresetFilter";
import type { DateRange } from "react-day-picker";

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

const RANGE_LABELS: Record<DatePresetValue, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  this_month: "This month",
  last_month: "Last month",
  maximum: "All time",
  custom: "Custom range",
};

export default function AgentMonitoring() {
  const [datePreset, setDatePreset] = useState<DatePresetValue>("today");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDateRangeFromPreset("today"));

  // Fetch activity log — same PKT-aware date range logic as the rest of the
  // app (DatePresetFilter), instead of a naive "last N×24h from right now"
  // window that didn't line up with real calendar-day/PKT boundaries.
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["agent-activity-log", dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      let query = supabase.from("agent_activity_log").select("*").order("created_at", { ascending: true });
      if (dateRange?.from) query = query.gte("created_at", dateRange.from.toISOString());
      if (dateRange?.to) query = query.lte("created_at", dateRange.to.toISOString());
      const { data, error } = await query;
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

  const rangeLabel = RANGE_LABELS[datePreset];

  // ── Full activity log (everything, not just idle gaps) ─────────────────
  const LOG_PAGE_SIZE = 50;
  const [logAgentFilter, setLogAgentFilter] = useState<string>("all");
  const [logTypeFilter, setLogTypeFilter] = useState<string>("all");
  const [logSearch, setLogSearch] = useState("");
  const [logPage, setLogPage] = useState(0);

  const distinctActivityTypes = useMemo(() => {
    return Array.from(new Set(activities.map((a) => a.activity_type))).sort();
  }, [activities]);

  const filteredLog = useMemo(() => {
    const search = logSearch.trim().toLowerCase();
    return activities
      .filter((a) => logAgentFilter === "all" || a.agent_id === logAgentFilter)
      .filter((a) => logTypeFilter === "all" || a.activity_type === logTypeFilter)
      .filter((a) => !search || (a.order_id || "").toLowerCase().includes(search))
      .slice()
      .reverse(); // most recent first — `activities` is fetched ascending for gap math
  }, [activities, logAgentFilter, logTypeFilter, logSearch]);

  const logPageCount = Math.max(1, Math.ceil(filteredLog.length / LOG_PAGE_SIZE));
  const pagedLog = useMemo(
    () => filteredLog.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE),
    [filteredLog, logPage],
  );

  const resetLogPage = () => setLogPage(0);

  return (
    <div className="space-y-6 w-full max-w-none">
      <div className="animate-fade-in flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agent Monitoring</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track agent productivity & idle time. Gaps &gt; 3 minutes are flagged.
          </p>
        </div>
        <DatePresetFilter
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          preset={datePreset}
          onPresetChange={setDatePreset}
        />
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

      {/* Full activity log — every claim and confirmation action, not just idle gaps */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ListFilter className="h-4 w-4" /> Full Activity Log
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Every logged action ({filteredLog.length.toLocaleString()} of {activities.length.toLocaleString()}) · {rangeLabel}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={logAgentFilter}
                onValueChange={(v) => { setLogAgentFilter(v); resetLogPage(); }}
              >
                <SelectTrigger className="h-8 text-xs w-[160px]">
                  <SelectValue placeholder="Agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.user_id} value={a.user_id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={logTypeFilter}
                onValueChange={(v) => { setLogTypeFilter(v); resetLogPage(); }}
              >
                <SelectTrigger className="h-8 text-xs w-[160px]">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {distinctActivityTypes.map((t) => (
                    <SelectItem key={t} value={t}>{activityLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={logSearch}
                onChange={(e) => { setLogSearch(e.target.value); resetLogPage(); }}
                placeholder="Search order ID…"
                className="h-8 text-xs w-[160px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : filteredLog.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm">No activity matches these filters.</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedLog.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                        {format(new Date(a.created_at), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{agentNameById.get(a.agent_id) || "Unknown"}</TableCell>
                      <TableCell className="text-sm">{activityLabel(a.activity_type)}</TableCell>
                      <TableCell>
                        {a.order_id ? (
                          <Link to={`/orders/${a.order_id}`} className="text-primary hover:underline text-xs font-mono">
                            {a.order_id}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Page {logPage + 1} of {logPageCount}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={logPage === 0}
                    onClick={() => setLogPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    disabled={logPage >= logPageCount - 1}
                    onClick={() => setLogPage((p) => Math.min(logPageCount - 1, p + 1))}
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
