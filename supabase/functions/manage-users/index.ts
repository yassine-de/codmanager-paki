// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const sellerPermissions = [
  "access_to_dashboard",
  "view_dashboard",
  "access_to_orders",
  "view_order",
  "create_order",
  "show_all_orders",
  "access_to_products",
  "view_product",
  "show_all_products",
  "access_to_confirmations",
  "view_confirmation",
  "show_all_confirmations",
  "access_to_sellers",
  "view_seller",
  "show_seller_sales",
];

const agentPermissions = [
  "access_to_dashboard",
  "view_dashboard",
  "access_to_confirmations",
  "view_confirmation",
  "create_confirmation",
  "update_confirmation",
  "show_all_confirmations",
];

const seedUsers = [
  { email: "adil@codmanager.com", password: "Am!n2019", name: "Adil Hachmaoui", role: "admin" },
  { email: "bader@codmanager.com", password: "CodManager2026", name: "Badereddine Ait Boulouden", role: "admin" },
  { email: "anwar@codmanager.com", password: "CodManager2026", name: "Anwar Bounasser", role: "admin" },
  { email: "agent1@codmanager.com", password: "Agent2026", name: "Agent One", role: "agent" },
  { email: "agent2@codmanager.com", password: "Agent2026", name: "Agent Two", role: "agent" },
  { email: "agent3@codmanager.com", password: "Agent2026", name: "Agent Three", role: "agent" },
  { email: "seller1@codmanager.com", password: "Seller2026", name: "Seller One", role: "seller" },
  { email: "seller2@codmanager.com", password: "Seller2026", name: "Seller Two", role: "seller" },
  { email: "seller3@codmanager.com", password: "Seller2026", name: "Seller Three", role: "seller" },
] as const;

function generatePrefix(name: string, existingPrefixes: string[]) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] || "";
  const last = parts[parts.length - 1] || "";

  // Strategy 1: first letter of first name + iterate each letter of last name
  for (let i = 0; i < last.length; i++) {
    const candidate = (first[0] + last[i]).toUpperCase();
    if (candidate.length === 2 && !existingPrefixes.includes(candidate)) return candidate;
  }

  // Strategy 2: iterate all combinations
  for (let i = 0; i < first.length; i++) {
    for (let j = 0; j < last.length; j++) {
      const candidate = (first[i] + last[j]).toUpperCase();
      if (candidate.length === 2 && !existingPrefixes.includes(candidate)) return candidate;
    }
  }

  // Fallback: first two letters of first name
  return first.substring(0, 2).toUpperCase() || "SL";
}

async function getAllPermissionKeys(supabaseAdmin: ReturnType<typeof createClient>) {
  const { data, error } = await supabaseAdmin.from("permissions").select("key");
  if (error) throw error;
  return data?.map((item) => item.key) || [];
}

function getRolePermissions(role: string, allPermissionKeys: string[], customPermissions?: string[]) {
  if (role === "admin") return allPermissionKeys;
  if (role === "seller") return sellerPermissions;
  if (role === "agent") return agentPermissions;
  if (role === "follow_up") return [];
  return customPermissions || [];
}

async function ensureProfile(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  email: string,
  name: string,
  phone = "",
  active = true,
) {
  const { data: existingProfile, error: profileLookupError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileLookupError) throw profileLookupError;

  if (existingProfile) {
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ email, name, phone, active })
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }

  const { error } = await supabaseAdmin.from("profiles").insert({
    user_id: userId,
    email,
    name,
    phone,
    active,
  });
  if (error) throw error;
}

async function ensureRole(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  role: "admin" | "seller" | "agent" | "follow_up" | "custom",
) {
  const { data: existingRole, error: roleLookupError } = await supabaseAdmin
    .from("user_roles")
    .select("id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (roleLookupError) throw roleLookupError;

  if (existingRole) {
    if (existingRole.role !== role) {
      const { error } = await supabaseAdmin.from("user_roles").update({ role }).eq("id", existingRole.id);
      if (error) throw error;
    }
    return;
  }

  const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role });
  if (error) throw error;
}

