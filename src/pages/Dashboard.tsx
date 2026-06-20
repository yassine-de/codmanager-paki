import { useMemo, useEffect, useState, useRef } from "react";
import {
  ShoppingCart, CheckCircle2, Truck, DollarSign, XCircle, RotateCcw,
  Sparkles, PhoneOff, CalendarClock, TrendingUp, TrendingDown,
  Package, Copy, PhoneForwarded, Navigation, UserCheck, Banknote,
  Clock, Store, Award, Activity, PackageCheck, Hourglass, PhoneMissed,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, LabelList,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DatePresetFilter, type DatePresetValue, getDateRangeFromPreset } from "@/components/DatePresetFilter";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { formatPKT as format } from "@/lib/timezone";
import type { LucideIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { useDashboardData, type DateBasis } from "@/hooks/useDashboardData";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import OnlineStatusPanel from "@/components/OnlineStatusPanel";
import SystemStatusPanel from "@/components/SystemStatusPanel";
import { useDataVisibility, MaskedValue } from "@/contexts/DataVisibilityContext";
import { formatPKR, formatUSD, pkrToUsd } from "@/lib/currency";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";

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
  const { isDataVisible } = useDataVisibility();
  const isPositive = change !== undefined && change >= 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div onClick={onClick}
          className={`relative overflow-hidden rounded-xl border shadow-soft px-5 py-4 animate-slide-up group
            hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-200 cursor-pointer
            ${highlight ? 'ring-1 ring-success/20 bg-success/[0.03]' : 'bg-card'}`}
          style={{ animationDelay: `${delay}ms` }}>
          <div className="flex items-start justify-between mb-2">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-none">{title}</p>
            {change !== undefined && (
              <div className={`flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-lg shrink-0 ${
                isPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
              }`}>
                {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {Math.abs(change)}%
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className={`p-2.5 rounded-xl ${iconBg} shrink-0 transition-transform duration-200 group-hover:scale-105`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className={`font-bold tabular-nums tracking-tight leading-none ${highlight ? 'text-3xl' : 'text-2xl'}`}>
                  {isDataVisible ? <AnimatedNumber value={value} prefix={prefix} suffix={suffix} /> : <MaskedValue className="gap-1" />}
                </p>
                <span className={`text-sm font-semibold tabular-nums ${color} opacity-60`}>
                  {isDataVisible ? `${percentage}%` : <MaskedValue />}
                </span>
              </div>
              {percentLabel && <p className="text-[11px] text-muted-foreground/50 mt-1.5">{isDataVisible ? percentLabel : <MaskedValue />}</p>}
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs rounded-lg">Click to filter by {title.toLowerCase()}</TooltipContent>
    </Tooltip>
  );
}

/* ── Financial KPI Card (PKR + USD) ── */
interface FinancialKPIProps {
  title: string;
  pkrAmount: number;
  percentage: number;
  percentLabel?: string;
  icon: LucideIcon;
  color: string;
  iconBg: string;
  highlight?: boolean;
  delay?: number;
}

function FinancialKPI({
  title, pkrAmount, percentage, percentLabel, icon: Icon, color, iconBg,
  highlight = false, delay = 0,
}: FinancialKPIProps) {
  const { isDataVisible } = useDataVisibility();
  const usdEquiv = pkrToUsd(pkrAmount);
  return (
    <div
      className={`relative overflow-hidden rounded-xl border shadow-soft px-5 py-4 animate-slide-up group
        hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-200
        ${highlight ? 'ring-1 ring-success/20 bg-success/[0.03]' : 'bg-card'}`}
      style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-none">{title}</p>
      </div>
      <div className="flex items-center gap-3 mt-1">
        <div className={`p-2.5 rounded-xl ${iconBg} shrink-0 transition-transform duration-200 group-hover:scale-105`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1">
            <p className={`font-bold tabular-nums tracking-tight leading-none ${highlight ? 'text-3xl' : 'text-2xl'}`}>
              {isDataVisible ? <AnimatedNumber value={pkrAmount} suffix=" PKR" /> : <MaskedValue className="gap-1" />}
            </p>
            <p className={`font-bold tabular-nums tracking-tight leading-none text-foreground ${highlight ? 'text-2xl' : 'text-xl'}`}>
              {isDataVisible ? `≈ ${formatUSD(usdEquiv)}` : <MaskedValue />}
            </p>
          </div>
          <span className={`text-sm font-semibold tabular-nums ${color} opacity-60 self-start mt-1`}>
            {isDataVisible ? `${percentage}%` : <MaskedValue />}
          </span>
          {percentLabel && <p className="text-[10px] text-muted-foreground/40 mt-0.5">{isDataVisible ? percentLabel : <MaskedValue />}</p>}
        </div>
      </div>
    </div>
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
  const { isDataVisible } = useDataVisibility();
  return (
    <div className="bg-card rounded-xl border shadow-soft px-5 py-4 animate-slide-up hover:shadow-elevated transition-all duration-200"
      style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/60">{title}</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{isDataVisible ? <AnimatedNumber value={total} /> : <MaskedValue className="gap-1" />}</p>
        </div>
        <span className="text-[10px] font-bold text-muted-foreground/50 bg-muted rounded-full px-2.5 py-1 uppercase tracking-widest">7d</span>
      </div>
      <ResponsiveContainer width="100%" height={115}>
        <AreaChart data={data} margin={{ top: 28, right: 8, left: 8, bottom: 0 }}>
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
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5}
            fill={`url(#${gradientId})`} dot={{ r: 3, fill: color, strokeWidth: 2, stroke: "hsl(var(--card))" }}
            activeDot={{ r: 4.5, strokeWidth: 2, stroke: "#fff", fill: color }}>
            {isDataVisible && (
              <LabelList
                dataKey={dataKey}
                position="top"
                offset={12}
                fontSize={10}
                fontWeight={700}
                fill={color}
                formatter={(v: number) => v.toLocaleString()}
              />
            )}
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Radial Gauge (Semi-circle, compact) ── */
function RadialGauge({ rate, title, delay = 0 }: { rate: number; title: string; delay?: number }) {
  const { isDataVisible } = useDataVisibility();
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

  const status = animatedRate < 50 ? "Needs Improvement" : animatedRate < 60 ? "Good" : "Excellent";

  return (
    <div className="bg-card rounded-xl border shadow-soft overflow-hidden animate-slide-up hover:shadow-elevated transition-all duration-200"
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
            style={{ letterSpacing: "-0.03em" }}>{isDataVisible ? `${animatedRate}%` : '••••'}</text>
          <text x={cx} y={cy + 6} textAnchor="middle" dominantBaseline="middle"
            className="text-[10px] font-semibold uppercase tracking-[0.06em]" fill="hsl(30,6%,55%)">{title}</text>
          <text x={cx} y={cy + 20} textAnchor="middle" dominantBaseline="middle"
            className="text-[9px] font-bold" fill={statusColor}>{isDataVisible ? status : ''}</text>
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
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [dateBasis, setDateBasis] = useState<DateBasis>("created");
  const { kpis, last7, totals7, topProducts, topSellers, isLoading } = useDashboardData(dateRange, dateBasis);

  // Resolve seller IDs to names
  const sellerIds = useMemo(() => topSellers.map(s => s.sellerId), [topSellers]);
  const { data: sellerProfiles = [] } = useQuery({
    queryKey: ["dashboard-seller-profiles", sellerIds],
    queryFn: async () => {
      if (sellerIds.length === 0) return [];
      const { data } = await supabase.from("profiles").select("user_id, name").in("user_id", sellerIds);
      return data || [];
    },
    enabled: sellerIds.length > 0,
  });
  const resolvedTopSellers = useMemo(() => {
    const nameMap: Record<string, string> = {};
    sellerProfiles.forEach(p => { nameMap[p.user_id] = p.name; });
    return topSellers.map(s => ({ ...s, name: nameMap[s.sellerId] || s.name }));
  }, [topSellers, sellerProfiles]);

  const pct = (val: number, base: number) => base > 0 ? Math.round((val / base) * 100) : 0;

  // ── Follow-Up KPIs (admin only) ──
  const { data: fuRows = [] } = useQuery({
    queryKey: ["dashboard-follow-ups-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_follow_ups_data");
      if (error) throw error;
      return (data ?? []) as { delivery_status: string | null; follow_up_status: string }[];
    },
    enabled: !isSeller,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const fuKpis = useMemo(() => {
    const total     = fuRows.length;
    const shipped   = fuRows.filter((r) => ["shipped","in_transit","with_courier","out_for_delivery"].includes(r.delivery_status ?? "")).length;
    const delivered = fuRows.filter((r) => r.delivery_status === "delivered").length;
    const needAction = fuRows.filter((r) => r.follow_up_status !== "closed").length;
    return {
      total, shipped, delivered, needAction,
      shippedPct:     total > 0 ? Math.round((shipped    / total) * 100) : 0,
      deliveredPct:   total > 0 ? Math.round((delivered  / total) * 100) : 0,
      needActionPct:  total > 0 ? Math.round((needAction / total) * 100) : 0,
    };
  }, [fuRows]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="max-w-[1400px]">
      <div className="sticky top-0 z-30 -mx-5 lg:-mx-6 px-5 lg:px-6 py-3 bg-background/80 glass border-b mb-1 flex flex-wrap items-center gap-3">
        <DatePresetFilter
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          preset={datePreset}
          onPresetChange={setDatePreset}
        />
        {/* Date basis: filter the whole dashboard by created_at or updated_at */}
        <div className="inline-flex items-center rounded-lg border bg-background p-0.5 text-xs">
          {([
            { value: "created", label: "Created" },
            { value: "updated", label: "Updated" },
          ] as { value: DateBasis; label: string }[]).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDateBasis(opt.value)}
              className={
                "px-3 py-1.5 rounded-md font-medium transition-colors " +
                (dateBasis === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-8 mt-5">
        {/* Header */}
        <div className="flex items-end justify-between animate-fade-in">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{isSeller ? "My Dashboard" : "Dashboard"}</h1>
            <p className="text-muted-foreground text-sm mt-1">{format(new Date(), "EEEE, dd MMMM yyyy")}</p>
          </div>
        </div>

        {/* ═══════════ TEAM STATUS (admin only) ═══════════ */}
        {!isSeller && <OnlineStatusPanel />}

        {/* ═══════════ SYSTEM STATUS (admin only) ═══════════ */}
        {!isSeller && <SystemStatusPanel dateRange={dateRange} />}

        {/* ═══════════ HERO KPIs ═══════════ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {(() => {
            const heroCards = [
              {
                title: "Total Orders",
                value: kpis.total,
                sub: `${kpis.newOrders} new orders`,
                icon: ShoppingCart,
                gradient: "from-indigo-500 to-violet-600",
                shadow: "shadow-[0_8px_24px_-8px_rgba(99,102,241,0.5)]",
                onClick: () => navigate("/orders"),
              },
              {
                title: "Confirmed",
                value: kpis.confirmed,
                sub: `${kpis.confirmationRate}% confirmation rate`,
                icon: CheckCircle2,
                gradient: "from-emerald-500 to-teal-600",
                shadow: "shadow-[0_8px_24px_-8px_rgba(16,185,129,0.5)]",
                onClick: () => navigate("/orders?confirmation=confirmed"),
              },
              {
                title: "Delivered",
                value: kpis.delivered,
                sub: `${kpis.deliveryRate}% delivery rate`,
                icon: Truck,
                gradient: "from-sky-500 to-blue-600",
                shadow: "shadow-[0_8px_24px_-8px_rgba(14,165,233,0.5)]",
                onClick: () => navigate("/orders?delivery=delivered"),
              },
              {
                title: "Revenue (PKR)",
                value: kpis.revenue,
                sub: `≈ ${formatUSD(pkrToUsd(kpis.revenue))}`,
                icon: DollarSign,
                gradient: "from-violet-500 to-purple-600",
                shadow: "shadow-[0_8px_24px_-8px_rgba(139,92,246,0.5)]",
                onClick: () => navigate("/finance"),
              },
            ];
            return heroCards.map((c, i) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.title}
                  onClick={c.onClick}
                  className={`relative overflow-hidden rounded-2xl p-5 text-left text-white bg-gradient-to-br ${c.gradient} ${c.shadow} hover:-translate-y-0.5 hover:shadow-2xl transition-all duration-200 animate-slide-up min-h-[150px]`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <Icon className="absolute -right-4 -bottom-4 w-32 h-32 text-white/10" strokeWidth={1.5} />
                  <div className="w-10 h-10 rounded-full bg-white/15 backdrop-blur flex items-center justify-center mb-6">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">{c.title}</p>
                  <p className="text-4xl font-bold tabular-nums mt-1 leading-tight">
                    <AnimatedNumber value={c.value} />
                  </p>
                  <p className="text-[11px] text-white/75 mt-3">{c.sub}</p>
                </button>
              );
            });
          })()}
        </div>

        {/* ═══════════ TOP: 7-DAY SPARKLINES ═══════════ */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SparkMiniChart data={last7} dataKey="dropped" color="hsl(210,60%,52%)" gradientId="spark7O"
            title="Dropped Orders" total={totals7.dropped} delay={0} />
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
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md">1 USD = 290 PKR</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FinancialKPI title="Delivered Amount" pkrAmount={kpis.revenue} percentage={100}
              percentLabel="total delivered" icon={DollarSign} color="text-foreground" iconBg="bg-muted" delay={170} />
            <FinancialKPI title="Paid Amount" pkrAmount={kpis.paidAmount} percentage={pct(kpis.paidAmount, kpis.revenue)}
              percentLabel="of delivered" icon={Banknote} color="text-success" iconBg="bg-success/10" delay={180} />
            <FinancialKPI title="Pending Amount" pkrAmount={kpis.pendingAmount} percentage={pct(kpis.pendingAmount, kpis.revenue)}
              percentLabel="of delivered" icon={Clock} color="text-warning" iconBg="bg-warning/10"
              highlight delay={190} />
          </div>
        </div>

        {/* ═══════════ CONFIRMATION PERFORMANCE ═══════════ */}
        <div className="space-y-3">
          <SectionHeader icon={CheckCircle2} title="Confirmation Performance" color="text-info" iconBg="bg-info/10" delay={200} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <SectionKPI title="Total Orders" value={kpis.total} percentage={100}
              percentLabel="all orders" icon={ShoppingCart} color="text-foreground" iconBg="bg-muted"
              delay={205} onClick={() => navigate("/orders")} />
            <SectionKPI title="New Orders" value={kpis.newOrders} percentage={pct(kpis.newOrders, kpis.total)}
              percentLabel="of total" icon={Sparkles} color="text-info" iconBg="bg-info/10" change={12} delay={210}
              onClick={() => navigate("/orders?confirmation=new")} />
            <SectionKPI title="Confirmed" value={kpis.confirmed} percentage={kpis.confirmationRate}
              percentLabel="of total" icon={CheckCircle2} color="text-success" iconBg="bg-success/10"
              highlight change={5} delay={220} onClick={() => navigate("/orders?confirmation=confirmed")} />
            <SectionKPI title="No Answer" value={kpis.noAnswer} percentage={pct(kpis.noAnswer, kpis.total)}
              percentLabel="of total" icon={PhoneOff} color="text-warning" iconBg="bg-warning/10" change={-3} delay={230}
              onClick={() => navigate("/orders?confirmation=no_answer")} />
            <SectionKPI title="Unreachable" value={kpis.unreachable} percentage={pct(kpis.unreachable, kpis.total)}
              percentLabel="of total" icon={PhoneMissed} color="text-muted-foreground" iconBg="bg-muted" delay={235}
              onClick={() => navigate("/orders?confirmation=unreachable")} />
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
          {(() => {
            // Denominator = total orders that reached delivery stage (confirmed pool)
            const deliveryPool = kpis.delivered + kpis.shipped + kpis.pending + kpis.deliveryNoAnswer + kpis.returned;
            const deliveryPct = (n: number) => pct(n, deliveryPool);
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <SectionKPI title="Delivered" value={kpis.delivered} percentage={deliveryPct(kpis.delivered)}
                  percentLabel="of delivery pool" icon={Truck} color="text-success" iconBg="bg-success/10"
                  highlight delay={290}
                  onClick={() => navigate("/orders?delivery=delivered")} />
                <SectionKPI title="Shipped" value={kpis.shipped} percentage={deliveryPct(kpis.shipped)}
                  percentLabel="of delivery pool" icon={Package} color="text-primary" iconBg="bg-primary/10" delay={300}
                  onClick={() => navigate("/orders?delivery=shipped")} />
                <SectionKPI title="Pending" value={kpis.pending} percentage={deliveryPct(kpis.pending)}
                  percentLabel="of delivery pool" icon={CheckCircle2} color="text-info" iconBg="bg-info/10" delay={310}
                  onClick={() => navigate("/orders?delivery=pending")} />
                <SectionKPI title="Failed Attempt" value={kpis.deliveryNoAnswer} percentage={deliveryPct(kpis.deliveryNoAnswer)}
                  percentLabel="of delivery pool" icon={PhoneOff} color="text-warning" iconBg="bg-warning/10" delay={320}
                  onClick={() => navigate("/orders?delivery=failed_attempt")} />
                <SectionKPI title="Returned" value={kpis.returned} percentage={deliveryPct(kpis.returned)}
                  percentLabel="of delivery pool" icon={RotateCcw} color="text-destructive" iconBg="bg-destructive/10" delay={330}
                  onClick={() => navigate("/orders?delivery=return")} />
              </div>
            );
          })()}
        </div>

        {/* Team status moved to top */}

        {/* ═══════════ FOLLOW-UP OVERVIEW (admin only) ═══════════ */}
        {!isSeller && (
          <div className="space-y-3">
            <SectionHeader icon={Truck} title="Follow-Up Overview" color="text-primary" iconBg="bg-primary/10" delay={340} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <FuKPICard icon={Truck}       label="Total Orders"   value={fuKpis.total}      sub="Synced to ORIO"                      pct={100}                    tone="muted"   delay={345} />
              <FuKPICard icon={Activity}    label="In Transit"     value={fuKpis.shipped}    sub={`${fuKpis.shippedPct}% of total`}    pct={fuKpis.shippedPct}     tone="info"    delay={350} />
              <FuKPICard icon={PackageCheck} label="Delivered"     value={fuKpis.delivered}  sub={`${fuKpis.deliveredPct}% of total`}  pct={fuKpis.deliveredPct}   tone="success" delay={355} />
              <FuKPICard icon={Hourglass}   label="Need Action"    value={fuKpis.needAction} sub={`${fuKpis.needActionPct}% pending`}  pct={fuKpis.needActionPct}  tone="warning" delay={360} />
            </div>
          </div>
        )}

        {/* ═══════════ TOP PERFORMERS ═══════════ */}
        <div className={`grid grid-cols-1 ${!isSeller ? 'lg:grid-cols-2' : ''} gap-4`}>
          {/* Top Sellers - admin only */}
          {!isSeller && (
            <div className="bg-card rounded-xl border shadow-soft animate-slide-up overflow-hidden" style={{ animationDelay: "370ms" }}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2">
                <div className="p-1 rounded-md bg-primary/10 text-primary"><Store className="w-3.5 h-3.5" /></div>
                <h2 className="text-xs font-semibold">Top Sellers by Delivered Orders</h2>
              </div>
              <div className="divide-y">
                {resolvedTopSellers.map((s, i) => (
                  <div key={s.sellerId} className="px-4 py-2 flex items-center gap-3 hover:bg-muted/10 transition-colors">
                    <span className="text-[10px] font-bold text-muted-foreground/50 w-4 tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{s.name}</p>
                      <div className="mt-1 w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all duration-700"
                          style={{ width: `${resolvedTopSellers[0]?.delivered ? Math.round((s.delivered / resolvedTopSellers[0].delivered) * 100) : 0}%` }} />
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
          <div className="bg-card rounded-xl border shadow-soft animate-slide-up overflow-hidden" style={{ animationDelay: "400ms" }}>
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
                    <p className="text-[9px] text-muted-foreground">{p.delivered}/{p.confirmed} confirmed</p>
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

/* ── Follow-Up KPI Card (used in Follow-Up Overview section) ── */
function FuKPICard({
  icon: Icon, label, value, sub, pct, tone, delay = 0,
}: {
  icon: typeof Truck;
  label: string;
  value: number;
  sub: string;
  pct: number;
  tone: "muted" | "info" | "success" | "warning";
  delay?: number;
}) {
  const iconCls = {
    muted:   "bg-muted/80 text-muted-foreground",
    info:    "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)]",
    success: "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)]",
    warning: "bg-[hsl(25,85%,55%)]/12  text-[hsl(25,85%,55%)]",
  }[tone];

  const barCls = {
    muted:   "bg-foreground/20",
    info:    "bg-[hsl(210,60%,52%)]",
    success: "bg-[hsl(155,50%,42%)]",
    warning: "bg-[hsl(25,85%,55%)]",
  }[tone];

  const borderCls = {
    muted:   "border-t-border",
    info:    "border-t-[hsl(210,60%,52%)]/30",
    success: "border-t-[hsl(155,50%,42%)]/30",
    warning: "border-t-[hsl(25,85%,55%)]/30",
  }[tone];

  return (
    <div
      className={`bg-card rounded-xl border border-t-2 ${borderCls} shadow-soft px-4 py-4 animate-slide-up hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-200 overflow-hidden`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold truncate">{label}</p>
          <p className="text-2xl font-bold tabular-nums mt-1.5 leading-none">{value.toLocaleString()}</p>
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-none">{sub}</p>
        </div>
        <div className={`p-2 rounded-xl flex-shrink-0 ${iconCls}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3.5 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barCls}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}
