// Sends a WhatsApp message via Meta Cloud API for a given order.
// Uses settings row from public.whatsapp_settings + WHATSAPP_META_ACCESS_TOKEN secret.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SendBody {
  order_id: string;
  template_id?: string;
  body?: string; // raw body fallback
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

    // Service-role client for writes that bypass RLS / for orders we know admins control
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = (await req.json()) as SendBody;
    if (!body?.order_id) {
      return new Response(JSON.stringify({ ok: false, error: "order_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const { data: order } = await admin.from("orders").select("*").eq("order_id", body.order_id).maybeSingle();
    if (!order) throw new Error("Order not found");

    const to = normalizePhone(order.customer_phone, settings.default_country_code);
    if (!to) throw new Error("Customer phone invalid");

    let text = body.body ?? "";
    if (!text && body.template_id) {
      const { data: tpl } = await admin.from("whatsapp_templates").select("*").eq("id", body.template_id).maybeSingle();
      if (!tpl) throw new Error("Template not found");
      text = render(tpl.body, {
        customer_name: order.customer_name,
        product_name: order.product_name,
        price: order.total_amount,
        city: order.customer_city,
        address: order.customer_address,
        order_id: order.order_id,
      });
    }
    if (!text) text = `Order ${order.order_id}: please confirm.`;

    // Find or create conversation
    let { data: conv } = await admin
      .from("whatsapp_conversations")
      .select("*")
      .eq("order_id", order.order_id)
      .maybeSingle();
    if (!conv) {
      const ins = await admin.from("whatsapp_conversations").insert({
        order_id: order.order_id,
        customer_phone: to,
        customer_name: order.customer_name,
        status: "pending",
      }).select().single();
      conv = ins.data;
    }

    // Build interactive message with buttons
    const payload = {
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
      order_id: order.order_id,
      direction: "out",
      message_type: "interactive",
      body: text,
      payload: payload,
      meta_message_id: metaMsgId,
      status: ok ? "sent" : "failed",
      error_message: ok ? null : JSON.stringify(respJson),
    });

    if (ok) {
      await admin.from("whatsapp_conversations").update({
        status: "awaiting_reply", last_message_at: new Date().toISOString(),
      }).eq("id", conv!.id);
      await admin.from("orders").update({
        whatsapp_status: "awaiting_reply",
        whatsapp_last_sent_at: new Date().toISOString(),
        whatsapp_retry_count: (order.whatsapp_retry_count ?? 0) + 1,
      }).eq("order_id", order.order_id);
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
