import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"] | "warehouse_agent" | "warehouse_manager";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  permissions: string[];
  phone: string;
  active: boolean;
}

interface AuthContextType {
  user: User | null;
  authUser: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  hasPermission: (key: string) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // A 401 here (typically caused by the auth token failing to refresh in
  // time, sometimes rate-limited by Supabase — see gotrue-js "Lock ...
  // was not released" console warning) makes these queries silently
  // return null/empty instead of throwing, which used to fall back to
  // role: "custom" and render a broken "no access" UI even though the
  // account itself is perfectly fine. isAuthError() lets the caller detect
  // that specific case and recover instead of trusting the empty result.
  const isAuthError = (error: { code?: string; message?: string } | null) =>
    !!error && (error.code === "PGRST301" || /jwt|401|unauthorized/i.test(error.message || ""));

  const fetchUserDetails = async (supabaseUser: User): Promise<AuthUser | null> => {
    const fallbackName =
      typeof supabaseUser.user_metadata?.name === "string" && supabaseUser.user_metadata.name.trim().length > 0
        ? supabaseUser.user_metadata.name
        : supabaseUser.email?.split("@")[0] || "User";

    try {
      const [profileRes, roleRes, permsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", supabaseUser.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", supabaseUser.id).maybeSingle(),
        supabase.from("user_permissions").select("permission_key").eq("user_id", supabaseUser.id),
      ]);

      if (isAuthError(profileRes.error) || isAuthError(roleRes.error) || isAuthError(permsRes.error)) {
        // The access token is stale/invalid rather than the account lacking
        // a role — null signals the caller to recover the session and
        // retry, instead of us guessing a role from a failed query.
        return null;
      }

      const profile = profileRes.data;
      const roleData = roleRes.data;
      const permsData = permsRes.data;

      return {
        id: supabaseUser.id,
        email: profile?.email || supabaseUser.email || "",
        name: profile?.name || fallbackName,
        role: roleData?.role || "custom",
        permissions: permsData?.map((p) => p.permission_key) || [],
        phone: profile?.phone || "",
        active: profile?.active ?? true,
      };
    } catch (err) {
      console.error("Error fetching user details:", err);
      return null;
    }
  };

  // fetchUserDetails returning null means the profile/role/permission
  // queries failed on an invalid token, not that the account has no role.
  // Recover by actively refreshing the session and retrying once; only if
  // that still fails do we treat it as a real sign-out, so a transient
  // token hiccup (e.g. a rate-limited refresh) can't strand someone on a
  // broken "no access" screen for an account that's actually fine.
  const resolveUserDetails = async (sessionUser: User): Promise<AuthUser | null> => {
    let details = await fetchUserDetails(sessionUser);
    if (details) return details;

    const { data: refreshed } = await supabase.auth.refreshSession();
    details = await fetchUserDetails(refreshed.user ?? sessionUser);
    return details;
  };

  const refreshUser = async () => {
    if (!user) return;
    setLoading(true);
    const details = await resolveUserDetails(user);
    if (details) {
      setAuthUser(details);
    } else {
      await supabase.auth.signOut();
      setUser(null);
      setAuthUser(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    let isMounted = true;

    const syncAuthState = async (sessionUser: User | null) => {
      if (!isMounted) return;

      if (sessionUser) {
        // If same user is already fully loaded, skip refetch
        if (authUser?.id === sessionUser.id && authUser.role !== "custom") {
          setUser(sessionUser);
          setLoading(false);
          return;
        }
        // Fetch ALL user data before rendering UI
        const details = await resolveUserDetails(sessionUser);
        if (!isMounted) return;
        if (details) {
          setUser(sessionUser);
          setAuthUser(details);
        } else {
          // Session truly can't be recovered — sign out cleanly instead of
          // rendering a broken permission-denied state for a fine account.
          await supabase.auth.signOut();
          setUser(null);
          setAuthUser(null);
        }
        setLoading(false);
      } else {
        setUser(null);
        setAuthUser(null);
        setLoading(false);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncAuthState(session?.user ?? null);
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void syncAuthState(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setAuthUser(null);
  };

  const hasPermission = (key: string) => {
    if (!authUser) return false;
    if (authUser.role === "admin") return true;
    return authUser.permissions.includes(key);
  };

  return (
    <AuthContext.Provider
      value={{ user, authUser, loading, signIn, signOut, hasPermission, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