async function ensurePermissions(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  permissions: string[],
) {
  const { data: existingPermissions, error: permissionsLookupError } = await supabaseAdmin
    .from("user_permissions")
    .select("permission_key")
    .eq("user_id", userId);

  if (permissionsLookupError) throw permissionsLookupError;

  const existingKeys = new Set((existingPermissions || []).map((item) => item.permission_key));
  const missingPermissions = permissions.filter((permission) => !existingKeys.has(permission));

  if (missingPermissions.length === 0) return;

  const { error } = await supabaseAdmin.from("user_permissions").insert(
    missingPermissions.map((permission_key) => ({ user_id: userId, permission_key })),
  );
  if (error) throw error;
}

async function ensureSellerData(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
  sellerName: string,
  rates?: { rate_1kg?: number; rate_2kg?: number; rate_3kg?: number },
) {
  const { data: existingRates, error: ratesLookupError } = await supabaseAdmin
    .from("seller_rates")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (ratesLookupError) throw ratesLookupError;

  const sellerRates = {
    rate_1kg: rates?.rate_1kg ?? 35,
    rate_2kg: rates?.rate_2kg ?? 45,
    rate_3kg: rates?.rate_3kg ?? 55,
  };

  if (existingRates) {
    const { error } = await supabaseAdmin.from("seller_rates").update(sellerRates).eq("id", existingRates.id);
    if (error) throw error;
  } else {
    const { error } = await supabaseAdmin.from("seller_rates").insert({ user_id: userId, ...sellerRates });
    if (error) throw error;
  }

  const { data: existingPrefix, error: prefixLookupError } = await supabaseAdmin
    .from("seller_order_prefixes")
    .select("id")
    .eq("seller_id", userId)
    .maybeSingle();

  if (prefixLookupError) throw prefixLookupError;
  if (existingPrefix) return;

  // Gather ALL used prefixes from both order prefixes AND display_ids for collision-avoidance
  const [{ data: allOrderPrefixes, error: allPrefixesError }, { data: allDisplayIds }] = await Promise.all([
    supabaseAdmin.from("seller_order_prefixes").select("prefix"),
    supabaseAdmin.from("profiles").select("display_id").not("display_id", "is", null),
  ]);

  if (allPrefixesError) throw allPrefixesError;

  const usedPrefixes = new Set<string>();
  (allOrderPrefixes || []).forEach((item) => usedPrefixes.add(item.prefix));
  (allDisplayIds || []).forEach((item) => {
    if (item.display_id) {
      const p = item.display_id.split("-")[0];
      if (p) usedPrefixes.add(p);
    }
  });

  const prefix = generatePrefix(sellerName, [...usedPrefixes]);
  const { error } = await supabaseAdmin.from("seller_order_prefixes").insert({
    seller_id: userId,
    prefix,
    current_counter: 0,
  });
  if (error) throw error;
}

async function verifyAdmin(supabaseAdmin: ReturnType<typeof createClient>, req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new Error("Not authenticated");

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user: caller },
  } = await supabaseAdmin.auth.getUser(token);

  if (!caller) throw new Error("Invalid token");

  const { data: admin, error } = await supabaseAdmin.rpc("is_admin", { _user_id: caller.id });
  if (error) throw error;
  if (!admin) throw new Error("Admin access required");

  return caller;
}

