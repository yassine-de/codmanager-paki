import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, Package, Activity } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import FailedSyncModal from "@/components/FailedSyncModal";

interface StatusItem {
  id: string;
  label: string;
  count: number;
  severity: "ok" | "warning" | "error";
  icon: React.ReactNode;
  onClick: () => void;
}

const severityConfig = {
  ok: {
    dot: "bg-emerald-500",
    text: "text-emerald-600",
    bg: "bg-emerald-500/10",
    glow: "shadow-[0_0_6px_rgba(16,185,129,0.4)]",
  },
  warning: {
    dot: "bg-amber-500",
    text: "text-amber-600",
    bg: "bg-amber-500/10",
    glow: "shadow-[0_0_6px_rgba(245,158,11,0.3)]",
  },
  error: {
    dot: "bg-red-500",
    text: "text-red-500",
    bg: "bg-red-500/10",
    glow: "shadow-[0_0_6px_rgba(239,68,68,0.4)]",
  },
};

export default function SystemStatusPanel() {
  const navigate = useNavigate();
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  // Failed ORIO syncs
  const { data: failedSyncCount = 0 } = useQuery({
    queryKey: ["system-failed-syncs"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("orio_sync_status", "failed");
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30_000,
  });

  // Pending adjustments
  const { data: pendingAdjustments = 0 } = useQuery({
    queryKey: ["system-pending-adjustments"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("invoice_adjustments")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30_000,
  });

  // Unassigned new orders
  const { data: unassignedOrders = 0 } = useQuery({
    queryKey: ["system-unassigned-orders"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("confirmation_status", "new")
        .is("agent_id", null);
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30_000,
  });

  const items: StatusItem[] = [
    {
      id: "sync-errors",
      label: "ORIO Sync Errors",
      count: failedSyncCount,
      severity: failedSyncCount > 0 ? "error" : "ok",
      icon: <AlertTriangle className="w-4 h-4" />,
      onClick: () => setSyncModalOpen(true),
    },
    {
      id: "pending-adjustments",
      label: "Pending Adjustments",
      count: pendingAdjustments,
      severity: pendingAdjustments > 0 ? "warning" : "ok",
      icon: <ShieldAlert className="w-4 h-4" />,
      onClick: () => navigate("/adjustments"),
    },
    {
      id: "unassigned-orders",
      label: "Unassigned Orders",
      count: unassignedOrders,
      severity: unassignedOrders > 5 ? "warning" : "ok",
      icon: <Package className="w-4 h-4" />,
      onClick: () => navigate("/orders?status=new"),
    },
  ];

  const errorCount = items.filter((i) => i.severity === "error").length;
  const warningCount = items.filter((i) => i.severity === "warning").length;

  return (
    <>
      <div
        className="bg-card rounded-xl border shadow-soft animate-slide-up overflow-hidden"
        style={{ animationDelay: "120ms" }}
      >
        {/* Header */}
        <div className="px-4 py-2.5 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-blue-500/10">
              <Activity className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              System Status
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {errorCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-semibold bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full">
                <AlertTriangle className="w-2.5 h-2.5" />
                {errorCount} error{errorCount > 1 ? "s" : ""}
              </span>
            )}
            {warningCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">
                <Clock className="w-2.5 h-2.5" />
                {warningCount} warning{warningCount > 1 ? "s" : ""}
              </span>
            )}
            {errorCount === 0 && warningCount === 0 && (
              <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-2.5 h-2.5" />
                All OK
              </span>
            )}
          </div>
        </div>

        {/* Horizontal scrollable items */}
        <div className="px-4 py-3 flex gap-3 overflow-x-auto scrollbar-hide">
          {items.map((item) => {
            const cfg = severityConfig[item.severity];
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors shrink-0 min-w-0 cursor-pointer text-left"
              >
                {/* Icon with status dot */}
                <div className="relative shrink-0">
                  <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center ${cfg.text}`}>
                    {item.icon}
                  </div>
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${cfg.dot} ${cfg.glow}`}
                  />
                </div>

                {/* Info */}
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold truncate max-w-[140px]">{item.label}</p>
                  <p className={`text-[9px] font-medium ${cfg.text} mt-0.5 whitespace-nowrap`}>
                    {item.count === 0 ? "No issues" : `${item.count} pending`}
                  </p>
                </div>

                {/* Count badge */}
                {item.count > 0 && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${cfg.bg} ${cfg.text}`}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <FailedSyncModal open={syncModalOpen} onOpenChange={setSyncModalOpen} />
    </>
  );
}
