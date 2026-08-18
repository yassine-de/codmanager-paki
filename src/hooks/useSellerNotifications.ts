import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Notification } from "@/contexts/NotificationContext";

interface SellerNotificationRow {
  id: string;
  type: "order_delivered" | "order_returned" | "sheet_sync_failed" | "low_stock" | "invoice_ready";
  title: string;
  message: string;
  order_id: string | null;
  read_at: string | null;
  created_at: string;
}

const TYPE_MAP: Record<SellerNotificationRow["type"], Notification["type"]> = {
  order_delivered: "order",
  order_returned: "alert",
  sheet_sync_failed: "alert",
  low_stock: "alert",
  invoice_ready: "system",
};

// Real, per-seller notifications (order_delivered, order_returned,
// sheet_sync_failed, low_stock, invoice_ready — see the
// seller_notifications migration). Separate hook rather than merged into
// NotificationContext for the same reason as useAgentNotifications:
// NotificationProvider sits above AuthProvider and can't call useAuth().
export function useSellerNotifications(sellerId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["seller-notifications", sellerId];

  const { data: rows = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seller_notifications" as any)
        .select("*")
        .eq("seller_id", sellerId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as SellerNotificationRow[];
    },
    enabled: !!sellerId,
    refetchInterval: 30000,
  });

  const notifications: Notification[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    message: r.message,
    time: formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
    read: !!r.read_at,
    type: TYPE_MAP[r.type] ?? "system",
  }));

  const unreadCount = rows.filter((r) => !r.read_at).length;

  const markAsRead = async (id: string) => {
    await supabase.from("seller_notifications" as any).update({ read_at: new Date().toISOString() }).eq("id", id);
    queryClient.invalidateQueries({ queryKey });
  };

  const markAllAsRead = async () => {
    if (!sellerId) return;
    await supabase.from("seller_notifications" as any).update({ read_at: new Date().toISOString() }).eq("seller_id", sellerId).is("read_at", null);
    queryClient.invalidateQueries({ queryKey });
  };

  return { notifications, unreadCount, markAsRead, markAllAsRead };
}
