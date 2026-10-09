import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type BlacklistStatus = {
  input_phone: string;
  phone_key: string;
  is_blacklisted: boolean;
  source: "manual" | "auto" | "cleared" | null;
  returned_count: number;
  delivered_count: number;
  reason: string | null;
};

// These RPCs aren't in the generated Supabase types yet.
const untypedRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: Error | null }>;

const BLACKLIST_ADD_ROLES = ["admin", "general_manager", "agent", "follow_up", "whatsapp_manager"];
const BLACKLIST_REMOVE_ROLES = ["admin", "general_manager"];

export function blacklistSummary(s: BlacklistStatus) {
  if (s.source === "manual") return s.reason ? `Blacklisted manually: ${s.reason}` : "Blacklisted manually";
  return `${s.returned_count} returned orders, never accepted a delivery`;
}

export function useBlacklistPermissions() {
  const { authUser } = useAuth();
  const role = authUser?.role ?? "";
  return {
    canView: role !== "" && role !== "seller",
    canAdd: BLACKLIST_ADD_ROLES.includes(role),
    canRemove: BLACKLIST_REMOVE_ROLES.includes(role),
  };
}

// Keyed by the phone string exactly as passed in, so callers can look up their own rows.
export function useCustomerBlacklist(phones: Array<string | null | undefined>) {
  const { canView } = useBlacklistPermissions();
  const list = [...new Set(phones.filter((p): p is string => !!p && p.trim() !== ""))].sort();

  return useQuery({
    queryKey: ["customer-blacklist", list],
    enabled: canView && list.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await untypedRpc("get_customer_blacklist_status", { p_phones: list });
      if (error) throw error;
      const map = new Map<string, BlacklistStatus>();
      ((data ?? []) as BlacklistStatus[]).forEach((row) => map.set(row.input_phone, row));
      return map;
    },
  });
}

export function useSetCustomerBlacklist() {
  const queryClient = useQueryClient();
  return async (phone: string, blacklisted: boolean, reason?: string) => {
    const { error } = await untypedRpc("set_customer_blacklist", {
      p_phone: phone,
      p_blacklisted: blacklisted,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: ["customer-blacklist"] });
  };
}
