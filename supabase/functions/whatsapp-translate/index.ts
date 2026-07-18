// @ts-nocheck
// Translate a WhatsApp message body to English for internal staff.
// Uses OpenAI when OPENAI_API_KEY is configured; falls back to Lovable AI Gateway.
// Result is cached on the message row in payload._translation_en.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Use service role to validate the JWT — more reliable than anon-key getUser()
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const jwt = authHeader.slice(7); // strip "Bearer "
    const { data: userData } = await admin.auth.getUser(jwt);
    if (!userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { message_id, text } = await req.json();
    if (!message_id && !text) {
      return new Response(JSON.stringify({ ok: false, error: "message_id or text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body = text as string | undefined;
    let existingPayload: any = {};
    if (message_id) {
      const { data: msg } = await admin
        .from("whatsapp_messages")
        .select("body, payload")
        .eq("id", message_id)
        .maybeSingle();
      if (!msg) {
        return new Response(JSON.stringify({ ok: false, error: "Message not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      body = body || msg.body || "";
      existingPayload = msg.payload || {};
      // Return cached translation if present
      if (existingPayload?._translation_en) {
        return new Response(
          JSON.stringify({ ok: true, translation: existingPayload._translation_en, cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!body || !body.trim()) {
      return new Response(JSON.stringify({ ok: false, error: "Empty text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const OPENAI_TRANSLATION_MODEL = Deno.env.get("OPENAI_TRANSLATION_MODEL") || "gpt-4o-mini";
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    const callOpenAI = async () => {
      return await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OPENAI_TRANSLATION_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are a translator. Translate the user's WhatsApp message to clear, natural English. If the message is already English, return it unchanged. Output ONLY the translation, no quotes, no explanations, no language labels.",
            },
            { role: "user", content: body },
          ],
          temperature: 0.1,
          max_tokens: 400,
        }),
      });
    };

    const callLovableGateway = async () => {
      return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You are a translator. Translate the user's message to clear, natural English. If the message is already in English, return it unchanged. Output ONLY the translation, no quotes, no explanations, no language labels.",
            },
            { role: "user", content: body },
          ],
          temperature: 0.2,
          max_tokens: 400,
        }),
      });
    };

    const provider = OPENAI_API_KEY ? "openai" : LOVABLE_API_KEY ? "lovable" : null;
    if (!provider) throw new Error("OPENAI_API_KEY or LOVABLE_API_KEY not configured");
    const callProvider = provider === "openai" ? callOpenAI : callLovableGateway;

    let r = await callProvider();
    // Retry once on rate-limit / transient 5xx after a short backoff
    if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
      await new Promise((res) => setTimeout(res, 1500));
      try {
        const retry = await callProvider();
        r = retry;
      } catch (_) {
        // keep original r
      }
    }

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      const reason =
        r.status === 429
          ? "Translation service is busy. Try again in a few seconds."
          : r.status === 402
          ? "AI credits exhausted. Please top up to use translation."
          : `${provider === "openai" ? "OpenAI" : "AI gateway"} error ${r.status}`;
      console.error("[wa-translate] provider failure", { provider, status: r.status, body: t.slice(0, 200) });
      // Return 200 with ok:false so the client can read the structured reason
      return new Response(
        JSON.stringify({ ok: false, error: reason, status: r.status }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const j = await r.json();
    const translation = (j.choices?.[0]?.message?.content || "").trim();

    if (!translation) {
      return new Response(
        JSON.stringify({ ok: false, error: "Empty translation returned" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (message_id) {
      await admin
        .from("whatsapp_messages")
        .update({ payload: { ...existingPayload, _translation_en: translation } })
        .eq("id", message_id);
    }

    return new Response(JSON.stringify({ ok: true, translation, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[wa-translate] unexpected error", e);
    // Return 200 so the SDK doesn't swallow the message under "non-2xx status code"
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message || "Translation failed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
