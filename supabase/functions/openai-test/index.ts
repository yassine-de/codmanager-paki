// @ts-nocheck
// Test OpenAI API key connection
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeModel(model: string): string {
  if (!model) return "gpt-4o-mini";
  if (model.startsWith("openai/")) return model.replace("openai/", "");
  if (model.includes("gemini-2.5-pro") || model.includes("gemini-3.1-pro")) return "gpt-4o";
  if (model.includes("gemini")) return "gpt-4o-mini";
  return model;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: userData.user.id });
    if (!isAdmin) return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Prefer key stored in app_settings (UI-managed), fallback to env
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await admin.from("app_settings").select("value").eq("key", "openai_api_key").maybeSingle();
    const apiKey = (row?.value as string) || Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, configured: false, error: "No API key configured. Add one in the Connection tab." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: aiSettings } = await admin
      .from("whatsapp_ai_settings")
      .select("model")
      .eq("singleton", true)
      .maybeSingle();
    const model = normalizeModel((aiSettings?.model as string) || Deno.env.get("OPENAI_TEST_MODEL") || "gpt-4o-mini");

    let r: Response | null = null;
    let txt = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with OK only." }],
          temperature: 0,
          max_tokens: 5,
        }),
      });
      txt = await r.text();
      if (r.ok || r.status < 500) break;
      await sleep(300 * (attempt + 1));
    }

    if (!r?.ok) {
      let msg = `OpenAI returned ${r.status}`;
      if (r.status === 401) msg = "Invalid API key (401). Check your OpenAI API key.";
      else if (r.status === 429) msg = "Rate limited (429). Try again later.";
      else if (/insufficient_quota|billing/i.test(txt)) msg = "Quota exhausted. Add credits to your OpenAI account.";
      else if (r.status >= 500) msg = "OpenAI is returning a temporary server error (5xx). The key is configured; try again in a few minutes.";
      else {
        try {
          const parsed = JSON.parse(txt);
          msg = parsed?.error?.message || msg;
        } catch {
          if (txt) msg = txt.slice(0, 240);
        }
      }
      return new Response(JSON.stringify({ ok: false, configured: true, error: msg, status: r.status, model }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = JSON.parse(txt);
    const keyMasked = `sk-...${apiKey.slice(-4)}`;
    return new Response(JSON.stringify({
      ok: true,
      configured: true,
      key_masked: keyMasked,
      model,
      model_count: 1,
      sample: data?.choices?.[0]?.message?.content || "OK",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
