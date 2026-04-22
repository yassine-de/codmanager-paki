// Sends a WhatsApp message via Meta Cloud API.
// Supports 3 modes:
//  - template: send approved template by template_id (always allowed; bypasses 24h)
//  - text:     send free-form text (only valid inside 24h customer service window)
//  - order:    send order-confirmation interactive buttons (default legacy behavior)
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SendBody {
  order_id?: string;
  conversation_id?: string;
  template_id?: string;
  body?: string;
  mode?: "template" | "text" | "order" | "image" | "document" | "audio";
  media_url?: string;
  media_filename?: string;
}

function render(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

function normalizePhone(phone: string, defaultCC: string) {
  let p = (phone || "").replace(/\D/g, "");
  if (!p) return "";
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = defaultCC + p.slice(1);
  return p;
}

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
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;
    const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: userId });
    if (!isAdmin) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = (await req.json()) as SendBody;
    const mode = body.mode ?? "order";

    const { data: settings } = await admin.from("whatsapp_settings").select("*").eq("singleton", true).maybeSingle();
    if (!settings) throw new Error("WhatsApp settings missing");
    if (!settings.integration_enabled || !settings.sending_enabled) {
      return new Response(JSON.stringify({ ok: false, error: "Sending disabled in settings" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!settings.phone_number_id) throw new Error("phone_number_id missing");
    const accessToken = (settings as any).access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
    if (!accessToken) throw new Error("Access token missing. Add it in WhatsApp Settings.");

    // Resolve conversation + order
    let conv: any = null;
    let order: any = null;

    if (body.conversation_id) {
      const { data } = await admin.from("whatsapp_conversations").select("*").eq("id", body.conversation_id).maybeSingle();
      conv = data;
      if (conv?.order_id) {
        const { data: o } = await admin.from("orders").select("*").eq("order_id", conv.order_id).maybeSingle();
        order = o;
      }
    } else if (body.order_id) {
      const { data: o } = await admin.from("orders").select("*").eq("order_id", body.order_id).maybeSingle();
      order = o;
      if (!order) throw new Error("Order not found");
      const { data: c } = await admin.from("whatsapp_conversations").select("*").eq("order_id", body.order_id).maybeSingle();
      conv = c;
    } else {
      throw new Error("conversation_id or order_id required");
    }

    const to = normalizePhone(
      conv?.customer_phone || order?.customer_phone || "",
      settings.default_country_code,
    );
    if (!to) throw new Error("Customer phone invalid");

    // Build payload depending on mode
    let payload: any;
    let bodyText = body.body ?? "";

    if (mode === "text") {
      if (!bodyText.trim()) throw new Error("Empty message");
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: bodyText },
      };
    } else if (mode === "image" || mode === "document" || mode === "audio") {
      if (!body.media_url) throw new Error("media_url required");
      const mediaObj: any = { link: body.media_url };
      if (mode === "image" && bodyText) mediaObj.caption = bodyText;
      if (mode === "document") {
        if (bodyText) mediaObj.caption = bodyText;
        if (body.media_filename) mediaObj.filename = body.media_filename;
      }
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: mode,
        [mode]: mediaObj,
      };
      if (!bodyText) bodyText = body.media_filename || `[${mode}]`;
    } else {
      // order: legacy interactive confirmation buttons
      if (!order) throw new Error("Order required for order mode");
      let text = bodyText;
      if (!text && body.template_id) {
        const { data: tpl } = await admin.from("whatsapp_templates").select("*").eq("id", body.template_id).maybeSingle();
        if (tpl) {
          text = render(tpl.body, {
            customer_name: order.customer_name,
            product_name: order.product_name,
            price: order.total_amount,
            city: order.customer_city,
            address: order.customer_address,
            order_id: order.order_id,
          });
        }
      }
      if (!text) text = `Order ${order.order_id}: please confirm.`;
      bodyText = text;
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text },
          action: {
            buttons: [
              { type: "reply", reply: { id: `wts_confirm_${order.order_id}`, title: "Confirm" } },
              { type: "reply", reply: { id: `wts_more_${order.order_id}`, title: "More info" } },
              { type: "reply", reply: { id: `wts_cancel_${order.order_id}`, title: "Cancel" } },
            ],
          },
        },
      };
    }

    // Ensure conversation row exists
    if (!conv) {
      const ins = await admin.from("whatsapp_conversations").insert({
        order_id: order?.order_id ?? null,
        customer_phone: to,
        customer_name: order?.customer_name ?? null,
        status: "pending",
      }).select().single();
      conv = ins.data;
    }

    const url = `${settings.api_base_url}/${settings.phone_number_id}/messages`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const respJson = await resp.json();
    const ok = resp.ok;
    const metaMsgId = ok ? respJson?.messages?.[0]?.id : null;

    await admin.from("whatsapp_messages").insert({
      conversation_id: conv!.id,
      order_id: order?.order_id ?? null,
      direction: "out",
      message_type: ["template","text","image","document","audio"].includes(mode) ? mode : "interactive",
      body: bodyText,
      payload,
      meta_message_id: metaMsgId,
      status: ok ? "sent" : "failed",
      error_message: ok ? null : JSON.stringify(respJson),
    });

    if (ok) {
      await admin.from("whatsapp_conversations").update({
        status: conv.status === "pending" ? "awaiting_reply" : conv.status,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", conv!.id);
      if (order) {
        await admin.from("orders").update({
          whatsapp_status: "awaiting_reply",
          whatsapp_last_sent_at: new Date().toISOString(),
          whatsapp_retry_count: (order.whatsapp_retry_count ?? 0) + 1,
        }).eq("order_id", order.order_id);
      }
    }

    return new Response(JSON.stringify({ ok, response: respJson }), {
      status: ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
