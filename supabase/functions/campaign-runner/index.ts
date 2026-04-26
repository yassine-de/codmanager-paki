// @ts-nocheck
// Campaign runner: builds the recipient list from filters, then sends WhatsApp
// approved-template messages with throttling. Triggered by:
//   - manual "send now" button in the UI       → action: "start"
//   - scheduled cron job                        → action: "process_scheduled"
//   - cancellation                              → action: "cancel"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function normalizePhone(phone: string, defaultCC: string) {
  let p = (phone || "").replace(/\D/g, "");
  if (!p) return "";
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = defaultCC + p.slice(1);
  return p;
}

function render(template: string, vars: Record<string, any>) {
  const positional = [vars.customer_name, vars.product_name, vars.order_id, vars.price, vars.city];
  const synonyms: Record<string, any> = {
    name: vars.customer_name, customer: vars.customer_name,
    product: vars.product_name, order: vars.order_id,
    total: vars.price, amount: vars.price, address: vars.city,
  };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    const direct = vars[k];
    if (direct != null && String(direct).trim() !== "") return String(direct);
    const syn = synonyms[String(k).toLowerCase()];
    if (syn != null && String(syn).trim() !== "") return String(syn);
    const num = String(k).toLowerCase().match(/^(?:var|param|p|v)?_?(\d+)$/);
    if (num) {
      const v = positional[parseInt(num[1], 10) - 1];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return "";
  });
}

