// WhatsApp AI Engine — uses OpenAI API directly
// Modes:
//  - suggest: generate reply suggestions for a conversation/message
//  - analyze: detect intent, sentiment, language for a message
//  - auto_reply: full auto-reply (used by webhook)
//  - update_memory: refresh AI memory summary for a phone
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  mode: "suggest" | "analyze" | "auto_reply" | "update_memory";
  conversation_id?: string;
  message_id?: string;
  customer_phone?: string;
  text?: string;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// Map any non-OpenAI model names to OpenAI equivalents
function normalizeModel(model: string): string {
  if (!model) return "gpt-4o-mini";
  if (model.startsWith("openai/")) return model.replace("openai/", "");
  // Map Gemini models to OpenAI equivalents
  if (model.includes("gemini-2.5-pro") || model.includes("gemini-3.1-pro")) return "gpt-4o";
  if (model.includes("gemini-2.5-flash-lite")) return "gpt-4o-mini";
  if (model.includes("gemini")) return "gpt-4o-mini";
  return model;
}

async function getApiKey(admin: any): Promise<string> {
  // Prefer DB-stored key (managed via UI), fallback to env
  const { data } = await admin.from("app_settings").select("value").eq("key", "openai_api_key").maybeSingle();
  const fromDb = (data?.value as string)?.trim();
  return fromDb || Deno.env.get("OPENAI_API_KEY") || "";
}

async function callAI(model: string, messages: any[], opts: { temperature?: number; max_tokens?: number; tools?: any[]; tool_choice?: any; apiKey?: string } = {}) {
  const apiKey = opts.apiKey || Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OpenAI API key not configured. Add one in the AI Settings → Connection tab.");
  const body: any = {
    model: normalizeModel(model),
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 512,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  const r = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 429) throw new Error("OpenAI rate limited (429). Try again later.");
    if (r.status === 401) throw new Error("Invalid OpenAI API key (401). Update it in AI Settings → Connection.");
    if (r.status === 402 || /insufficient_quota|billing/i.test(t)) throw new Error("OpenAI quota exhausted. Add credits to your OpenAI account.");
    throw new Error(`OpenAI error ${r.status}: ${t}`);
  }
  return r.json();
}

function buildSystem(settings: any, memory: any | null, productCtx: string) {
  const tone = settings.brand_tone || "friendly";
  const lines = settings.response_lines ?? 3;
  let sys = `${settings.system_prompt}\n\nBrand tone: ${tone}.\nLanguage rules: ${settings.language_rules}\nProduct context: ${settings.product_context}\n\nKeep replies to about ${lines} short line(s). Do not invent prices or stock. Be concise.`;
  if (productCtx) sys += `\n\nAvailable products:\n${productCtx}`;
  if (memory?.summary) sys += `\n\nCustomer memory:\n${memory.summary}\nLanguage: ${memory.language ?? "unknown"}\nIntent: ${memory.intent ?? "unknown"}\nSentiment: ${memory.sentiment ?? "unknown"}\nLead score: ${memory.lead_score ?? 0}`;
  return sys;
}

async function loadProductContext(admin: any) {
  const { data } = await admin.from("products").select("name,price,quantity,active").eq("active", true).limit(20);
  if (!data?.length) return "";
  return data.map((p: any) => `- ${p.name} (${p.price} PKR, stock: ${p.quantity})`).join("\n");
}

