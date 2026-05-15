import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  ShoppingCart, CheckCircle2, PhoneOff, Clock, XCircle,
  Users, TrendingUp, BarChart3, ClipboardCheck, Timer,
  Hourglass, PhoneMissed, MessageCircle, Phone,
} from "lucide-react";

interface Order {
  agent_id: string | null;
  original_agent_id: string | null;
  confirmation_status: string;
  confirmation_channel: string | null;
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
  profilePhoneMap?: Record<string, string>;
  agentIds: string[];
  agentScores?: AgentScore[];
  treatedOrders?: number;
  firstCallAvg?: string;
  handlingTime?: string;
  /** Override for the hero "Confirmed" count — uses dashboard-aligned confirmed_at logic */
  totalConfirmed?: number;
  /** Override for the WhatsApp channel split count */
  totalByWhatsApp?: number;
}

interface AgentRow {
  id: string;
  name: string;
  total: number;
  noAnswer: number;
  postponed: number;
  confirmed: number;
  cancelled: number;
  whatsappConfirmed: number;
  confirmRate: number;
  noAnswerRate: number;
  postponedRate: number;
  workloadPct: number;
}

function getPerformanceLabel(confirmRate: number, workloadPct: number, avgWorkload: number) {
  if (workloadPct < avgWorkload * 0.5) return { label: "Low workload",      color: "text-warning",           bg: "bg-warning/10" };
  if (confirmRate >= 70)               return { label: "Top performer",      color: "text-success",           bg: "bg-success/10" };
  if (confirmRate >= 50)               return { label: "Average",            color: "text-muted-foreground",  bg: "bg-muted" };
  return                                      { label: "Needs improvement",  color: "text-destructive",       bg: "bg-destructive/10" };
}

function getInsights(agents: AgentRow[], avgWorkload: number): string[] {
  const insights: string[] = [];
  const workloads = agents.map(a => a.workloadPct);
  const maxW = Math.max(...workloads);
  const minW = Math.min(...workloads);
  if (agents.length > 1 && maxW - minW > 25) insights.push("⚠️ Workload is not balanced across agents");
  agents.forEach(a => {
    if (a.noAnswerRate > 40) insights.push(`🔴 ${a.name} has high no-answer rate (${a.noAnswerRate}%)`);
    if (a.total > 0 && a.confirmRate < 40) insights.push(`🔴 ${a.name} is underperforming (${a.confirmRate}% confirmation)`);
    if (a.confirmRate >= 70 && a.total >= avgWorkload * 0.8) insights.push(`🟢 ${a.name} is a top performer`);
    if (a.workloadPct < avgWorkload * 0.5 && a.total > 0) insights.push(`🟡 ${a.name} handled fewer orders than others`);
  });
  return insights.slice(0, 6);
}

/* ── Reusable mini components ── */

function BigStat({
  label, value, sub, icon: Icon, accent, rate,
}: {
  label: string; value: number | string; sub?: string;
  icon: typeof ShoppingCart; accent: string; rate?: number;
}) {
  return (
    <div className={cn(
      "rounded-2xl border p-5 flex flex-col gap-3 group transition-all duration-200 hover:-translate-y-0.5",
      accent,
    )}>
      <div className="flex items-start justify-between">
        <div className="p-2 rounded-xl bg-white/10 dark:bg-white/5 backdrop-blur-sm">
          <Icon className="w-4 h-4" />
        </div>
        {rate !== undefined && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/15 tabular-nums">
            {rate}%
          </span>
        )}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest opacity-70">{label}</p>
        <p className="text-5xl font-black tabular-nums tracking-tight leading-none mt-1">{value}</p>
      </div>
      {sub && <p className="text-[11px] opacity-60">{sub}</p>}
    </div>
  );
}

function MetricCard({
  label, value, sub, icon: Icon, iconColor, valueColor,
}: {
  label: string; value: number | string; sub?: string;
  icon: typeof ShoppingCart; iconColor: string; valueColor?: string;
}) {
  return (
    <div className="bg-card rounded-xl border px-4 py-3.5 flex items-center gap-3 hover:shadow-card hover:-translate-y-0.5 transition-all duration-200">
      <div className={cn("p-2 rounded-lg bg-current/10 flex-shrink-0", iconColor)}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
        <p className={cn("text-xl font-bold tabular-nums leading-tight", valueColor ?? "text-foreground")}>{value}</p>
      </div>
      {sub && <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{sub}</span>}
    </div>
  );
}

