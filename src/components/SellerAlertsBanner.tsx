import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useState } from "react";
import { Info, Bell, AlertTriangle, X } from "lucide-react";

type Alert = {
  id: string;
  title: string;
  message: string;
  urgency: string;
};

const urgencyStyles = {
  info: { bg: "bg-blue-500/10 border-blue-500/30", text: "text-blue-400", icon: Info },
  medium: { bg: "bg-orange-500/10 border-orange-500/30", text: "text-orange-400", icon: Bell },
  urgent: { bg: "bg-red-500/10 border-red-500/30", text: "text-red-400", icon: AlertTriangle },
};

export function SellerAlertsBanner() {
  const { authUser } = useAuth();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const isSeller = authUser?.role === "seller";

  const { data: alerts = [] } = useQuery({
    queryKey: ["seller-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("id, title, message, urgency")
        .eq("is_active", true)
        .or("start_date.is.null,start_date.lte.now()")
        .or("end_date.is.null,end_date.gte.now()")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Alert[];
    },
    enabled: isSeller,
    refetchInterval: 60000,
  });

  if (!isSeller || alerts.length === 0) return null;

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  // Sort: urgent first, then medium, then info
  const priorityOrder = { urgent: 0, medium: 1, info: 2 };
  const sorted = [...visible].sort(
    (a, b) => (priorityOrder[a.urgency as keyof typeof priorityOrder] ?? 2) - (priorityOrder[b.urgency as keyof typeof priorityOrder] ?? 2)
  );

  return (
    <div className="space-y-2 mb-4">
      {sorted.map((alert) => {
        const style = urgencyStyles[alert.urgency as keyof typeof urgencyStyles] || urgencyStyles.info;
        const Icon = style.icon;
        return (
          <div
            key={alert.id}
            className={`flex items-center gap-3 rounded-xl border p-4 shadow-sm ${style.bg}`}
          >
            <div className={`p-2 rounded-lg ${style.text} bg-background/30 shrink-0`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">{alert.title}</p>
              <p className="text-[13px] font-medium text-foreground/80 mt-1 leading-relaxed">{alert.message}</p>
            </div>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(alert.id))}
              className="shrink-0 p-1 rounded-md hover:bg-background/50 transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