// ---------------------------------------------------------------------------
// Build the recipient list from the campaign's filters by querying orders.
// One recipient per unique phone (latest order wins).
// ---------------------------------------------------------------------------
async function buildRecipients(campaign: any) {
  const f = campaign.filters || {};
  let q = admin
    .from("orders")
    .select(
      "order_id, customer_phone, customer_name, customer_city, product_name, total_amount, seller_id, confirmation_status, delivery_status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(5000);

  if (Array.isArray(f.seller_ids) && f.seller_ids.length)
    q = q.in("seller_id", f.seller_ids);
  if (Array.isArray(f.cities) && f.cities.length)
    q = q.in("customer_city", f.cities);
  if (Array.isArray(f.confirmation_status) && f.confirmation_status.length)
    q = q.in("confirmation_status", f.confirmation_status);
  if (Array.isArray(f.delivery_status) && f.delivery_status.length)
    q = q.in("delivery_status", f.delivery_status);
  if (Array.isArray(f.product_names) && f.product_names.length)
    q = q.in("product_name", f.product_names);
  if (f.date_from) q = q.gte("created_at", f.date_from);
  if (f.date_to) q = q.lte("created_at", f.date_to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const totalOrders = (data ?? []).length;
  let invalidPhones = 0;

  // Dedup by (phone + product). Customer with multiple distinct products gets
  // one message per product. Repeat orders of the same product are merged.
  const seen = new Set<string>();
  const recipients: any[] = [];
  for (const o of data ?? []) {
    const phone = (o.customer_phone || "").trim();
    if (!phone) {
      invalidPhones++;
      continue;
    }
    const product = (o.product_name || "").trim().toLowerCase();
    const key = `${phone}|${product}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({
      campaign_id: campaign.id,
      order_id: o.order_id,
      customer_phone: phone,
      customer_name: o.customer_name,
      variables: {
        customer_name: o.customer_name,
        order_id: o.order_id,
        product_name: o.product_name,
        price: o.total_amount,
        city: o.customer_city,
      },
      status: "pending",
    });
  }
  return { recipients, totalOrders, invalidPhones, duplicates: totalOrders - recipients.length - invalidPhones };
}


// ---------------------------------------------------------------------------
// Send a single template message via Meta Cloud API.
// ---------------------------------------------------------------------------
async function sendTemplateForRecipient(
  recipient: any,
  template: any,
  settings: any,
  accessToken: string,
) {
  const to = normalizePhone(recipient.customer_phone, settings.default_country_code);
  if (!to) return { ok: false, error: "Invalid phone" };

  const templateName = template.meta_template_name || template.name;
  const language = template.language || "en_US";
  const components: any[] = [];

  if (template.header_type && template.header_media_url) {
    const t = String(template.header_type).toLowerCase();
    if (t === "image" || t === "video" || t === "document") {
      components.push({
        type: "header",
        parameters: [{ type: t, [t]: { link: template.header_media_url } }],
      });
    }
  }

  const tplBody = String(template.body || "");
  const placeholders: string[] = [];
  const re = /\{\{\s*([\w]+)\s*\}\}/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(tplBody)) !== null) placeholders.push(mm[1]);

  // Resolve a placeholder name to an actual value from recipient variables.
  // Supports:
  //  - Direct keys: customer_name, product_name, order_id, price, city
  //  - Common synonyms: name, product, order, total, address
  //  - Positional: {{1}}, {{2}}, {{var_1}}, {{var_2}} → ordered fallbacks
  const vars = recipient.variables ?? {};
  const positional = [
    vars.customer_name,
    vars.product_name,
    vars.order_id,
    vars.price,
    vars.city,
  ];
  const synonyms: Record<string, any> = {
    name: vars.customer_name,
    customer: vars.customer_name,
    customer_name: vars.customer_name,
    product: vars.product_name,
    product_name: vars.product_name,
    order: vars.order_id,
    order_id: vars.order_id,
    price: vars.price,
    total: vars.price,
    amount: vars.price,
    city: vars.city,
    address: vars.city,
  };
  const resolveVar = (name: string): string => {
    // Direct match in variables
    if (vars[name] !== undefined && vars[name] !== null && String(vars[name]).trim() !== "") {
      return String(vars[name]);
    }
    // Synonym match
    const key = name.toLowerCase();
    if (synonyms[key] !== undefined && synonyms[key] !== null && String(synonyms[key]).trim() !== "") {
      return String(synonyms[key]);
    }
    // Positional: {{1}}, {{2}}, {{var_1}}, {{var2}}, {{param_1}}
    const numMatch = key.match(/^(?:var|param|p|v)?_?(\d+)$/);
    if (numMatch) {
      const idx = parseInt(numMatch[1], 10) - 1;
      if (idx >= 0 && idx < positional.length) {
        const val = positional[idx];
        if (val !== undefined && val !== null && String(val).trim() !== "") return String(val);
      }
    }
    // Last-resort fallback so Meta never rejects with empty parameter
    return "—";
  };

  if (placeholders.length > 0) {
    components.push({
      type: "body",
      parameters: placeholders.map((name) => ({
        type: "text",
        text: resolveVar(name),
      })),
    });
  }

  const payload = {
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

  const url = `${settings.api_base_url}/${settings.phone_number_id}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const respJson = await resp.json().catch(() => ({}));
  const ok = resp.ok;
  const metaMsgId = ok ? respJson?.messages?.[0]?.id : null;

  // Conversation: reuse if exists for this phone, else create.
  let conversationId: string | null = null;
  const { data: existing } = await admin
    .from("whatsapp_conversations")
    .select("id, status")
    .eq("customer_phone", to)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    conversationId = existing.id;
    await admin
      .from("whatsapp_conversations")
      .update({
        status: existing.status === "pending" ? "awaiting_reply" : existing.status,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(recipient.order_id ? { order_id: recipient.order_id } : {}),
      })
      .eq("id", existing.id);
  } else {
    const ins = await admin
      .from("whatsapp_conversations")
      .insert({
        customer_phone: to,
        customer_name: recipient.customer_name ?? null,
        order_id: recipient.order_id ?? null,
        status: ok ? "awaiting_reply" : "pending",
      })
      .select("id")
      .single();
    conversationId = ins.data?.id ?? null;
  }

  // Log the message.
  let messageRowId: string | null = null;
  if (conversationId) {
    const { data: msgRow } = await admin
      .from("whatsapp_messages")
      .insert({
        conversation_id: conversationId,
        order_id: recipient.order_id ?? null,
        direction: "out",
        message_type: "template",
        body: render(tplBody, recipient.variables ?? {}),
        payload: { ...payload, _campaign_id: recipient.campaign_id },
        meta_message_id: metaMsgId,
        status: ok ? "sent" : "failed",
        error_message: ok ? null : JSON.stringify(respJson),
      })
      .select("id")
      .single();
    messageRowId = msgRow?.id ?? null;
  }

  return { ok, metaMsgId, messageRowId, conversationId, error: ok ? null : JSON.stringify(respJson) };
}

// ---------------------------------------------------------------------------
// Process one batch of pending recipients for a campaign (throttled).
// ---------------------------------------------------------------------------
async function processCampaign(campaignId: string) {
  const { data: campaign } = await admin
    .from("whatsapp_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return;
  if (!["sending"].includes(campaign.status)) return;

  const { data: template } = await admin
    .from("whatsapp_templates")
    .select("*")
    .eq("id", campaign.template_id)
    .maybeSingle();
  if (!template) {
    await admin.from("whatsapp_campaigns")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", campaignId);
    return;
  }

  const { data: settings } = await admin
    .from("whatsapp_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (!settings || !settings.integration_enabled || !settings.sending_enabled) {
    await admin.from("whatsapp_campaigns")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", campaignId);
    return;
  }
  const accessToken = settings.access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
  if (!accessToken) {
    await admin.from("whatsapp_campaigns")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", campaignId);
    return;
  }

  const throttle = Math.max(1, Math.min(120, campaign.throttle_per_minute || 30));
  const delayMs = Math.floor(60000 / throttle);

  // Pull a small batch (max 60 per invocation).
  const { data: pending } = await admin
    .from("whatsapp_campaign_recipients")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .limit(60);

  if (!pending || pending.length === 0) {
    // Nothing left → mark completed.
    await admin.from("whatsapp_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaignId);
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const r of pending) {
    const result = await sendTemplateForRecipient(r, template, settings, accessToken);
    if (result.ok) {
      sent++;
      await admin.from("whatsapp_campaign_recipients").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        meta_message_id: result.metaMsgId,
        message_id: result.messageRowId,
        conversation_id: result.conversationId,
      }).eq("id", r.id);
    } else {
      failed++;
      await admin.from("whatsapp_campaign_recipients").update({
        status: "failed",
        failed_at: new Date().toISOString(),
        error_message: result.error,
        conversation_id: result.conversationId,
      }).eq("id", r.id);
    }
    // Throttle.
    if (delayMs > 50) await new Promise((res) => setTimeout(res, delayMs));
  }

  // Update counters.
  const { count: totalDone } = await admin
    .from("whatsapp_campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .neq("status", "pending");
  const { count: totalSent } = await admin
    .from("whatsapp_campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["sent", "delivered", "read", "replied"]);
  const { count: totalFailed } = await admin
    .from("whatsapp_campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "failed");

  await admin.from("whatsapp_campaigns").update({
    sent_count: totalSent ?? 0,
    failed_count: totalFailed ?? 0,
    updated_at: new Date().toISOString(),
  }).eq("id", campaignId);

  // If everything is processed → mark completed; otherwise, schedule next batch.
  if ((totalDone ?? 0) >= (campaign.total_recipients ?? 0)) {
    await admin.from("whatsapp_campaigns").update({
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", campaignId);
  } else {
    // Self-invoke for next batch (best-effort, fire and forget).
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/campaign-runner`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ action: "process", campaign_id: campaignId, _internal: true }),
    }).catch(() => {});
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "start";
    const isInternal = body._internal === true;

    // Auth: internal self-calls and cron use service role key in Authorization
    // header; UI calls go through user JWT and we check admin.
    const authHeader = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const isService = authHeader === `Bearer ${serviceKey}`;

    if (!isService) {
      // Decode JWT directly (avoids "session not found" 401 when refresh token
      // was rotated but the access token is still cryptographically valid).
      let userId: string | null = null;
      const m = authHeader.match(/^Bearer\s+(.+)$/i);
      if (m) {
        try {
          const parts = m[1].split(".");
          if (parts.length >= 2) {
            const payload = JSON.parse(
              atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
            );
            if (payload?.sub && (!payload.exp || payload.exp * 1000 > Date.now())) {
              userId = String(payload.sub);
            }
          }
        } catch (_) { /* fallthrough */ }
      }
      if (!userId) {
        return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: userId });
      if (!isAdmin) {
        return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (action === "process_scheduled") {
      // Cron entry point: pick up scheduled campaigns whose time has come.
      const { data: due } = await admin
        .from("whatsapp_campaigns")
        .select("id")
        .eq("status", "scheduled")
        .lte("scheduled_at", new Date().toISOString())
        .limit(20);
      const ids = (due ?? []).map((d) => d.id);
      for (const id of ids) {
        // Mark as sending and (re)build recipients if empty.
        const { data: c } = await admin.from("whatsapp_campaigns").select("*").eq("id", id).maybeSingle();
        if (!c) continue;
        const { count: recipCount } = await admin
          .from("whatsapp_campaign_recipients")
          .select("*", { count: "exact", head: true })
          .eq("campaign_id", id);
        if ((recipCount ?? 0) === 0) {
          const { recipients } = await buildRecipients(c);
          if (recipients.length) {
            // Insert in chunks to avoid PG row limit.
            const chunkSize = 500;
            for (let i = 0; i < recipients.length; i += chunkSize) {
              await admin.from("whatsapp_campaign_recipients").insert(recipients.slice(i, i + chunkSize));
            }
          }
          await admin.from("whatsapp_campaigns").update({
            total_recipients: recipients.length,
            status: "sending",
            started_at: new Date().toISOString(),
          }).eq("id", id);
        } else {
          await admin.from("whatsapp_campaigns").update({
            status: "sending",
            started_at: new Date().toISOString(),
          }).eq("id", id);
        }
        // Kick off processing (await first batch).
        await processCampaign(id);
      }
      return new Response(JSON.stringify({ ok: true, processed: ids.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "preview") {
      // Just count recipients without persisting.
      const { campaign } = body;
      if (!campaign) throw new Error("campaign required");
      const { recipients, totalOrders, invalidPhones, duplicates } = await buildRecipients({ ...campaign, id: "preview" });
      return new Response(
        JSON.stringify({
          ok: true,
          count: recipients.length,
          total_orders: totalOrders,
          invalid_phones: invalidPhones,
          duplicates,
          sample: recipients.slice(0, 5),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "start") {
      const campaignId = body.campaign_id;
      if (!campaignId) throw new Error("campaign_id required");
      const { data: c } = await admin.from("whatsapp_campaigns").select("*").eq("id", campaignId).maybeSingle();
      if (!c) throw new Error("Campaign not found");

      // Build recipients.
      const { recipients } = await buildRecipients(c);
      if (recipients.length === 0) {
        await admin.from("whatsapp_campaigns").update({
          status: "failed",
          completed_at: new Date().toISOString(),
        }).eq("id", campaignId);
        return new Response(JSON.stringify({ ok: false, error: "No recipients matched the filters" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Wipe any existing recipients (in case this is a restart).
      await admin.from("whatsapp_campaign_recipients").delete().eq("campaign_id", campaignId);
      const chunkSize = 500;
      for (let i = 0; i < recipients.length; i += chunkSize) {
        await admin.from("whatsapp_campaign_recipients").insert(recipients.slice(i, i + chunkSize));
      }

      await admin.from("whatsapp_campaigns").update({
        total_recipients: recipients.length,
        status: "sending",
        started_at: new Date().toISOString(),
      }).eq("id", campaignId);

      // Process first batch synchronously, the rest will self-chain.
      await processCampaign(campaignId);

      return new Response(JSON.stringify({ ok: true, total: recipients.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "process") {
      // Internal continuation.
      const campaignId = body.campaign_id;
      if (!campaignId) throw new Error("campaign_id required");
      await processCampaign(campaignId);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cancel") {
      const campaignId = body.campaign_id;
      if (!campaignId) throw new Error("campaign_id required");
      await admin.from("whatsapp_campaigns").update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
      }).eq("id", campaignId);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[campaign-runner]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
