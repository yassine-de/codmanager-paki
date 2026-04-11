import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, Wifi, WifiOff, Clock } from "lucide-react";
import { useMemo } from "react";

type PresenceStatus = "online" | "idle" | "offline";

interface UserPresence {
  user_id: string;
  name: string;
  role: string;
  status: PresenceStatus;
  lastSeen: Date;
  timeAgo: string;
}

function getStatus(lastSeen: Date, isActive: boolean): PresenceStatus {
  const diffMs = Date.now() - lastSeen.getTime();
  const diffMin = diffMs / 60_000;
  if (isActive && diffMin < 2) return "online";
  if (diffMin < 5) return "idle";
  return "offline";
}

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const statusConfig = {
  online: {
    color: "bg-emerald-500",
    text: "text-emerald-600",
    label: "Active now",
    glow: "shadow-[0_0_6px_rgba(16,185,129,0.4)]",
  },
  idle: {
    color: "bg-amber-500",
    text: "text-amber-600",
    label: "Away",
    glow: "shadow-[0_0_6px_rgba(245,158,11,0.3)]",
  },
  offline: {
    color: "bg-red-400",
    text: "text-red-500",
    label: "Offline",
    glow: "",
  },
};

export default function OnlineStatusPanel() {
  const { data: presenceData = [] } = useQuery({
    queryKey: ["user-presence"],
    queryFn: async () => {
      const { data } = await supabase.from("user_presence").select("*");
      return (data || []) as any[];
    },
    refetchInterval: 15_000,
  });

  const { data: rolesData = [] } = useQuery({
    queryKey: ["presence-roles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["agent", "admin"]);
      return data || [];
    },
  });

  const userIds = useMemo(() => rolesData.map((r) => r.user_id), [rolesData]);

  const { data: profiles = [] } = useQuery({
    queryKey: ["presence-profiles", userIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", userIds);
      return data || [];
    },
    enabled: userIds.length > 0,
  });

  const users: UserPresence[] = useMemo(() => {
    const profileMap: Record<string, string> = {};
    profiles.forEach((p) => { profileMap[p.user_id] = p.name; });

    const presenceMap: Record<string, any> = {};
    presenceData.forEach((p: any) => { presenceMap[p.user_id] = p; });

    return rolesData.map((r) => {
      const presence = presenceMap[r.user_id];
      const lastSeen = presence ? new Date(presence.last_seen) : new Date(0);
      const isActive = presence?.is_active ?? false;
      const status = presence ? getStatus(lastSeen, isActive) : "offline";
      return {
        user_id: r.user_id,
        name: profileMap[r.user_id] || "Unknown",
        role: r.role,
        status,
        lastSeen,
        timeAgo: formatTimeAgo(lastSeen),
      };
    }).sort((a, b) => {
      const order = { online: 0, idle: 1, offline: 2 };
      return order[a.status] - order[b.status];
    });
  }, [rolesData, profiles, presenceData]);

  const onlineCount = users.filter((u) => u.status === "online").length;
  const idleCount = users.filter((u) => u.status === "idle").length;
  const offlineCount = users.filter((u) => u.status === "offline").length;

  return (
    <div
      className="bg-card rounded-xl border shadow-soft animate-slide-up overflow-hidden"
      style={{ animationDelay: "80ms" }}
    >
      {/* Header row */}
      <div className="px-4 py-2.5 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-emerald-500/10">
            <Users className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Team Status
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {onlineCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full">
              <Wifi className="w-2.5 h-2.5" />
              {onlineCount} online
            </span>
          )}
          {idleCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">
              <Clock className="w-2.5 h-2.5" />
              {idleCount} idle
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground/60">
            {offlineCount} offline
          </span>
        </div>
      </div>

      {/* Horizontal scrollable user list */}
      <div className="px-4 py-3 flex gap-3 overflow-x-auto scrollbar-hide">
        {users.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-muted-foreground">
            <WifiOff className="w-4 h-4 opacity-40" />
            <p className="text-xs">No team members found</p>
          </div>
        ) : (
          users.map((u) => {
            const cfg = statusConfig[u.status];
            return (
              <div
                key={u.user_id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-muted/20 hover:bg-muted/40 transition-colors shrink-0 min-w-0"
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase">
                    {u.name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)}
                  </div>
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${cfg.color} ${cfg.glow}`}
                  />
                </div>

                {/* Info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] font-semibold truncate max-w-[100px]">{u.name}</p>
                    <span className="text-[8px] font-medium px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider shrink-0">
                      {u.role}
                    </span>
                  </div>
                  <p className={`text-[9px] font-medium ${cfg.text} mt-0.5 whitespace-nowrap`}>
                    {u.status === "online"
                      ? "Active now"
                      : u.status === "idle"
                      ? "Away"
                      : u.timeAgo}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
