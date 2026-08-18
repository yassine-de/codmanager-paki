import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Notification } from "@/contexts/NotificationContext";

interface AgentNotificationRow {
  id: string;
  type: "order_delivered" | "order_returned" | "postponed_due" | "rank_moved";
  title: string;
  message: string;
  order_id: string | null;
  read_at: string | null;
  created_at: string;
}

const TYPE_MAP: Record<AgentNotificationRow["type"], Notification["type"]> = {
  order_delivered: "order",
  postponed_due: "order",
  order_returned: "alert",
  rank_moved: "system",
};

// Real, per-agent notifications for confirmation agents (order_delivered,
// order_returned, postponed_due, rank_moved — see the agent_notifications
// migration). Kept separate from NotificationContext rather than merged
// into it, since NotificationProvider sits above AuthProvider in the
// provider tree and can't call useAuth() itself.
export function useAgentNotifications(agentId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["agent-notifications", agentId];

  const { data: rows = [] } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_notifications" as any)
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as AgentNotificationRow[];
    },
    enabled: !!agentId,
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
    await supabase.from("agent_notifications" as any).update({ read_at: new Date().toISOString() }).eq("id", id);
    queryClient.invalidateQueries({ queryKey });
  };

  const markAllAsRead = async () => {
    if (!agentId) return;
    await supabase.from("agent_notifications" as any).update({ read_at: new Date().toISOString() }).eq("agent_id", agentId).is("read_at", null);
    queryClient.invalidateQueries({ queryKey });
  };

  return { notifications, unreadCount, markAsRead, markAllAsRead };
}
