// Save / read OpenAI API key in app_settings (admin only)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KEY_NAME = "openai_api_key";

function mask(k: string) {
  if (!k) return "";
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 3)}...${k.slice(-4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await supabase.auth.getClaims(token);
    if (!claims?.claims) return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: claims.claims.sub });
    if (!isAdmin) return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (req.method === "GET" || (req.method === "POST" && req.headers.get("x-action") === "get")) {
      const { data } = await admin.from("app_settings").select("value, updated_at").eq("key", KEY_NAME).maybeSingle();
      const v = data?.value || "";
      return new Response(JSON.stringify({ ok: true, configured: !!v, key_masked: v ? mask(v) : null, updated_at: data?.updated_at ?? null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || "save";

    if (action === "delete") {
      await admin.from("app_settings").delete().eq("key", KEY_NAME);
      return new Response(JSON.stringify({ ok: true, deleted: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = (body.api_key || "").trim();
    if (!apiKey || !apiKey.startsWith("sk-") || apiKey.length < 20) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid API key format. It should start with 'sk-' and be longer than 20 characters." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await admin.from("app_settings").upsert({ key: KEY_NAME, value: apiKey, updated_at: new Date().toISOString() }, { onConflict: "key" });

    return new Response(JSON.stringify({ ok: true, configured: true, key_masked: mask(apiKey) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
