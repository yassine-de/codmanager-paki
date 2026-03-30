import { type LucideIcon } from "lucide-react";
import { useDataVisibility, MaskedValue } from "@/contexts/DataVisibilityContext";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: string; positive: boolean };
  delay?: number;
}

export function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconBg = "bg-muted",
  iconColor = "text-primary",
  trend,
  delay = 0,
}: KPICardProps) {
  const { isDataVisible } = useDataVisibility();
  return (
    <div
      className="bg-card rounded-xl border shadow-soft p-5 animate-slide-up hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-300 group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${iconBg} ${iconColor} transition-transform duration-200 group-hover:scale-105`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${
            trend.positive
              ? 'bg-success/10 text-success'
              : 'bg-destructive/10 text-destructive'
          }`}>
            {isDataVisible ? <>{trend.positive ? '↑' : '↓'} {trend.value}</> : <MaskedValue />}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground font-medium">{title}</p>
      <p className="text-2xl font-bold tabular-nums tracking-tight mt-1">
        {isDataVisible ? value : <MaskedValue className="gap-1" />}
      </p>
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-2">
          {isDataVisible ? subtitle : <MaskedValue />}
        </p>
      )}
    </div>
  );
}
