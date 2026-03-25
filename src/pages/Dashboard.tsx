import { useMemo, useEffect, useState, useRef } from "react";
import {
  ShoppingCart, CheckCircle2, Truck, DollarSign, XCircle, RotateCcw,
  Sparkles, PhoneOff, CalendarClock, TrendingUp, TrendingDown,
  Package, Copy, PhoneForwarded, Navigation, UserCheck, Banknote,
  Clock, Store, Award, Loader2,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FilterBar } from "@/components/FilterBar";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import type { LucideIcon } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";

/* ── Animated Number ── */
function AnimatedNumber({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const duration = 800;
    const start = ref.current;
    const diff = value - start;
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + diff * eased);
      setDisplay(current);
      if (progress < 1) requestAnimationFrame(step);
      else ref.current = value;
    };
    requestAnimationFrame(step);
  }, [value]);
  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}

/* (daily data now computed in useDashboardData hook) */

/* ── Section KPI Card ── */
interface SectionKPIProps {
  title: string;
  value: number;
  percentage: number;
  percentLabel?: string;
  icon: LucideIcon;
  color: string;
  iconBg: string;
  highlight?: boolean;
  prefix?: string;
  suffix?: string;
  change?: number;
  delay?: number;
  onClick?: () => void;
}

function SectionKPI({
  title, value, percentage, percentLabel, icon: Icon, color, iconBg,
  highlight = false, prefix = "", suffix = "", change, delay = 0, onClick,
}: SectionKPIProps) {
  const isPositive = change !== undefined && change >= 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div onClick={onClick}
          className={`relative overflow-hidden rounded-xl border px-5 py-4 animate-slide-up group
            hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer
            ${highlight ? 'ring-1 ring-success/30 bg-success/[0.04]' : 'bg-card'}`}
          style={{ animationDelay: `${delay}ms` }}>
          <div className="flex items-start justify-between mb-2">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.06em] leading-none">{title}</p>
            {change !== undefined && (
              <div className={`flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                isPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
              }`}>
                {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {Math.abs(change)}%
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className={`p-2.5 rounded-xl ${iconBg} shrink-0`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className={`font-bold tabular-nums tracking-tight leading-none ${highlight ? 'text-3xl' : 'text-2xl'}`}>
                  <AnimatedNumber value={value} prefix={prefix} suffix={suffix} />
                </p>
                <span className={`text-sm font-semibold tabular-nums ${color} opacity-70`}>{percentage}%</span>
              </div>
              {percentLabel && <p className="text-[11px] text-muted-foreground/60 mt-1.5">{percentLabel}</p>}
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">Click to filter by {title.toLowerCase()}</TooltipContent>
    </Tooltip>
  );
}

/* ── Section Header ── */
function SectionHeader({ icon: Icon, title, color, iconBg, delay = 0 }: {
  icon: LucideIcon; title: string; color: string; iconBg: string; delay?: number;
}) {
  return (
    <div className="flex items-center gap-2 animate-slide-up" style={{ animationDelay: `${delay}ms` }}>
      <div className={`p-1 rounded-md ${iconBg}`}><Icon className={`w-3.5 h-3.5 ${color}`} /></div>
      <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
    </div>
  );
}

/* ── Sparkline Mini Chart (7-day, top row) ── */
function SparkMiniChart({ data, dataKey, color, gradientId, title, total, delay }: {
  data: { day: string; [k: string]: string | number }[];
  dataKey: string; color: string; gradientId: string; title: string; total: number; delay: number;
}) {
  return (
    <div className="bg-card rounded-xl border px-5 py-4 animate-slide-up hover:shadow-lg transition-all duration-300"
      style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/60">{title}</p>
          <p className="text-2xl font-bold tabular-nums mt-1"><AnimatedNumber value={total} /></p>
        </div>
        <span className="text-[10px] font-bold text-muted-foreground/50 bg-muted rounded-full px-2.5 py-1 uppercase tracking-widest">7d</span>
      </div>
      <ResponsiveContainer width="100%" height={90}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="day" tick={({ x, y, payload }: any) => {
              const [line1, line2] = (payload.value || "").split("\n");
              return (
                <g transform={`translate(${x},${y})`}>
                  <text x={0} y={0} dy={10} textAnchor="middle" fontSize={9} fill="hsl(30,6%,55%)">{line1}</text>
                  <text x={0} y={0} dy={21} textAnchor="middle" fontSize={8} fill="hsl(30,6%,65%)">{line2}</text>
                </g>
              );
            }} axisLine={false} tickLine={false} height={30} />
          <YAxis hide allowDecimals={false} />
          <RechartsTooltip
            contentStyle={{ borderRadius: 10, border: "1px solid hsl(35,12%,88%)", fontSize: 11,
              boxShadow: "0 8px 24px rgba(0,0,0,0.06)", padding: "6px 10px" }}
            labelFormatter={(l) => `${l}`}
          />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2}
            fill={`url(#${gradientId})`} dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "#fff", fill: color }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Radial Gauge (Semi-circle, compact) ── */
function RadialGauge({ rate, title, delay = 0 }: { rate: number; title: string; delay?: number }) {
  const [animatedRate, setAnimatedRate] = useState(0);

  useEffect(() => {
    const duration = 1200;
    const startTime = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setAnimatedRate(Math.round(rate * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [rate]);

  const cx = 140, cy = 120, r = 90;
  const strokeW = 13;
  const totalArc = Math.PI;
  const circumference = totalArc * r;
  const progressOffset = circumference - (animatedRate / 100) * circumference;

  const getColor = (v: number) => {
    if (v <= 40) return "hsl(0, 65%, 52%)";
    if (v <= 70) return "hsl(38, 90%, 55%)";
    return "hsl(155, 50%, 42%)";
  };
  const statusColor = getColor(animatedRate);
  const gradientId = `gauge-grad-${title.replace(/\s/g, "")}`;
  const glowId = `gauge-glow-${title.replace(/\s/g, "")}`;

  const describeArc = (startA: number, endA: number, radius: number) => {
    const x1 = cx + radius * Math.cos(startA);
    const y1 = cy - radius * Math.sin(startA);
    const x2 = cx + radius * Math.cos(endA);
    const y2 = cy - radius * Math.sin(endA);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${Math.abs(endA - startA) > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
  };

  const ticks = [0, 50, 100].map((v) => {
    const angle = Math.PI - (v / 100) * totalArc;
    const outerR = r + strokeW / 2 + 10;
    return { label: `${v}%`, x: cx + outerR * Math.cos(angle), y: cy - outerR * Math.sin(angle) };
  });

  const status = animatedRate <= 40 ? "Poor" : animatedRate <= 70 ? "Average" : "Good";

  return (
    <div className="bg-card rounded-xl border overflow-hidden animate-slide-up hover:shadow-lg transition-all duration-300"
      style={{ animationDelay: `${delay}ms` }}>
      <div className="flex flex-col items-center justify-center px-2 py-3">
        <svg viewBox="0 0 280 150" className="w-full h-auto max-w-[420px] overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(0, 65%, 52%)" />
              <stop offset="45%" stopColor="hsl(38, 90%, 55%)" />
              <stop offset="100%" stopColor="hsl(155, 50%, 42%)" />
            </linearGradient>
            <filter id={glowId}>
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <path d={describeArc(Math.PI, 0, r)} fill="none" stroke="hsl(35,12%,91%)" strokeWidth={strokeW} strokeLinecap="round" />
          <path d={describeArc(Math.PI, 0, r)} fill="none" stroke={`url(#${gradientId})`}
            strokeWidth={strokeW} strokeLinecap="round" strokeDasharray={circumference}
            strokeDashoffset={progressOffset} filter={`url(#${glowId})`}
            style={{ transition: "stroke-dashoffset 0.1s ease-out" }} />
          {ticks.map((t) => (
            <text key={t.label} x={t.x} y={t.y} textAnchor="middle" dominantBaseline="middle"
              className="text-[9px] font-medium" fill="hsl(30,6%,60%)">{t.label}</text>
          ))}
          <text x={cx} y={cy - 16} textAnchor="middle" dominantBaseline="middle"
            className="text-[36px] font-bold tabular-nums" fill="hsl(var(--foreground))"
            style={{ letterSpacing: "-0.03em" }}>{animatedRate}%</text>
          <text x={cx} y={cy + 6} textAnchor="middle" dominantBaseline="middle"
            className="text-[10px] font-semibold uppercase tracking-[0.06em]" fill="hsl(30,6%,55%)">{title}</text>
          <text x={cx} y={cy + 20} textAnchor="middle" dominantBaseline="middle"
            className="text-[9px] font-bold" fill={statusColor}>{status}</text>
        </svg>
      </div>
    </div>
  );
}

/* ── Dashboard ── */
export default function Dashboard() {
  const { authUser } = useAuth();
  const isSeller = authUser?.role === "seller";
  const navigate = useNavigate();
  const { kpis, last7, totals7, topProducts, topSellers, isLoading } = useDashboardData();

  const pct = (val: number, base: number) => base > 0 ? Math.round((val / base) * 100) : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px]">
      <FilterBar hideSeller={isSeller} />

      <div className="space-y-6 mt-4">
        {/* Header */}
        <div className="flex items-end justify-between animate-fade-in">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{isSeller ? "My Dashboard" : "Dashboard"}</h1>
            <p className="text-muted-foreground text-xs mt-0.5">{format(new Date(), "EEEE, dd MMMM yyyy")}</p>
          </div>
        </div>

        {/* ═══════════ TOP: 7-DAY SPARKLINES ═══════════ */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SparkMiniChart data={last7} dataKey="orders" color="hsl(210,60%,52%)" gradientId="spark7O"
            title="Orders" total={totals7.orders} delay={0} />
          <SparkMiniChart data={last7} dataKey="confirmed" color="hsl(155,30%,32%)" gradientId="spark7C"
            title="Confirmed" total={totals7.confirmed} delay={60} />
          <SparkMiniChart data={last7} dataKey="delivered" color="hsl(155,50%,42%)" gradientId="spark7D"
            title="Delivered" total={totals7.delivered} delay={120} />
        </div>

        {/* ═══════════ RATE GAUGES ═══════════ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RadialGauge rate={kpis.confirmationRate} title="Confirmation Rate" delay={130} />
          <RadialGauge rate={kpis.deliveryRate} title="Delivery Rate" delay={150} />
        </div>

        {/* ═══════════ FINANCIAL OVERVIEW ═══════════ */}
        <div className="space-y-3">
          <SectionHeader icon={DollarSign} title="Financial Overview" color="text-primary" iconBg="bg-primary/10" delay={160} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SectionKPI title="Delivered Amount" value={kpis.revenue} percentage={100}
              percentLabel="total delivered" icon={DollarSign} color="text-foreground" iconBg="bg-muted"
              prefix="" suffix=" MAD" delay={170} />
            <SectionKPI title="Paid Amount" value={kpis.paidAmount} percentage={pct(kpis.paidAmount, kpis.revenue)}
              percentLabel="of delivered" icon={Banknote} color="text-success" iconBg="bg-success/10"
              prefix="" suffix=" MAD" delay={180} />
            <SectionKPI title="Pending Amount" value={kpis.pendingAmount} percentage={pct(kpis.pendingAmount, kpis.revenue)}
              percentLabel="of delivered" icon={Clock} color="text-warning" iconBg="bg-warning/10"
              highlight prefix="" suffix=" MAD" delay={190} />
          </div>
        </div>

        {/* ═══════════ CONFIRMATION PERFORMANCE ═══════════ */}
        <div className="space-y-3">
          <SectionHeader icon={CheckCircle2} title="Confirmation Performance" color="text-info" iconBg="bg-info/10" delay={200} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <SectionKPI title="New Orders" value={kpis.newOrders} percentage={pct(kpis.newOrders, kpis.total)}
              percentLabel="of total" icon={Sparkles} color="text-info" iconBg="bg-info/10" change={12} delay={210}
              onClick={() => navigate("/orders?confirmation=new")} />
            <SectionKPI title="Confirmed" value={kpis.confirmed} percentage={kpis.confirmationRate}
              percentLabel="of total" icon={CheckCircle2} color="text-success" iconBg="bg-success/10"
              highlight change={5} delay={220} onClick={() => navigate("/orders?confirmation=confirmed")} />
            <SectionKPI title="No Answer" value={kpis.noAnswer} percentage={pct(kpis.noAnswer, kpis.total)}
              percentLabel="of total" icon={PhoneOff} color="text-warning" iconBg="bg-warning/10" change={-3} delay={230}
              onClick={() => navigate("/orders?confirmation=no_answer")} />
            <SectionKPI title="Postponed" value={kpis.postponed} percentage={pct(kpis.postponed, kpis.total)}
              percentLabel="of total" icon={CalendarClock} color="text-warning" iconBg="bg-warning/10" change={8} delay={240}
              onClick={() => navigate("/orders?confirmation=postponed")} />
            <SectionKPI title="Cancelled" value={kpis.cancelled} percentage={pct(kpis.cancelled, kpis.total)}
              percentLabel="of total" icon={XCircle} color="text-destructive" iconBg="bg-destructive/10" change={-12} delay={250}
              onClick={() => navigate("/orders?confirmation=cancelled")} />
            <SectionKPI title="Double" value={kpis.doubleOrders} percentage={pct(kpis.doubleOrders, kpis.total)}
              percentLabel="of total" icon={Copy} color="text-destructive" iconBg="bg-destructive/10" delay={260}
              onClick={() => navigate("/orders?confirmation=double")} />
            <SectionKPI title="Wrong Number" value={kpis.wrongNumber} percentage={pct(kpis.wrongNumber, kpis.total)}
              percentLabel="of total" icon={PhoneForwarded} color="text-destructive" iconBg="bg-destructive/10" delay={270}
              onClick={() => navigate("/orders?confirmation=wrong_number")} />
          </div>
        </div>

        {/* ═══════════ DELIVERY PERFORMANCE ═══════════ */}
        <div className="space-y-3">
          <SectionHeader icon={Truck} title="Delivery Performance" color="text-success" iconBg="bg-success/10" delay={280} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <SectionKPI title="Delivered" value={kpis.delivered} percentage={kpis.deliveryRate}
              percentLabel="of shipped" icon={Truck} color="text-success" iconBg="bg-success/10"
              highlight delay={290}
              onClick={() => navigate("/orders?delivery=delivered")} />
            <SectionKPI title="Shipped" value={kpis.shipped} percentage={pct(kpis.shipped, kpis.total)}
              percentLabel="of total" icon={Package} color="text-primary" iconBg="bg-primary/10" delay={300}
              onClick={() => navigate("/orders?delivery=shipped")} />
            <SectionKPI title="Pending" value={kpis.pending} percentage={pct(kpis.pending, kpis.total)}
              percentLabel="of total" icon={CheckCircle2} color="text-info" iconBg="bg-info/10" delay={310}
              onClick={() => navigate("/orders?delivery=pending")} />
            <SectionKPI title="In Transit" value={kpis.inTransit} percentage={pct(kpis.inTransit, kpis.total)}
              percentLabel="of total" icon={Navigation} color="text-info" iconBg="bg-info/10" delay={320}
              onClick={() => navigate("/orders?delivery=in_transit")} />
            <SectionKPI title="With Courier" value={kpis.withCourier} percentage={pct(kpis.withCourier, kpis.total)}
              percentLabel="of total" icon={UserCheck} color="text-primary" iconBg="bg-primary/10" delay={330}
              onClick={() => navigate("/orders?delivery=with_courier")} />
            <SectionKPI title="Postponed" value={kpis.deliveryPostponed} percentage={pct(kpis.deliveryPostponed, kpis.total)}
              percentLabel="of total" icon={CalendarClock} color="text-warning" iconBg="bg-warning/10" delay={340}
              onClick={() => navigate("/orders?delivery=postponed")} />
            <SectionKPI title="No Answer" value={kpis.deliveryNoAnswer} percentage={pct(kpis.deliveryNoAnswer, kpis.total)}
              percentLabel="of total" icon={PhoneOff} color="text-warning" iconBg="bg-warning/10" delay={350}
              onClick={() => navigate("/orders?delivery=no_answer")} />
            <SectionKPI title="Cancelled" value={kpis.deliveryCancelled} percentage={pct(kpis.deliveryCancelled, kpis.total)}
              percentLabel="of total" icon={XCircle} color="text-destructive" iconBg="bg-destructive/10" delay={360}
              onClick={() => navigate("/orders?delivery=cancelled")} />
            <SectionKPI title="Returned" value={kpis.returned} percentage={pct(kpis.returned, kpis.total)}
              percentLabel="of total" icon={RotateCcw} color="text-muted-foreground" iconBg="bg-muted" delay={370}
              onClick={() => navigate("/orders?delivery=returned")} />
          </div>
        </div>

        {/* ═══════════ TOP PERFORMERS ═══════════ */}
        <div className={`grid grid-cols-1 ${!isSeller ? 'lg:grid-cols-2' : ''} gap-4`}>
          {/* Top Sellers - admin only */}
          {!isSeller && (
            <div className="bg-card rounded-xl border animate-slide-up overflow-hidden" style={{ animationDelay: "370ms" }}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2">
                <div className="p-1 rounded-md bg-primary/10 text-primary"><Store className="w-3.5 h-3.5" /></div>
                <h2 className="text-xs font-semibold">Top Sellers by Delivered Orders</h2>
              </div>
              <div className="divide-y">
                {topSellers.map((s, i) => (
                  <div key={s.name} className="px-4 py-2 flex items-center gap-3 hover:bg-muted/10 transition-colors">
                    <span className="text-[10px] font-bold text-muted-foreground/50 w-4 tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{s.name}</p>
                      <div className="mt-1 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all duration-700"
                          style={{ width: `${topSellers[0]?.delivered ? Math.round((s.delivered / topSellers[0].delivered) * 100) : 0}%` }} />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums text-primary">{s.delivered}</p>
                      <p className="text-[9px] text-muted-foreground">{s.deliveryRate}% rate</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Products */}
          <div className="bg-card rounded-xl border animate-slide-up overflow-hidden" style={{ animationDelay: "400ms" }}>
            <div className="px-4 py-2.5 border-b flex items-center gap-2">
              <div className="p-1 rounded-md bg-success/10 text-success"><Award className="w-3.5 h-3.5" /></div>
              <h2 className="text-xs font-semibold">Top Products by Delivery Rate</h2>
            </div>
            <div className="divide-y">
              {topProducts.map((p, i) => (
                <div key={p.name} className="px-4 py-2 flex items-center gap-3 hover:bg-muted/10 transition-colors">
                  <span className="text-[10px] font-bold text-muted-foreground/50 w-4 tabular-nums">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{p.name}</p>
                    <div className="mt-1 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-success transition-all duration-700"
                        style={{ width: `${p.deliveryRate}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums text-success">{p.deliveryRate}%</p>
                    <p className="text-[9px] text-muted-foreground">{p.delivered}/{p.total} units</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
