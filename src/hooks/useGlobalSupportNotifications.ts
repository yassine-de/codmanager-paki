import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { playAdminNotificationSound } from "@/lib/support-sounds";

/**
 * Global realtime listener for admin users.
 * Fires toast + sound when a seller sends a new support message,
 * regardless of which page the admin is viewing.
 */
export function useGlobalAdminSupportNotifications() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = authUser?.role === "admin";

  useEffect(() => {
    if (!isAdmin || !authUser) return;

    const channel = supabase
      .channel("global-admin-support-notify")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages" },
        (payload) => {
          const msg = payload.new as any;
          // Only notify for seller messages (not admin's own messages)
          if (msg.sender_type === "seller" && msg.sender_id !== authUser.id) {
            // Play sound
            playAdminNotificationSound();
            // Show toast
            toast.info("New support message", {
              description: msg.message?.slice(0, 80) + (msg.message?.length > 80 ? "..." : ""),
              duration: 4000,
            });
            // Refresh relevant queries
            queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
            queryClient.invalidateQueries({ queryKey: ["support-messages", msg.ticket_id] });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, authUser, queryClient]);
}
