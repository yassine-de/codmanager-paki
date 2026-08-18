import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Notification } from "@/contexts/NotificationContext";

interface FollowUpNotificationRow {
  id: string;
  type: "followup_assigned" | "followup_stale" | "followup_delivered" | "followup_returned" | "followup_no_answer_attempt" | "followup_reattempt_stale";
  title: string;
  message: string;
  order_id: string | null;
  read_at: string | null;
  created_at: string;
}

const TYPE_MAP: Record<FollowUpNotificationRow["type"], Notification["type"]> = {
  followup_assigned: "order",
  followup_stale: "alert",
  followup_delivered: "order",
  followup_returned: "alert",
  followup_no_answer_attempt: "alert",
  followup_reattempt_stale: "alert",
};

// Real, per-follow-up-agent notifications (followup_assigned, followup_stale,
// followup_delivered, followup_returned — see the follow_up_notifications
// migration). Separate hook, same reasoning as the other role-specific
// notification hooks: NotificationProvider sits above AuthProvider and
// can't call useAuth() itself.
export function useFollowUpNotifications(followUpUserId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["follow-up-notifications", followUpUserId];

  const { data: rows = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("follow_up_notifications" as any)
        .select("*")
        .eq("follow_up_user_id", followUpUserId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as FollowUpNotificationRow[];
    },
    enabled: !!followUpUserId,
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
    await supabase.from("follow_up_notifications" as any).update({ read_at: new Date().toISOString() }).eq("id", id);
    queryClient.invalidateQueries({ queryKey });
  };

  const markAllAsRead = async () => {
    if (!followUpUserId) return;
    await supabase.from("follow_up_notifications" as any).update({ read_at: new Date().toISOString() }).eq("follow_up_user_id", followUpUserId).is("read_at", null);
    queryClient.invalidateQueries({ queryKey });
  };

  return { notifications, unreadCount, markAsRead, markAllAsRead };
}