function RateBar({ value, max, color, bg }: { value: number; max: number; color: string; bg: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className={cn("flex-1 h-1.5 rounded-full overflow-hidden", bg)}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs tabular-nums font-medium w-6 text-right">{value}</span>
    </div>
  );
}

function ConfRatePill({ rate }: { rate: number }) {
  const { bg, text } =
    rate >= 70 ? { bg: "bg-success/12 border-success/25",     text: "text-success" } :
    rate >= 40 ? { bg: "bg-warning/12 border-warning/25",     text: "text-warning" } :
                 { bg: "bg-destructive/12 border-destructive/25", text: "text-destructive" };
  return (
    <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold tabular-nums border", bg, text)}>
      {rate}%
    </span>
  );
}

/* ── Main component ── */

export function DailyConfirmationReport({
  orders, profileNameMap, profilePhoneMap = {}, agentIds, agentScores = [], treatedOrders, firstCallAvg, handlingTime,
  totalConfirmed, totalByWhatsApp,
}: DailyConfirmationReportProps) {

  const handledOrders = useMemo(
    () => orders.filter(o => (o.agent_id || o.original_agent_id) && o.confirmation_status !== "new"),
    [orders]
  );

  const s = useMemo(() => {
    const total       = handledOrders.length;

    // "confirmed" = ALL orders that reached confirmed stage (not just agent-handled ones).
    // Some orders are confirmed without agent assignment (imports, direct updates), so
    // counting from handledOrders alone under-counts versus what the dashboard shows.
    const confirmed   = orders.filter(o => o.confirmation_status === "confirmed").length;
    const handledConf = handledOrders.filter(o => o.confirmation_status === "confirmed").length;

    const noAnswer    = handledOrders.filter(o => o.confirmation_status === "no_answer").length;
    const postponed   = handledOrders.filter(o => o.postpone_date !== null || o.confirmation_status === "postponed").length;
    const cancelled   = handledOrders.filter(o => o.confirmation_status === "cancelled").length;
    const wrongNumber = handledOrders.filter(o => o.confirmation_status === "wrong_number").length;

    // Channel split uses all confirmed orders (same population as `confirmed`)
    const byWhatsApp  = orders.filter(o => o.confirmation_status === "confirmed" && o.confirmation_channel === "whatsapp").length;
    const byPhone     = confirmed - byWhatsApp;

    const p = (n: number, d = total) => d > 0 ? Math.round((n / d) * 100) : 0;
    return {
      total, confirmed, noAnswer, postponed, cancelled, wrongNumber, byWhatsApp, byPhone,
      // Rate = agent-handled confirmed / agent-handled total (meaningful performance metric)
      confirmRate:    p(handledConf),
      noAnswerRate:   p(noAnswer),
      postponedRate:  p(postponed),
      cancelledRate:  p(cancelled),
      wrongNumberRate:p(wrongNumber),
      whatsappRate:   p(byWhatsApp, confirmed),
      phoneRate:      p(byPhone, confirmed),
    };
  }, [handledOrders, orders]);

  const agentRows: AgentRow[] = useMemo(() => {
    const map: Record<string, { total: number; noAnswer: number; postponed: number; confirmed: number; cancelled: number; whatsappConfirmed: number }> = {};
    handledOrders.forEach(o => {
      const aid = o.agent_id || o.original_agent_id;
      if (!aid) return;
      if (!map[aid]) map[aid] = { total: 0, noAnswer: 0, postponed: 0, confirmed: 0, cancelled: 0, whatsappConfirmed: 0 };
      map[aid].total++;
      if (o.confirmation_status === "no_answer")  map[aid].noAnswer++;
      if (o.postpone_date || o.confirmation_status === "postponed") map[aid].postponed++;
      if (o.confirmation_status === "confirmed") {
        map[aid].confirmed++;
        if (o.confirmation_channel === "whatsapp") map[aid].whatsappConfirmed++;
      }
      if (o.confirmation_status === "cancelled") map[aid].cancelled++;
    });
    const totalAll = handledOrders.length || 1;
    const p = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;
    return Object.entries(map).map(([id, d]) => ({
      id,
      name:             profileNameMap[id] || id.slice(0, 8),
      total:            d.total,
      noAnswer:         d.noAnswer,
      postponed:        d.postponed,
      confirmed:        d.confirmed,
      cancelled:        d.cancelled,
      whatsappConfirmed:d.whatsappConfirmed,
      confirmRate:      p(d.confirmed, d.total),
      noAnswerRate:     p(d.noAnswer,  d.total),
      postponedRate:    p(d.postponed, d.total),
      workloadPct:      Math.round((d.total / totalAll) * 100),
    })).sort((a, b) => b.total - a.total);
  }, [handledOrders, profileNameMap]);

  const avgWorkload = agentRows.length > 0 ? 100 / agentRows.length : 100;
  const insights    = useMemo(() => getInsights(agentRows, avgWorkload), [agentRows, avgWorkload]);
  const maxTotal    = Math.max(...agentRows.map(a => a.total), 1);

  // WhatsApp row — orders confirmed via WhatsApp channel
  const whatsappRow = useMemo(() => {
    const waOrders = orders.filter(o => o.confirmation_channel === "whatsapp");
    const confirmed = waOrders.filter(o => o.confirmation_status === "confirmed").length;
    const noAnswer  = waOrders.filter(o => o.confirmation_status === "no_answer").length;
    const postponed = waOrders.filter(o => o.postpone_date !== null || o.confirmation_status === "postponed").length;
    const cancelled = waOrders.filter(o => o.confirmation_status === "cancelled").length;
    const total     = waOrders.length;
    return { total, confirmed, noAnswer, postponed, cancelled, confirmRate: total > 0 ? Math.round((confirmed / total) * 100) : 0 };
  }, [orders]);

  const scoresMap = useMemo(() => {
    const m: Record<string, AgentScore> = {};
    agentScores.forEach(s => { m[s.id] = s; });
    return m;
  }, [agentScores]);

  const rankedRows = useMemo(() =>
    [...agentRows].sort((a, b) => {
      const ra = scoresMap[a.id]?.confirmationRate ?? a.confirmRate;
      const rb = scoresMap[b.id]?.confirmationRate ?? b.confirmRate;
      return rb !== ra ? rb - ra : b.total - a.total;
    }),
  [agentRows, scoresMap]);

  if (orders.length === 0) {
    return (
      <div className="bg-card rounded-2xl border p-12 text-center">
        <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto mb-3">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No orders for the selected period</p>
        <p className="text-xs text-muted-foreground mt-1">Adjust the date filter to see data</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Section header ── */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
          <BarChart3 className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-bold leading-tight">Daily Performance Overview</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {s.total.toLocaleString()} orders handled
            {treatedOrders !== undefined && ` · ${treatedOrders.toLocaleString()} treated`}
          </p>
        </div>
      </div>

      {/* ── Hero row: 3 big coloured cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Handled */}
        <BigStat
          label="Handled"
          value={s.total}
          sub={treatedOrders !== undefined ? `${treatedOrders} treated · ${s.total > 0 ? Math.round((treatedOrders / s.total) * 100) : 0}% rate` : undefined}
          icon={ShoppingCart}
          accent="bg-[hsl(215,55%,30%)] text-white border-[hsl(215,55%,25%)] shadow-[0_2px_16px_hsl(215,55%,30%)/25]"
        />
        {/* Treated */}
        {treatedOrders !== undefined && (
          <BigStat
            label="Treated"
            value={treatedOrders}
            sub={`${s.total > 0 ? Math.round((treatedOrders / s.total) * 100) : 0}% of handled orders`}
            icon={ClipboardCheck}
            accent="bg-[hsl(250,45%,38%)] text-white border-[hsl(250,45%,30%)] shadow-[0_2px_16px_hsl(250,45%,38%)/25]"
          />
        )}
        {/* Confirmed — use parent-supplied accurate count when available */}
        {(() => {
          const dispConf  = totalConfirmed  ?? s.confirmed;
          const dispWA    = totalByWhatsApp ?? s.byWhatsApp;
          const dispPhone = dispConf - dispWA;
          return (
            <BigStat
              label="Confirmed"
              value={dispConf}
              rate={s.confirmRate}
              sub={`${dispPhone} phone · ${dispWA} WhatsApp`}
              icon={CheckCircle2}
              accent="bg-[hsl(155,50%,30%)] text-white border-[hsl(155,50%,25%)] shadow-[0_2px_16px_hsl(155,50%,30%)/25]"
            />
          );
        })()}
      </div>

      {/* ── Status distribution bar ── */}
      {s.total > 0 && (
        <div className="bg-card rounded-xl border px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Status Distribution</p>
          <div className="flex h-3 rounded-full overflow-hidden gap-px">
            {s.confirmed  > 0 && <div style={{ flex: s.confirmed  }} className="bg-[hsl(155,50%,42%)]" title={`Confirmed ${s.confirmRate}%`} />}
            {s.noAnswer   > 0 && <div style={{ flex: s.noAnswer   }} className="bg-[hsl(38,90%,55%)]"  title={`No Answer ${s.noAnswerRate}%`} />}
            {s.postponed  > 0 && <div style={{ flex: s.postponed  }} className="bg-[hsl(220,60%,55%)]" title={`Postponed ${s.postponedRate}%`} />}
            {s.cancelled  > 0 && <div style={{ flex: s.cancelled  }} className="bg-[hsl(0,65%,52%)]"   title={`Cancelled ${s.cancelledRate}%`} />}
            {s.wrongNumber> 0 && <div style={{ flex: s.wrongNumber}} className="bg-muted-foreground/40" title={`Wrong # ${s.wrongNumberRate}%`} />}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
            {[
              { label: "Confirmed",   n: s.confirmed,   pct: s.confirmRate,    color: "bg-[hsl(155,50%,42%)]" },
              { label: "No Answer",   n: s.noAnswer,    pct: s.noAnswerRate,   color: "bg-[hsl(38,90%,55%)]" },
              { label: "Postponed",   n: s.postponed,   pct: s.postponedRate,  color: "bg-[hsl(220,60%,55%)]" },
              { label: "Cancelled",   n: s.cancelled,   pct: s.cancelledRate,  color: "bg-[hsl(0,65%,52%)]" },
              { label: "Wrong #",     n: s.wrongNumber, pct: s.wrongNumberRate,color: "bg-muted-foreground/40" },
            ].filter(r => r.n > 0).map(r => (
              <div key={r.label} className="flex items-center gap-1.5">
                <div className={cn("w-2 h-2 rounded-sm flex-shrink-0", r.color)} />
                <span className="text-[11px] text-muted-foreground">{r.label}</span>
                <span className="text-[11px] font-semibold tabular-nums">{r.n}</span>
                <span className="text-[10px] text-muted-foreground">({r.pct}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Channel split + secondary metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">

        {/* Channel split card */}
        <div className="col-span-2 bg-card rounded-xl border px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Confirmed by Channel</p>
          {(() => {
            const dispConf  = totalConfirmed  ?? s.confirmed;
            const dispWA    = totalByWhatsApp ?? s.byWhatsApp;
            const dispPhone = dispConf - dispWA;
            const waRate    = dispConf > 0 ? Math.round((dispWA    / dispConf) * 100) : 0;
            const phRate    = dispConf > 0 ? Math.round((dispPhone / dispConf) * 100) : 0;
            return (
          <div className="space-y-2.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-medium">Phone</span>
                </div>
                <span className="text-xs tabular-nums font-semibold">{dispPhone} <span className="text-muted-foreground font-normal">({phRate}%)</span></span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-[hsl(215,60%,52%)] transition-all duration-500" style={{ width: `${phRate}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <MessageCircle className="h-3 w-3 text-[hsl(142,60%,42%)]" />
                  <span className="text-xs font-medium">WhatsApp</span>
                </div>
                <span className="text-xs tabular-nums font-semibold">{dispWA} <span className="text-muted-foreground font-normal">({waRate}%)</span></span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-[hsl(142,60%,42%)] transition-all duration-500" style={{ width: `${waRate}%` }} />
              </div>
            </div>
          </div>
            );
          })()}
        </div>

        <MetricCard label="No Answer"    value={s.noAnswer}    sub={`${s.noAnswerRate}%`}    icon={PhoneOff}    iconColor="text-warning"      valueColor="text-warning" />
        <MetricCard label="Postponed"    value={s.postponed}   sub={`${s.postponedRate}%`}   icon={Clock}       iconColor="text-primary"      />
        <MetricCard label="Cancelled"    value={s.cancelled}   sub={`${s.cancelledRate}%`}   icon={XCircle}     iconColor="text-destructive"  valueColor="text-destructive" />
        <MetricCard label="Wrong Number" value={s.wrongNumber} sub={`${s.wrongNumberRate}%`} icon={PhoneMissed} iconColor="text-muted-foreground" />
        {firstCallAvg && <MetricCard label="First Call Avg" value={firstCallAvg} icon={Timer}    iconColor="text-primary" />}
        {handlingTime  && <MetricCard label="Handling Time"  value={handlingTime}  icon={Hourglass} iconColor="text-primary" />}
      </div>

      {/* ── Agent Breakdown Table ── */}
      {rankedRows.length > 0 && (
        <div className="bg-card rounded-2xl border overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b bg-muted/20">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Agent Performance Breakdown</h3>
            <span className="ml-auto text-xs text-muted-foreground">{rankedRows.length} agents</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <th className="py-3 pl-6 pr-3 text-left w-10">#</th>
                  <th className="py-3 px-3 text-left">Agent</th>
                  <th className="py-3 px-3 text-right">Handled</th>
                  <th className="py-3 px-3 text-right">Confirmed</th>
                  <th className="py-3 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-[hsl(142,60%,42%)]">
                      <MessageCircle className="h-2.5 w-2.5" />WhatsApp
                    </span>
                  </th>
                  <th className="py-3 px-3 text-right">No Answer</th>
                  <th className="py-3 px-3 text-right">Postponed</th>
                  <th className="py-3 px-3 text-right">Cancelled</th>
                  <th className="py-3 px-3 text-right">Conf. Rate</th>
                  <th className="py-3 px-3 text-right">Delivered</th>
                  <th className="py-3 px-3 text-right">Del. Rate</th>
                  <th className="py-3 pl-3 pr-6 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rankedRows.map((a, i) => {
                  const perf     = getPerformanceLabel(a.confirmRate, a.workloadPct, avgWorkload);
                  const score    = scoresMap[a.id];
                  const confRate = score?.confirmationRate ?? a.confirmRate;
                  const delivered= score?.delivered ?? 0;
                  const delRate  = score?.deliveryRate ?? 0;

                  const rankStyle =
                    i === 0 ? "bg-[hsl(45,90%,55%)]/20 text-[hsl(35,80%,45%)] font-black" :
                    i === 1 ? "bg-muted text-muted-foreground font-bold" :
                    i === 2 ? "bg-[hsl(25,80%,55%)]/15 text-[hsl(25,80%,45%)] font-bold" :
                              "bg-muted/40 text-muted-foreground font-semibold";

                  return (
                    <tr key={a.id} className="hover:bg-muted/25 transition-colors group">
                      {/* Rank */}
                      <td className="py-3.5 pl-6 pr-3">
                        <span className={cn("inline-flex items-center justify-center w-6 h-6 rounded-full text-xs", rankStyle)}>
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                        </span>
                      </td>

                      {/* Agent name + WhatsApp link */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{a.name}</span>
                          {profilePhoneMap[a.id] && (
                            <a
                              href={`https://wa.me/${profilePhoneMap[a.id].replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[hsl(142,60%,42%)]/10 hover:bg-[hsl(142,60%,42%)]/20 text-[hsl(142,60%,42%)] transition-colors"
                              title={`WhatsApp ${a.name}`}
                            >
                              <MessageCircle className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Handled with mini bar */}
                      <td className="py-3.5 px-3">
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-sm font-semibold tabular-nums">{a.total}</span>
                          <RateBar value={a.total} max={maxTotal} color="hsl(215,60%,52%)" bg="bg-[hsl(215,60%,52%)]/15" />
                        </div>
                      </td>

                      {/* Confirmed */}
                      <td className="py-3.5 px-3 text-right">
                        <span className="text-sm font-bold tabular-nums text-[hsl(155,50%,38%)]">{a.confirmed}</span>
                      </td>

                      {/* WhatsApp */}
                      <td className="py-3.5 px-3 text-center">
                        {a.whatsappConfirmed > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[hsl(142,60%,42%)]/10 text-[hsl(142,60%,42%)] border border-[hsl(142,60%,42%)]/20">
                            <MessageCircle className="h-2.5 w-2.5" />
                            {a.whatsappConfirmed}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        )}
                      </td>

                      {/* No Answer */}
                      <td className="py-3.5 px-3 text-right">
                        <span className={cn("text-sm tabular-nums", a.noAnswerRate > 40 ? "text-warning font-semibold" : "text-muted-foreground")}>
                          {a.noAnswer}
                        </span>
                      </td>

                      {/* Postponed */}
                      <td className="py-3.5 px-3 text-right tabular-nums text-muted-foreground text-sm">{a.postponed}</td>

                      {/* Cancelled */}
                      <td className="py-3.5 px-3 text-right">
                        <span className={cn("text-sm tabular-nums", a.cancelled > 0 ? "text-destructive/80" : "text-muted-foreground")}>
                          {a.cancelled}
                        </span>
                      </td>

                      {/* Conf Rate */}
                      <td className="py-3.5 px-3 text-right"><ConfRatePill rate={confRate} /></td>

                      {/* Delivered */}
                      <td className="py-3.5 px-3 text-right tabular-nums text-muted-foreground text-sm">{delivered}</td>

                      {/* Del Rate */}
                      <td className="py-3.5 px-3 text-right"><ConfRatePill rate={delRate} /></td>

                      {/* Status label */}
                      <td className="py-3.5 pl-3 pr-6">
                        <span className={cn("px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap border", perf.bg, perf.color, "border-current/20")}>
                          {perf.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {/* WhatsApp row */}
                {whatsappRow.total > 0 && (
                  <tr className="bg-[hsl(142,60%,42%)]/5 border-t-2 border-[hsl(142,60%,42%)]/20">
                    {/* Rank */}
                    <td className="py-3.5 pl-6 pr-3">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[hsl(142,60%,42%)]/15 text-[hsl(142,60%,42%)]">
                        <MessageCircle className="h-3.5 w-3.5" />
                      </span>
                    </td>
                    {/* Name */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="font-semibold text-sm text-[hsl(142,60%,42%)]">WhatsApp</span>
                    </td>
                    {/* Handled */}
                    <td className="py-3.5 px-3">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular-nums">{whatsappRow.total}</span>
                        <RateBar value={whatsappRow.total} max={maxTotal} color="hsl(142,60%,42%)" bg="bg-[hsl(142,60%,42%)]/15" />
                      </div>
                    </td>
                    {/* Confirmed */}
                    <td className="py-3.5 px-3 text-right">
                      <span className="text-sm font-bold tabular-nums text-[hsl(155,50%,38%)]">{whatsappRow.confirmed}</span>
                    </td>
                    {/* WhatsApp col — N/A for this row */}
                    <td className="py-3.5 px-3 text-center">
                      <span className="text-muted-foreground/40 text-xs">—</span>
                    </td>
                    {/* No Answer */}
                    <td className="py-3.5 px-3 text-right">
                      <span className={cn("text-sm tabular-nums", whatsappRow.noAnswer > 0 ? "text-warning font-semibold" : "text-muted-foreground")}>
                        {whatsappRow.noAnswer || "—"}
                      </span>
                    </td>
                    {/* Postponed */}
                    <td className="py-3.5 px-3 text-right tabular-nums text-muted-foreground text-sm">{whatsappRow.postponed || "—"}</td>
                    {/* Cancelled */}
                    <td className="py-3.5 px-3 text-right">
                      <span className={cn("text-sm tabular-nums", whatsappRow.cancelled > 0 ? "text-destructive/80" : "text-muted-foreground")}>
                        {whatsappRow.cancelled || "—"}
                      </span>
                    </td>
                    {/* Conf Rate */}
                    <td className="py-3.5 px-3 text-right"><ConfRatePill rate={whatsappRow.confirmRate} /></td>
                    {/* Delivered — N/A */}
                    <td className="py-3.5 px-3 text-right tabular-nums text-muted-foreground text-sm">—</td>
                    {/* Del Rate — N/A */}
                    <td className="py-3.5 px-3 text-right"><span className="text-muted-foreground/40 text-xs">—</span></td>
                    {/* Status */}
                    <td className="py-3.5 pl-3 pr-6">
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap border bg-[hsl(142,60%,42%)]/10 text-[hsl(142,60%,42%)] border-[hsl(142,60%,42%)]/20">
                        WhatsApp Bot
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Insights ── */}
      {insights.length > 0 && (
        <div className="bg-card rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Performance Insights</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {insights.map((msg, i) => (
              <p key={i} className="text-xs bg-muted/50 rounded-lg px-3 py-2.5 border border-border/50">{msg}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
