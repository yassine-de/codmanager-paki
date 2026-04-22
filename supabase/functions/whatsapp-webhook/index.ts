// Receives Meta WhatsApp webhook events.
// GET: verification handshake. POST: incoming messages / button replies / status updates.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function getSettings() {
  const { data } = await admin.from("whatsapp_settings").select("*").eq("singleton", true).maybeSingle();
  return data;
}

async function findOrCreateConversation(phone: string, orderId?: string | null) {
  // Try to match order by phone if orderId not known
  let order: any = null;
  if (orderId) {
    const { data } = await admin.from("orders").select("*").eq("order_id", orderId).maybeSingle();
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
  // Fallback: any recent order from this phone
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
  if (!order) return { conv: null, order: null };

  let { data: conv } = await admin
    .from("whatsapp_conversations")
    .select("*")
    .eq("order_id", order.order_id)
    .maybeSingle();
  if (!conv) {
    const { data: inserted } = await admin.from("whatsapp_conversations").insert({
      order_id: order.order_id,
      customer_phone: phone,
      customer_name: order.customer_name,
      status: "awaiting_reply",
    }).select().single();
    conv = inserted;
  }
  return { conv, order };
}

async function applyOutcome(order: any, outcome: "confirmed" | "more_info" | "canceled", note?: string) {
  const settings = await getSettings();
  const updates: Record<string, any> = {
    whatsapp_status: outcome,
    whatsapp_last_reply_at: new Date().toISOString(),
    confirmation_channel: outcome === "confirmed" ? "whatsapp" : "agent",
  };

  if (outcome === "confirmed") {
    updates.confirmation_status = "confirmed";
    updates.confirmed_at = new Date().toISOString();
    if (settings?.auto_book_shipping) {
      updates.delivery_status = "booked";
      updates.shipping_status = "Booked";
    }
  } else if (outcome === "more_info") {
    updates.confirmation_status = "new"; // back to agent queue
    updates.agent_id = null;
  } else if (outcome === "canceled") {
    updates.confirmation_status = "new"; // agent will handle cancellation
    updates.agent_id = null;
    updates.whatsapp_note = note ?? "Canceled in WhatsApp";
    updates.note = `${order.note ? order.note + "\n" : ""}Canceled in WhatsApp`;
  }

  await admin.from("orders").update(updates).eq("order_id", order.order_id);
}

async function handleIncoming(value: any) {
  const messages: any[] = value?.messages ?? [];
  for (const m of messages) {
    const from: string = m.from; // already E.164 without +
    const phone = `+${from}`;
    let orderId: string | null = null;
    let outcome: "confirmed" | "more_info" | "canceled" | null = null;
    let bodyText = "";
    let messageType = m.type ?? "text";
    let updatedAddress: string | null = null;
    let updatedCity: string | null = null;

    if (m.type === "interactive" && m.interactive?.type === "button_reply") {
      const id: string = m.interactive.button_reply.id ?? "";
      bodyText = m.interactive.button_reply.title ?? "";
      messageType = "button_reply";
      const match = id.match(/^wts_(confirm|more|cancel)_(.+)$/);
      if (match) {
        orderId = match[2];
        outcome = match[1] === "confirm" ? "confirmed" : match[1] === "more" ? "more_info" : "canceled";
      }
    } else if (m.type === "text") {
      bodyText = m.text?.body ?? "";
    }

    const { conv, order } = await findOrCreateConversation(phone, orderId);
    if (!conv) continue;

    await admin.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      order_id: order?.order_id ?? null,
      direction: "in",
      message_type: messageType,
      body: bodyText,
      payload: m,
      meta_message_id: m.id ?? null,
      status: "received",
    });
    await admin.from("whatsapp_conversations")
      .update({ last_reply_at: new Date().toISOString(), status: outcome ?? "awaiting_reply" })
      .eq("id", conv.id);

    if (order && outcome) {
      // Optional updates from text body — we never overwrite with empties
      if (updatedCity) await admin.from("orders").update({ customer_city: updatedCity }).eq("order_id", order.order_id);
      if (updatedAddress) await admin.from("orders").update({ customer_address: updatedAddress }).eq("order_id", order.order_id);
      await applyOutcome(order, outcome);
    }
  }

  // Status updates (sent/delivered/read/failed)
  const statuses: any[] = value?.statuses ?? [];
  for (const s of statuses) {
    if (!s.id) continue;
    await admin.from("whatsapp_messages").update({ status: s.status }).eq("meta_message_id", s.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Verification handshake
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const settings = await getSettings();
    if (mode === "subscribe" && verifyToken && settings?.webhook_secret && verifyToken === settings.webhook_secret) {
      return new Response(challenge ?? "ok", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  try {
    const settings = await getSettings();
    if (!settings?.receiving_enabled) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("webhook error", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