async function createOrRepairUser(
  supabaseAdmin: ReturnType<typeof createClient>,
  userConfig: (typeof seedUsers)[number],
  allPermissionKeys: string[],
) {
  const listResponse = await supabaseAdmin.auth.admin.listUsers();
  const existingUser = listResponse.data.users.find((user) => user.email === userConfig.email);

  let userId = existingUser?.id;
  let status = "repaired";

  if (existingUser) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
      password: userConfig.password,
      email_confirm: true,
      user_metadata: { name: userConfig.name },
    });
    if (error) throw error;
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: userConfig.email,
      password: userConfig.password,
      email_confirm: true,
      user_metadata: { name: userConfig.name },
    });
    if (error) throw error;
    userId = data.user?.id;
    status = "created";
  }

  if (!userId) throw new Error(`Missing user id for ${userConfig.email}`);

  await ensureProfile(supabaseAdmin, userId, userConfig.email, userConfig.name);
  await ensureRole(supabaseAdmin, userId, userConfig.role);
  await ensurePermissions(supabaseAdmin, userId, getRolePermissions(userConfig.role, allPermissionKeys));

  if (userConfig.role === "seller") {
    await ensureSellerData(supabaseAdmin, userId, userConfig.name);
    // Generate display_id for seller if not already set
    const { data: profile } = await supabaseAdmin.from("profiles").select("display_id").eq("user_id", userId).maybeSingle();
    if (!profile?.display_id) {
      const { data: didData } = await supabaseAdmin.rpc("generate_seller_display_id", { p_name: userConfig.name });
      if (didData) {
        await supabaseAdmin.from("profiles").update({ display_id: didData }).eq("user_id", userId);
      }
    }
  }

  return { email: userConfig.email, user_id: userId, role: userConfig.role, status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL is not configured");
    }

    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { action, ...payload } = await req.json();

    if (action === "seed-admin") {
      const allPermissionKeys = await getAllPermissionKeys(supabaseAdmin);
      const result = await createOrRepairUser(
        supabaseAdmin,
        {
          email: payload.email,
          password: payload.password,
          name: payload.name,
          role: "admin",
        },
        allPermissionKeys,
      );

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "seed-all") {
      const allPermissionKeys = await getAllPermissionKeys(supabaseAdmin);
      const results = [];

      for (const userConfig of seedUsers) {
        results.push(await createOrRepairUser(supabaseAdmin, userConfig, allPermissionKeys));
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await verifyAdmin(supabaseAdmin, req);

    if (action === "create-user") {
      const { email, password, name, phone, role, rates, rateSettings, permissions } = payload;
      const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });

      if (createError || !createdUser.user) {
        return new Response(JSON.stringify({ error: createError?.message || "Unable to create user" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userId = createdUser.user.id;
      const allPermissionKeys = await getAllPermissionKeys(supabaseAdmin);

      await ensureProfile(supabaseAdmin, userId, email, name, phone || "");
      await ensureRole(supabaseAdmin, userId, role);
      await ensurePermissions(supabaseAdmin, userId, getRolePermissions(role, allPermissionKeys, permissions));

      if (role === "seller") {
        await ensureSellerData(supabaseAdmin, userId, name, rates);
        // Generate display_id for seller if not already set
        const { data: profile } = await supabaseAdmin.from("profiles").select("display_id").eq("user_id", userId).maybeSingle();
        if (!profile?.display_id) {
          const { data: didData } = await supabaseAdmin.rpc("generate_seller_display_id", { p_name: name });
          if (didData) {
            await supabaseAdmin.from("profiles").update({ display_id: didData }).eq("user_id", userId);
          }
        }
        // Update rate_settings with confirmation rates if provided
        if (rateSettings) {
          // Wait a moment for the trigger to create the rate_settings record
          const { data: existingRS } = await supabaseAdmin
            .from("rate_settings")
            .select("id")
            .eq("seller_id", userId)
            .maybeSingle();

          if (existingRS) {
            await supabaseAdmin.from("rate_settings").update({
              dropped_order_rate: rateSettings.dropped_order_rate ?? 0,
              confirmed_order_rate: rateSettings.confirmed_order_rate ?? 0,
              cod_fee_per_delivery: rateSettings.cod_fee_per_delivery ?? 0,
              is_custom: true,
            }).eq("id", existingRS.id);
          }
        }
      }

      return new Response(JSON.stringify({ success: true, user_id: userId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update-user") {
      const { userId, name, phone, active, role, rates, rateSettings, permissions } = payload;
      const profileUpdate: Record<string, unknown> = {};

      if (name !== undefined) profileUpdate.name = name;
      if (phone !== undefined) profileUpdate.phone = phone;
      if (active !== undefined) profileUpdate.active = active;

      if (Object.keys(profileUpdate).length > 0) {
        const { error } = await supabaseAdmin.from("profiles").update(profileUpdate).eq("user_id", userId);
        if (error) throw error;
      }

      if (role) {
        await ensureRole(supabaseAdmin, userId, role);
      }

      if (role === "seller") {
        const { data: profile } = await supabaseAdmin.from("profiles").select("name").eq("user_id", userId).maybeSingle();
        await ensureSellerData(supabaseAdmin, userId, profile?.name || "Seller", rates);

        // Update rate_settings if provided
        if (rateSettings) {
          const { data: existingRS } = await supabaseAdmin
            .from("rate_settings")
            .select("id")
            .eq("seller_id", userId)
            .maybeSingle();

          const rsUpdate = {
            dropped_order_rate: rateSettings.dropped_order_rate ?? 0,
            confirmed_order_rate: rateSettings.confirmed_order_rate ?? 0,
            cod_fee_per_delivery: rateSettings.cod_fee_per_delivery ?? 0,
            is_custom: true,
          };

          if (existingRS) {
            await supabaseAdmin.from("rate_settings").update(rsUpdate).eq("id", existingRS.id);
          } else {
            await supabaseAdmin.from("rate_settings").insert({
              seller_id: userId,
              is_global: false,
              ...rsUpdate,
              shipping_rate_1kg: rates?.rate_1kg ?? 0,
              shipping_rate_2kg: rates?.rate_2kg ?? 0,
              shipping_rate_3kg: rates?.rate_3kg ?? 0,
            });
          }
        }
      }

      if (permissions !== undefined) {
        const { error: deleteError } = await supabaseAdmin.from("user_permissions").delete().eq("user_id", userId);
        if (deleteError) throw deleteError;

        if (permissions.length > 0) {
          await ensurePermissions(supabaseAdmin, userId, permissions);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete-user") {
      const { userId } = payload;
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list-users") {
      // Batch all queries in parallel instead of N+1
      const [
        { data: profiles, error },
        { data: allRoles },
        { data: allPerms },
        { data: allRates },
        { data: allRateSettings },
      ] = await Promise.all([
        supabaseAdmin.from("profiles").select("*").order("created_at", { ascending: false }),
        supabaseAdmin.from("user_roles").select("user_id, role"),
        supabaseAdmin.from("user_permissions").select("user_id, permission_key"),
        supabaseAdmin.from("seller_rates").select("*"),
        supabaseAdmin.from("rate_settings").select("seller_id, dropped_order_rate, confirmed_order_rate, cod_fee_per_delivery"),
      ]);

      if (error) throw error;

      // Build lookup maps
      const rolesMap: Record<string, string> = {};
      (allRoles || []).forEach((r) => { rolesMap[r.user_id] = r.role; });

      const permsMap: Record<string, string[]> = {};
      (allPerms || []).forEach((p) => {
        if (!permsMap[p.user_id]) permsMap[p.user_id] = [];
        permsMap[p.user_id].push(p.permission_key);
      });

      const ratesMap: Record<string, any> = {};
      (allRates || []).forEach((r) => { ratesMap[r.user_id] = r; });

      const rsMap: Record<string, any> = {};
      (allRateSettings || []).forEach((rs) => { rsMap[rs.seller_id] = rs; });

      const usersWithDetails = (profiles || []).map((profile) => ({
        ...profile,
        role: rolesMap[profile.user_id] || "custom",
        permissions: permsMap[profile.user_id] || [],
        rates: ratesMap[profile.user_id] || null,
        rate_settings: rsMap[profile.user_id] || null,
      }));

      return new Response(JSON.stringify({ users: usersWithDetails }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("manage-users error:", JSON.stringify(error, Object.getOwnPropertyNames(error || {})));
    const message = error instanceof Error ? error.message : (typeof error === "object" && error !== null && "message" in error) ? (error as any).message : JSON.stringify(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
