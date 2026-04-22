// Test OpenAI API key connection
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

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, configured: false, error: "OPENAI_API_KEY not configured" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Test with a tiny call to /models which is cheap and fast
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!r.ok) {
      const txt = await r.text();
      let msg = `OpenAI returned ${r.status}`;
      if (r.status === 401) msg = "Invalid API key (401). Check your OpenAI API key.";
      else if (r.status === 429) msg = "Rate limited (429). Try again later.";
      else if (/insufficient_quota|billing/i.test(txt)) msg = "Quota exhausted. Add credits to your OpenAI account.";
      return new Response(JSON.stringify({ ok: false, configured: true, error: msg, status: r.status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await r.json();
    const modelCount = Array.isArray(data?.data) ? data.data.length : 0;
    const keyMasked = `sk-...${apiKey.slice(-4)}`;
    return new Response(JSON.stringify({ ok: true, configured: true, key_masked: keyMasked, model_count: modelCount }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