async function loadHistory(admin: any, conversationId: string, limit = 10) {
  const { data } = await admin.from("whatsapp_messages")
    .select("direction,body,created_at,message_type")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).reverse().map((m: any) => ({
    role: m.direction === "in" ? "user" : "assistant",
    content: m.body || `[${m.message_type}]`,
  }));
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
    const apiKey = await getApiKey(admin);
    const body = (await req.json()) as Body;

    const { data: settings } = await admin.from("whatsapp_ai_settings").select("*").eq("singleton", true).maybeSingle();
    if (!settings) throw new Error("AI settings missing");

    // Resolve conversation/phone
    let conv: any = null;
    let phone = body.customer_phone || "";
    if (body.conversation_id) {
      const { data } = await admin.from("whatsapp_conversations").select("*").eq("id", body.conversation_id).maybeSingle();
      conv = data;
      phone = phone || conv?.customer_phone || "";
    }

    let memory: any = null;
    if (settings.ai_memory_enabled && phone) {
      const { data } = await admin.from("whatsapp_ai_memory").select("*").eq("customer_phone", phone).maybeSingle();
      memory = data;
    }

    const productCtx = await loadProductContext(admin);
    const sys = buildSystem(settings, memory, productCtx);
    const history = body.conversation_id ? await loadHistory(admin, body.conversation_id) : [];
    const userText = body.text || history[history.length - 1]?.content || "";

    if (body.mode === "analyze") {
      const tools = [{
        type: "function",
        function: {
          name: "analyze_message",
          description: "Analyze customer message",
          parameters: {
            type: "object",
            properties: {
              language: { type: "string", description: "darija|arabic|french|english|other" },
              sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
              intent: { type: "string", description: "order_inquiry|product_question|complaint|greeting|cancel|confirm|other" },
              lead_score: { type: "integer", minimum: 0, maximum: 100 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["language", "sentiment", "intent", "lead_score", "confidence"],
          },
        },
      }];
      const result = await callAI(settings.model, [
        { role: "system", content: "Analyze the user's message. Return ONLY via the tool." },
        { role: "user", content: userText },
      ], { tools, tool_choice: { type: "function", function: { name: "analyze_message" } }, temperature: 0.2, max_tokens: 200, apiKey });
      const args = JSON.parse(result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || "{}");
      return new Response(JSON.stringify({ ok: true, analysis: args }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.mode === "suggest") {
      const tools = [{
        type: "function",
        function: {
          name: "suggest_replies",
          description: "Provide 2-3 short reply suggestions",
          parameters: {
            type: "object",
            properties: {
              suggestions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
              intent: { type: "string" },
              sentiment: { type: "string" },
              language: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["suggestions"],
          },
        },
      }];
      const result = await callAI(settings.model, [
        { role: "system", content: sys + "\n\nProvide 2-3 alternative reply suggestions, varied in approach." },
        ...history,
      ], { tools, tool_choice: { type: "function", function: { name: "suggest_replies" } }, temperature: settings.temperature, max_tokens: settings.max_tokens, apiKey });
      const args = JSON.parse(result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || "{}");

      if (body.conversation_id) {
        await admin.from("whatsapp_ai_suggestions").insert({
          conversation_id: body.conversation_id,
          message_id: body.message_id ?? null,
          suggestions: args.suggestions ?? [],
          intent: args.intent ?? null,
          sentiment: args.sentiment ?? null,
          language: args.language ?? null,
          confidence: args.confidence ?? null,
        });
      }
      return new Response(JSON.stringify({ ok: true, ...args }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.mode === "auto_reply") {
      const result = await callAI(settings.model, [
        { role: "system", content: sys },
        ...history,
      ], { temperature: settings.temperature, max_tokens: settings.max_tokens, apiKey });
      const reply = result.choices?.[0]?.message?.content?.trim() || "";
      return new Response(JSON.stringify({ ok: true, reply }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.mode === "update_memory") {
      if (!phone) throw new Error("phone required");
      const tools = [{
        type: "function",
        function: {
          name: "update_memory",
          description: "Summarize the conversation and customer profile",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string", description: "Concise running summary of customer + needs (3-5 lines)" },
              language: { type: "string" },
              sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
              intent: { type: "string" },
              lead_score: { type: "integer", minimum: 0, maximum: 100 },
              preferences: { type: "object", additionalProperties: true },
              facts: { type: "array", items: { type: "string" } },
            },
            required: ["summary", "language", "sentiment", "intent", "lead_score"],
          },
        },
      }];
      const convoText = history.map((m) => `${m.role}: ${m.content}`).join("\n");
      const result = await callAI(settings.model, [
        { role: "system", content: "Summarize this conversation into a structured memory entry. Return ONLY via the tool." },
        { role: "user", content: convoText || userText },
      ], { tools, tool_choice: { type: "function", function: { name: "update_memory" } }, temperature: 0.3, max_tokens: 400, apiKey });
      const args = JSON.parse(result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || "{}");

      await admin.from("whatsapp_ai_memory").upsert({
        customer_phone: phone,
        conversation_id: conv?.id ?? null,
        summary: args.summary,
        language: args.language,
        sentiment: args.sentiment,
        intent: args.intent,
        lead_score: args.lead_score ?? 0,
        preferences: args.preferences ?? {},
        facts: args.facts ?? [],
        last_interaction_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "customer_phone" });

      return new Response(JSON.stringify({ ok: true, memory: args }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: false, error: "unknown mode" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
