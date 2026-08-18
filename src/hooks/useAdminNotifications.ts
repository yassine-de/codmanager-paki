import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Notification } from "@/contexts/NotificationContext";

interface AdminNotificationRow {
  id: string;
  type: "sourcing_request" | "support_ticket" | "adjustment_pending" | "invoice_needs_finalization" | "invoice_payout_due" | "metric_spike";
  title: string;
  message: string;
  reference_id: string | null;
  created_at: string;
}

const TYPE_MAP: Record<AdminNotificationRow["type"], Notification["type"]> = {
  sourcing_request: "order",
  support_ticket: "alert",
  adjustment_pending: "alert",
  invoice_needs_finalization: "system",
  invoice_payout_due: "system",
  metric_spike: "alert",
};

// Real, broadcast notifications for admins (multiple admin accounts exist,
// so this is a broadcast table + a per-admin read-tracking join table —
// see the admin_notifications migration). Separate hook, same reasoning as
// useAgentNotifications/useSellerNotifications: NotificationProvider sits
// above AuthProvider and can't call useAuth() itself.
export function useAdminNotifications(adminId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["admin-notifications", adminId];

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const [{ data: rows, error: rowsError }, { data: reads, error: readsError }] = await Promise.all([
        supabase.from("admin_notifications" as any).select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("admin_notification_reads" as any).select("notification_id").eq("admin_id", adminId),
      ]);
      if (rowsError) throw rowsError;
      if (readsError) throw readsError;
      const readIds = new Set(((reads || []) as { notification_id: string }[]).map((r) => r.notification_id));
      return { rows: (rows || []) as unknown as AdminNotificationRow[], readIds };
    },
    enabled: !!adminId,
    refetchInterval: 30000,
  });

  const rows = data?.rows ?? [];
  const readIds = data?.readIds ?? new Set<string>();

  const notifications: Notification[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    message: r.message,
    time: formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
    read: readIds.has(r.id),
    type: TYPE_MAP[r.type] ?? "system",
  }));

  const unreadCount = rows.filter((r) => !readIds.has(r.id)).length;

  const markAsRead = async (id: string) => {
    if (!adminId) return;
    await supabase.from("admin_notification_reads" as any).upsert({ notification_id: id, admin_id: adminId }, { onConflict: "notification_id,admin_id" });
    queryClient.invalidateQueries({ queryKey });
  };

  const markAllAsRead = async () => {
    if (!adminId || rows.length === 0) return;
    await supabase.from("admin_notification_reads" as any).upsert(
      rows.map((r) => ({ notification_id: r.id, admin_id: adminId })),
      { onConflict: "notification_id,admin_id" },
    );
    queryClient.invalidateQueries({ queryKey });
  };

  return { notifications, unreadCount, markAsRead, markAllAsRead };
}
