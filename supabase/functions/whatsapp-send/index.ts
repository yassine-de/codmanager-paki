// @ts-nocheck
// Sends a WhatsApp message via Meta Cloud API.
// Supports 3 modes:
//  - template: send approved template by template_id (always allowed; bypasses 24h)
//  - text:     send free-form text (only valid inside 24h customer service window)
//  - order:    send order-confirmation interactive buttons (default legacy behavior)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

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

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
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

      // If no conversation yet for this order, look for a prior conversation from
      // this phone — but ONLY reuse it if its linked order is for the SAME product.
      // Different product on the same phone → start a fresh thread so the AI
      // doesn't mix products in the same conversation.
      if (!conv && order.customer_phone) {
        const digits = order.customer_phone.replace(/\D/g, "");
        const withPlus = digits ? `+${digits}` : "";
        const localZero = digits.startsWith("92") ? `0${digits.slice(2)}` : digits;
        const variants = Array.from(
          new Set([order.customer_phone, digits, withPlus, localZero].filter(Boolean)),
        );
        const { data: candidates } = await admin
          .from("whatsapp_conversations")
          .select("*")
          .in("customer_phone", variants)
          .order("created_at", { ascending: false })
          .limit(10);

        const list = candidates ?? [];
        for (const cand of list) {
          if (!cand.order_id) {
            // Unlinked thread — safe to claim for this order.
            await admin
              .from("whatsapp_conversations")
              .update({
                order_id: order.order_id,
                customer_name: order.customer_name ?? cand.customer_name,
                updated_at: new Date().toISOString(),
              })
              .eq("id", cand.id);
            conv = { ...cand, order_id: order.order_id };
            break;
          }
          const { data: prevOrder } = await admin
            .from("orders")
            .select("product_name")
            .eq("order_id", cand.order_id)
            .maybeSingle();
          if (prevOrder?.product_name && order.product_name &&
              prevOrder.product_name.trim().toLowerCase() === order.product_name.trim().toLowerCase()) {
            await admin
              .from("whatsapp_conversations")
              .update({
                order_id: order.order_id,
                customer_name: order.customer_name ?? cand.customer_name,
                updated_at: new Date().toISOString(),
              })
              .eq("id", cand.id);
            conv = { ...cand, order_id: order.order_id };
            break;
          }
        }
        // If no same-product match was found, conv stays null → a fresh
        // conversation will be created below.
      }
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
    let sentTemplateId: string | null = null;
    let sentTemplateName: string | null = null;

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
      const mediaObj: any = {};

      // For audio (voice notes) we MUST upload the binary to Meta first and reference it
      // by media `id`. When using a public `link`, Meta sniffs the file's magic bytes and
      // rejects WebM/OGG voice files as application/octet-stream.
      // For images/documents the `link` flow is fine.
      if (mode === "audio") {
        // Force the proper voice-note MIME so Meta accepts it.
        const audioMime = "audio/ogg";
        const fileResp = await fetch(body.media_url);
        if (!fileResp.ok) throw new Error(`Failed to fetch media: ${fileResp.status}`);
        const audioBlob = await fileResp.blob();
        // Re-wrap with the correct MIME (the storage bucket may serve octet-stream).
        const fixedBlob = new Blob([await audioBlob.arrayBuffer()], { type: audioMime });

        const fd = new FormData();
        fd.append("messaging_product", "whatsapp");
        fd.append("type", audioMime);
        fd.append("file", fixedBlob, body.media_filename || "voice.ogg");

        const uploadUrl = `${settings.api_base_url}/${settings.phone_number_id}/media`;
        const upResp = await fetch(uploadUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: fd,
        });
        const upJson = await upResp.json();
        if (!upResp.ok || !upJson?.id) {
          throw new Error(`Meta media upload failed: ${JSON.stringify(upJson)}`);
        }
        mediaObj.id = upJson.id;
        mediaObj.voice = true;
      } else {
        mediaObj.link = body.media_url;
        if (mode === "image" && bodyText) mediaObj.caption = bodyText;
        if (mode === "document") {
          if (bodyText) mediaObj.caption = bodyText;
          if (body.media_filename) mediaObj.filename = body.media_filename;
        }
      }

      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: mode,
        [mode]: mediaObj,
      };
      if (!bodyText) bodyText = body.media_filename || `[${mode}]`;
    } else if (mode === "template") {
      // Send approved Meta template (carries its own buttons; works outside 24h window).
      if (!body.template_id) throw new Error("template_id required for template mode");
      const { data: tpl } = await admin
        .from("whatsapp_templates")
        .select("*")
        .eq("id", body.template_id)
        .maybeSingle();
      if (!tpl) throw new Error("Template not found");

      const templateName = tpl.meta_template_name || tpl.name;
      const language = tpl.language || "en_US";
      sentTemplateId = String(tpl.id);
      sentTemplateName = String(templateName);
      const vars: Record<string, any> = order
        ? {
            customer_name: order.customer_name,
            product_name: order.product_name,
            price: order.total_amount,
            city: order.customer_city,
            address: order.customer_address,
            order_id: order.order_id,
          }
        : {};

      const components: any[] = [];

      if (tpl.header_type && tpl.header_media_url) {
        const t = String(tpl.header_type).toLowerCase();
        if (t === "image" || t === "video" || t === "document") {
          components.push({
            type: "header",
            parameters: [{ type: t, [t]: { link: tpl.header_media_url } }],
          });
        }
      }

      const tplBody = String(tpl.body || "");
      const placeholders: string[] = [];
      const re = /\{\{\s*([\w]+)\s*\}\}/g;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(tplBody)) !== null) placeholders.push(mm[1]);
      if (placeholders.length > 0) {
        components.push({
          type: "body",
          parameters: placeholders.map((name) => ({
            type: "text",
            text: String(vars[name] ?? ""),
          })),
        });
      }

      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          ...(components.length ? { components } : {}),
        },
      };
      bodyText = render(tplBody, vars);
    } else {
      // order: legacy interactive confirmation buttons (free-form, requires 24h window)
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
      payload: sentTemplateId
        ? { ...payload, _template_id: sentTemplateId, _template_name: sentTemplateName }
        : payload,
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
