import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { startOfDayPKT, nowPKT, formatPKT } from "@/lib/timezone";
import {
  CheckCircle2, PackageCheck, MessageCircleQuestion, Inbox, Reply, Clock, FileText, Users, TrendingUp,
} from "lucide-react";

const TOOLTIP_STYLE = {
  borderRadius: "12px",
  border: "1px solid hsl(var(--border))",
  fontSize: "12px",
  background: "hsl(var(--card))",
  color: "hsl(var(--foreground))",
  boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
};

// Same "reached the courier/logistics pipeline" set DeliveryAnalytics.tsx uses
// for its Confirmed→Shipped pool, reused here so "Booked" means the same
// thing everywhere in the app.
const BOOKED_DELIVERY_STATUSES = [
  "booked", "printed", "dispatched", "shipped", "in_transit", "with_courier", "out_for_delivery",
  "delivered", "paid", "failed_attempt", "returned", "return", "ready_for_return", "return_received",
];

const PAGE_SIZE = 1000;

type Phase = "all" | "confirmation" | "delivery";

type MessageRow = {
  conversation_id: string;
  order_id: string | null;
  direction: string;
  message_type: string;
  status: string | null;
  payload: unknown;
  sent_by: string | null;
  created_at: string;
};

type ConversationLiteRow = { order_id: string | null; last_inbound_at: string; last_reply_at: string | null };

function pct(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

async function fetchAllPaged<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

// Only the orders actually referenced by today's WhatsApp activity are looked
// up — a lightweight targeted fetch instead of pulling the whole orders table
// on every 30s refresh.
async function fetchOrderPhaseMap(orderIds: string[]): Promise<Map<string, Phase>> {
  const ids = Array.from(new Set(orderIds.filter((id): id is string => !!id)));
  const map = new Map<string, Phase>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase.from("orders").select("order_id, confirmation_status").in("order_id", chunk);
    if (error) throw error;
    (data || []).forEach((o) => {
      map.set(o.order_id, o.confirmation_status === "confirmed" ? "delivery" : "confirmation");
    });
  }
  return map;
}

function templateNameOf(payload: unknown): string {
  const p = (payload || {}) as Record<string, unknown>;
  const direct = p["_template_name"];
  if (typeof direct === "string" && direct) return direct;
  const nested = (p["template"] as Record<string, unknown> | undefined)?.["name"];
  if (typeof nested === "string" && nested) return nested;
  return "Unknown template";
}

