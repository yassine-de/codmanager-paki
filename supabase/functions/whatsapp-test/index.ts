// Test connection / send a free-form text test message via Meta Cloud API.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData } = await supabase.auth.getClaims(token);
    if (!claimsData?.claims) throw new Error("Unauthorized");
    const userId = claimsData.claims.sub;
    const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: userId });
    if (!isAdmin) throw new Error("Forbidden");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: s } = await admin.from("whatsapp_settings").select("*").eq("singleton", true).maybeSingle();
    if (!s) throw new Error("Settings missing");

    const accessToken = (s as any).access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
    if (!accessToken) throw new Error("Access token missing. Add it in WhatsApp Settings.");

    const { mode, phone } = await req.json();

    if (mode === "connection") {
      if (!s.phone_number_id) throw new Error("phone_number_id missing");
      const r = await fetch(`${s.api_base_url}/${s.phone_number_id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const j = await r.json();
      return new Response(JSON.stringify({ ok: r.ok, response: j }), {
        status: r.ok ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "message") {
      if (!phone) throw new Error("phone required");
      const to = String(phone).replace(/[^\d]/g, "");
      const r = await fetch(`${s.api_base_url}/${s.phone_number_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: "Test message from CRM ✅" },
        }),
      });
      const j = await r.json();
      return new Response(JSON.stringify({ ok: r.ok, response: j }), {
        status: r.ok ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Invalid mode");
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
