// Receives Meta WhatsApp webhook events.
// GET: verification handshake.
// POST: incoming messages / button replies / status updates.
// Foundation of the WhatsApp automation system: stores messages, links them to
// conversations and orders, and triggers CRM logic for button actions.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const log = (...args: unknown[]) => console.log("[wa-webhook]", ...args);
const errLog = (...args: unknown[]) => console.error("[wa-webhook]", ...args);

async function getSettings() {
  const { data } = await admin
    .from("whatsapp_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  return data;
}

// Try to find an order linked to this phone number.
// Priority:
//  1. explicit orderId from button payload
//  2. latest order with confirmation_status = 'new_wts'
//  3. any recent order from this phone (with leading-zero variant)
async function findOrCreateConversation(phone: string, orderId?: string | null) {
  let order: any = null;

  if (orderId) {
    const { data } = await admin
      .from("orders")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();
    order = data;
  }

  if (!order) {
    const { data } = await admin
      .from("orders")
      .select("*")
      .eq("customer_phone", phone)
      .eq("confirmation_status", "new_wts")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    order = data;
  }

  if (!order) {
    const { data } = await admin
      .from("orders")
      .select("*")
      .or(`customer_phone.eq.${phone},customer_phone.eq.0${phone.slice(2)}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    order = data;
  }

  // Conversation lookup: prefer order link, fallback to phone.
  let conv: any = null;
  if (order) {
    const { data } = await admin
      .from("whatsapp_conversations")
      .select("*")
      .eq("order_id", order.order_id)
      .maybeSingle();
    conv = data;
  }
  if (!conv) {
    const { data } = await admin
      .from("whatsapp_conversations")
      .select("*")
      .eq("customer_phone", phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    conv = data;
  }

  if (!conv) {
    // Create new conversation. order_id may be null when we can't safely match.
    const { data: inserted, error } = await admin
      .from("whatsapp_conversations")
      .insert({
        order_id: order?.order_id ?? null,
        customer_phone: phone,
        customer_name: order?.customer_name ?? null,
        status: "pending",
      })
      .select()
      .single();
    if (error) {
      errLog("conversation insert failed", error);
      return { conv: null, order };
    }
    conv = inserted;
  } else if (order && !conv.order_id) {
    // Backfill order link if we just discovered it
    await admin
      .from("whatsapp_conversations")
      .update({ order_id: order.order_id, customer_name: order.customer_name })
      .eq("id", conv.id);
    conv.order_id = order.order_id;
  }

  return { conv, order };
}

// Apply CRM updates for a button action. Mirrors whatsapp-action logic so
// behavior stays consistent between manual Inbox actions and automated webhook.
async function applyOutcome(
  order: any,
  outcome: "confirmed" | "more_info" | "canceled"
) {
  const settings = await getSettings();
  const updates: Record<string, any> = {
    whatsapp_status: outcome,
    whatsapp_last_reply_at: new Date().toISOString(),
  };

  if (outcome === "confirmed") {
    updates.confirmation_status = "confirmed";
    updates.confirmation_channel = "whatsapp";
    updates.confirmed_at = new Date().toISOString();
    if (settings?.auto_book_shipping) {
      updates.delivery_status = "booked";
      updates.shipping_status = "Booked";
    }
  } else if (outcome === "more_info") {
    updates.confirmation_status = "new";
    updates.confirmation_channel = "agent";
    updates.agent_id = null;
  } else if (outcome === "canceled") {
    updates.confirmation_status = "new";
    updates.confirmation_channel = "agent";
    updates.agent_id = null;
    updates.whatsapp_note = "Canceled in WhatsApp";
    updates.note = `${order.note ? order.note + "\n" : ""}Canceled in WhatsApp`;
  }

  const { error } = await admin
    .from("orders")
    .update(updates)
    .eq("order_id", order.order_id);
  if (error) errLog("order update failed", order.order_id, error);
  else log("order updated", order.order_id, "→", outcome);
}

async function handleIncoming(value: any) {
  const messages: any[] = value?.messages ?? [];
  for (const m of messages) {
    try {
      const from: string = m.from; // E.164 without +
      const phone = `+${from}`;
      const metaMessageId: string | null = m.id ?? null;

      // Duplicate protection — skip if we already saved this Meta message id.
      if (metaMessageId) {
        const { data: existing } = await admin
          .from("whatsapp_messages")
          .select("id")
          .eq("meta_message_id", metaMessageId)
          .maybeSingle();
        if (existing) {
          log("duplicate ignored", metaMessageId);
          continue;
        }
      }

      let parsedOrderId: string | null = null;
      let outcome: "confirmed" | "more_info" | "canceled" | null = null;
      let bodyText = "";
      let messageType: string = m.type ?? "text";

      if (m.type === "interactive" && m.interactive?.type === "button_reply") {
        const id: string = m.interactive.button_reply.id ?? "";
        bodyText = m.interactive.button_reply.title ?? "";
        messageType = "button_reply";

        // Format A: prefixed buttons → wts_confirm_<orderId>
        const prefixed = id.match(/^wts_(confirm|more|cancel)_(.+)$/);
        if (prefixed) {
          parsedOrderId = prefixed[2];
          outcome =
            prefixed[1] === "confirm"
              ? "confirmed"
              : prefixed[1] === "more"
              ? "more_info"
              : "canceled";
        } else {
          // Format B: spec payloads (confirm_order / cancel_order / more_info)
          if (id === "confirm_order") outcome = "confirmed";
          else if (id === "cancel_order") outcome = "canceled";
          else if (id === "more_info") outcome = "more_info";
        }
      } else if (m.type === "button" && m.button) {
        bodyText = m.button.text ?? "";
        messageType = "button_reply";
        const payload = m.button.payload ?? "";
        if (payload === "confirm_order") outcome = "confirmed";
        else if (payload === "cancel_order") outcome = "canceled";
        else if (payload === "more_info") outcome = "more_info";
      } else if (m.type === "text") {
        bodyText = m.text?.body ?? "";
      } else {
        bodyText = JSON.stringify(m).slice(0, 500);
      }

      const { conv, order } = await findOrCreateConversation(phone, parsedOrderId);
      if (!conv) {
        errLog("no conversation for", phone);
        continue;
      }

      log("message", { phone, type: messageType, orderMatched: !!order, outcome });

      // Insert the message — never fails the request loop.
      const { error: msgErr } = await admin.from("whatsapp_messages").insert({
        conversation_id: conv.id,
        order_id: order?.order_id ?? null,
        direction: "in",
        message_type: messageType,
        body: bodyText,
        payload: m,
        meta_message_id: metaMessageId,
        status: "received",
      });
      if (msgErr) errLog("message insert failed", msgErr);

      // Decide conversation status:
      //  - button reply → outcome (confirmed / more_info / canceled)
      //  - free text   → manual_review_needed
      //  - first reply → awaiting_processing
      let nextStatus: string;
      if (outcome) {
        nextStatus = outcome;
      } else if (m.type === "text") {
        nextStatus = "manual_review_needed";
      } else {
        nextStatus = conv.status === "pending" ? "awaiting_processing" : conv.status;
      }

      const nowIso = new Date().toISOString();
      await admin
        .from("whatsapp_conversations")
        .update({
          last_reply_at: nowIso,
          last_message_at: nowIso,
          updated_at: nowIso,
          status: nextStatus,
        })
        .eq("id", conv.id);

      // Trigger CRM update for button actions only — never auto-confirm text.
      if (order && outcome) {
        await applyOutcome(order, outcome);
      } else if (!order && outcome) {
        log("button outcome but no matched order", phone, outcome);
      }
    } catch (e) {
      errLog("message handling error", (e as Error).message);
      // continue with next message
    }
  }

  // Status updates (sent/delivered/read/failed) for outbound messages.
  const statuses: any[] = value?.statuses ?? [];
  for (const s of statuses) {
    if (!s.id) continue;
    const { error } = await admin
      .from("whatsapp_messages")
      .update({ status: s.status })
      .eq("meta_message_id", s.id);
    if (error) errLog("status update failed", s.id, error);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Verification handshake (Meta calls this when you set up the webhook).
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const settings = await getSettings();
    if (
      mode === "subscribe" &&
      verifyToken &&
      settings?.webhook_secret &&
      verifyToken === settings.webhook_secret
    ) {
      log("verification ok");
      return new Response(challenge ?? "ok", { status: 200 });
    }
    errLog("verification failed");
    return new Response("forbidden", { status: 403 });
  }

  // POST: always return 200 to Meta even on internal failures, so they don't
  // disable the webhook. Errors are logged for internal triage.
  try {
    log("webhook received");
    const settings = await getSettings();
    if (!settings?.receiving_enabled) {
      log("receiving disabled — ignored");
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const entries: any[] = body?.entry ?? [];
    for (const entry of entries) {
      const changes: any[] = entry?.changes ?? [];
      for (const ch of changes) {
        if (ch.field === "messages") {
          await handleIncoming(ch.value);
        }
      }
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    errLog("fatal webhook error", (e as Error).message);
    // Still return 200 so Meta doesn't retry/disable us.
    return new Response(JSON.stringify({ ok: true, logged: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