function computeReplyStats(msgs: { conversation_id: string; direction: string; created_at: string }[]) {
  const byConv = new Map<string, { in: string[]; out: string[] }>();
  msgs.forEach((m) => {
    const entry = byConv.get(m.conversation_id) || { in: [], out: [] };
    (m.direction === "in" ? entry.in : entry.out).push(m.created_at);
    byConv.set(m.conversation_id, entry);
  });
  let withInbound = 0;
  let replied = 0;
  const responseMinutes: number[] = [];
  byConv.forEach(({ in: inbound, out }) => {
    if (inbound.length === 0) return;
    withInbound++;
    const firstIn = inbound.reduce((a, b) => (a < b ? a : b));
    const firstOutAfter = out.filter((t) => t > firstIn).sort()[0];
    if (firstOutAfter) {
      replied++;
      responseMinutes.push((new Date(firstOutAfter).getTime() - new Date(firstIn).getTime()) / 60000);
    }
  });
  const avgFirstResponseMin = responseMinutes.length
    ? Math.round((responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length) * 10) / 10
    : null;
  return { withInbound, replied, replyRate: pct(replied, withInbound), avgFirstResponseMin };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TREND_DAYS = 7;

// Real-UTC day buckets anchored to midnight PKT — see useDashboardData.ts's
// computeDailyData for why this avoids eachDayOfIntervalPKT/toPKT here (those
// return zoned Date objects that can't be compared directly to raw UTC
// timestamps from created_at/confirmed_at).
function buildTrendDayBuckets() {
  const todayStart = startOfDayPKT(nowPKT());
  return Array.from({ length: TREND_DAYS }, (_, i) => {
    const daysBack = TREND_DAYS - 1 - i;
    const start = new Date(todayStart.getTime() - daysBack * MS_PER_DAY);
    const nextDay = new Date(start.getTime() + MS_PER_DAY);
    return { start, nextDay, label: formatPKT(start, "EEE d") };
  });
}

function isInDay(iso: string, start: Date, nextDay: Date) {
  const d = new Date(iso);
  return d >= start && d < nextDay;
}

export default function WhatsappOverview() {
  const [phase, setPhase] = useState<Phase>("all");

  const { data: stats } = useQuery({
    queryKey: ["wts-overview-v2"],
    queryFn: async () => {
      const todayStartISO = startOfDayPKT(nowPKT()).toISOString();

      const [todayMessages, unansweredRows, newConvRows, confirmedWtsToday, profiles] = await Promise.all([
        fetchAllPaged<MessageRow>((from, to) =>
          supabase
            .from("whatsapp_messages")
            .select("conversation_id, order_id, direction, message_type, status, payload, sent_by, created_at")
            .gte("created_at", todayStartISO)
            .range(from, to),
        ),
        // Conversations whose latest customer message has no reply yet. PostgREST filters can't
        // compare two columns to each other, so this is counted client-side.
        fetchAllPaged<ConversationLiteRow>((from, to) =>
          supabase
            .from("whatsapp_conversations")
            .select("order_id, last_inbound_at, last_reply_at")
            .not("last_inbound_at", "is", null)
            .range(from, to),
        ),
        fetchAllPaged<{ order_id: string | null }>((from, to) =>
          supabase.from("whatsapp_conversations").select("order_id").gte("created_at", todayStartISO).range(from, to),
        ),
        fetchAllPaged<{ order_id: string; delivery_status: string | null }>((from, to) =>
          supabase
            .from("orders")
            .select("order_id, delivery_status")
            .eq("confirmation_channel", "whatsapp")
            .eq("confirmation_status", "confirmed")
            .gte("confirmed_at", todayStartISO)
            .range(from, to),
        ),
        supabase.from("profiles").select("user_id, name"),
      ]);

      const phaseMap = await fetchOrderPhaseMap([
        ...todayMessages.map((m) => m.order_id),
        ...unansweredRows.map((c) => c.order_id),
      ]);
      const inPhase = (orderId: string | null) => phase === "all" || phaseMap.get(orderId ?? "") === phase;

      const nameByUserId = new Map((profiles.data || []).map((p) => [p.user_id as string, p.name as string]));

      const scopedMessages = todayMessages.filter((m) => inPhase(m.order_id));

      // Templates sent today — grouped by template name, only ones actually sent.
      const templateTotals = new Map<string, { count: number; ok: number }>();
      scopedMessages
        .filter((m) => m.message_type === "template" && m.direction === "out")
        .forEach((m) => {
          const name = templateNameOf(m.payload);
          const cur = templateTotals.get(name) || { count: 0, ok: 0 };
          cur.count++;
          if (m.status !== "failed") cur.ok++;
          templateTotals.set(name, cur);
        });
      const templatesSentToday = Array.from(templateTotals.entries())
        .map(([name, d]) => ({ name, count: d.count, successRate: pct(d.ok, d.count) }))
        .sort((a, b) => b.count - a.count);

      // Replies sent by agent today — only manual sends carry a sent_by (automation/campaign sends don't).
      const agentTotals = new Map<string, number>();
      scopedMessages
        .filter((m) => m.direction === "out" && m.sent_by)
        .forEach((m) => agentTotals.set(m.sent_by as string, (agentTotals.get(m.sent_by as string) || 0) + 1));
      const repliesByAgentToday = Array.from(agentTotals.entries())
        .map(([userId, count]) => ({ userId, name: nameByUserId.get(userId) || userId.slice(0, 8), count }))
        .sort((a, b) => b.count - a.count);

      const unanswered = unansweredRows.filter(
        (c) => inPhase(c.order_id) && (!c.last_reply_at || new Date(c.last_reply_at) < new Date(c.last_inbound_at)),
      ).length;

      const newOrdersIntoWhatsappToday = newConvRows.length;

      const confirmedCount = confirmedWtsToday.length;
      const bookedCount = confirmedWtsToday.filter((o) => BOOKED_DELIVERY_STATUSES.includes(o.delivery_status || "")).length;

      const { withInbound, replied, replyRate, avgFirstResponseMin } = computeReplyStats(scopedMessages);

      return {
        templatesSentToday,
        repliesByAgentToday,
        unanswered,
        newOrdersIntoWhatsappToday,
        confirmedCount,
        bookedCount,
        bookedRate: pct(bookedCount, confirmedCount),
        replyRate,
        withInbound,
        replied,
        avgFirstResponseMin,
      };
    },
    refetchInterval: 30000,
  });

  const { data: trend } = useQuery({
    queryKey: ["wts-overview-trend-v1"],
    queryFn: async () => {
      const buckets = buildTrendDayBuckets();
      const windowStartISO = buckets[0].start.toISOString();

      const [newConvRows, repliesRows, confirmedRows] = await Promise.all([
        fetchAllPaged<{ created_at: string }>((from, to) =>
          supabase.from("whatsapp_conversations").select("created_at").gte("created_at", windowStartISO).range(from, to),
        ),
        fetchAllPaged<{ created_at: string }>((from, to) =>
          supabase
            .from("whatsapp_messages")
            .select("created_at")
            .eq("direction", "out")
            .gte("created_at", windowStartISO)
            .range(from, to),
        ),
        fetchAllPaged<{ confirmed_at: string }>((from, to) =>
          supabase
            .from("orders")
            .select("confirmed_at")
            .eq("confirmation_channel", "whatsapp")
            .eq("confirmation_status", "confirmed")
            .gte("confirmed_at", windowStartISO)
            .range(from, to),
        ),
      ]);

      return buckets.map(({ start, nextDay, label }) => ({
        day: label,
        newOrders: newConvRows.filter((r) => isInDay(r.created_at, start, nextDay)).length,
        replies: repliesRows.filter((r) => isInDay(r.created_at, start, nextDay)).length,
        confirmed: confirmedRows.filter((r) => isInDay(r.confirmed_at, start, nextDay)).length,
      }));
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const kpis = [
    {
      label: "Unanswered now",
      value: stats?.unanswered ?? 0,
      icon: MessageCircleQuestion,
      tone: "text-amber-600",
    },
    {
      label: "New orders into WhatsApp today",
      value: stats?.newOrdersIntoWhatsappToday ?? 0,
      icon: Inbox,
      tone: "text-foreground",
    },
    {
      label: "Reply rate",
      value: `${stats?.replyRate ?? 0}%`,
      sub: stats ? `${stats.replied}/${stats.withInbound} conversations` : undefined,
      icon: Reply,
      tone: "text-emerald-600",
    },
    {
      label: "Avg first response time",
      value: stats?.avgFirstResponseMin != null ? `${stats.avgFirstResponseMin} min` : "—",
      icon: Clock,
      tone: "text-foreground",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">WhatsApp Overview</h2>
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          {([
            { value: "all", label: "All" },
            { value: "confirmation", label: "Confirmation phase" },
            { value: "delivery", label: "Delivery phase" },
          ] as { value: Phase; label: string }[]).map((f) => (
            <button
              key={f.value}
              onClick={() => setPhase(f.value)}
              className={cn(
                "px-3 py-1.5 transition-colors",
                phase === f.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Confirmed (WhatsApp) + Booked — always all-phase, this is definitionally
          about orders leaving the confirmation phase, so the toggle above doesn't apply. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Confirmed via WhatsApp today</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-8 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-2xl font-bold text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
                {stats?.confirmedCount ?? 0}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Confirmed</div>
            </div>
            <div>
              <div className="flex items-center gap-2 text-2xl font-bold text-foreground">
                <PackageCheck className="h-5 w-5" />
                {stats?.bookedCount ?? 0}
              </div>
              <div className="text-xs text-muted-foreground mt-1">Booked since</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{stats?.bookedRate ?? 0}%</div>
              <div className="text-xs text-muted-foreground mt-1">Booked rate</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.tone}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${c.tone}`}>{c.value}</div>
              {c.sub && <div className="text-xs text-muted-foreground mt-1">{c.sub}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" /> Templates sent today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!stats || stats.templatesSentToday.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">No templates sent today.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Template</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Success rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.templatesSentToday.map((t) => (
                    <TableRow key={t.name}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right">{t.count}</TableCell>
                      <TableCell className={cn("text-right", t.successRate >= 90 ? "text-emerald-600" : t.successRate >= 70 ? "text-amber-600" : "text-rose-600")}>
                        {t.successRate}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" /> Replies sent by agent today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!stats || stats.repliesByAgentToday.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">No manual replies sent today yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Replies</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.repliesByAgentToday.map((a) => (
                    <TableRow key={a.userId}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="text-right">{a.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> 7-day trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!trend ? (
            <div className="text-sm text-muted-foreground py-4">Loading…</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                    allowDecimals={false}
                  />
                  <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="newOrders" name="New WA orders" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="replies" name="Replies" stroke="hsl(220, 70%, 55%)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="confirmed" name="Confirmed" stroke="hsl(142, 70%, 45%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-5 mt-3 justify-center">
                {[
                  { label: "New WA orders", color: "hsl(var(--primary))" },
                  { label: "Replies", color: "hsl(220, 70%, 55%)" },
                  { label: "Confirmed", color: "hsl(142, 70%, 45%)" },
                ].map(({ label, color }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="h-2 w-4 rounded-full" style={{ background: color }} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
