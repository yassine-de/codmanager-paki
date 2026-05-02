// @ts-nocheck
// Receives Meta WhatsApp webhook events.
// GET: verification handshake.
// POST: incoming messages / button replies / status updates.
// Foundation of the WhatsApp automation system: stores messages, links them to
// conversations and orders, and triggers CRM logic for button actions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

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

/**
 * Download a WhatsApp audio note from Meta and transcribe it with OpenAI Whisper.
 * Returns the transcribed text, or null on any failure (caller falls back to
 * the legacy "[audio]" placeholder so the AI can still reply gracefully).
 */
async function transcribeWhatsappAudio(audio: any): Promise<string | null> {
  try {
    const mediaId: string | undefined = audio?.id;
    const directUrl: string | undefined = audio?.link || audio?.url;
    const mimeType: string = audio?.mime_type || "audio/ogg";
    if (!mediaId && !directUrl) return null;

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      log("transcribe: OPENAI_API_KEY missing");
      return null;
    }

    const settings = await getSettings();
    const accessToken =
      settings?.access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
    if (!accessToken) {
      log("transcribe: WhatsApp access token missing");
      return null;
    }

    // 1) Resolve Meta's one-shot signed URL.
    let downloadUrl = directUrl;
    if (mediaId) {
      const base = (settings?.api_base_url || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
      const metaResp = await fetch(`${base}/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const metaJson = await metaResp.json().catch(() => ({}));
      if (!metaResp.ok || !metaJson?.url) {
        log("transcribe: meta resolve failed", metaResp.status, metaJson?.error);
        return null;
      }
      downloadUrl = metaJson.url;
    }

    // 2) Download the audio bytes.
    const mediaResp = await fetch(downloadUrl!, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!mediaResp.ok) {
      log("transcribe: media download failed", mediaResp.status);
      return null;
    }
    const audioBuffer = await mediaResp.arrayBuffer();

    // 3) Send to OpenAI Whisper. WhatsApp's .ogg/opus is natively supported.
    const ext = mimeType.includes("mp4") ? "m4a"
      : mimeType.includes("mpeg") ? "mp3"
      : mimeType.includes("wav") ? "wav"
      : mimeType.includes("webm") ? "webm"
      : "ogg";
    const form = new FormData();
    form.append("file", new Blob([audioBuffer], { type: mimeType }), `voice.${ext}`);
    form.append("model", "whisper-1");
    // No language hint — Whisper auto-detects (Urdu, English, Arabic, French, …).

    const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!whisperResp.ok) {
      const errText = await whisperResp.text().catch(() => "");
      errLog("transcribe: whisper failed", whisperResp.status, errText.slice(0, 200));
      return null;
    }
    const whisperJson = await whisperResp.json().catch(() => ({}));
    const text = (whisperJson?.text || "").toString().trim();
    if (!text) return null;
    log("transcribe: ok", { chars: text.length });
    return text;
  } catch (e) {
    errLog("transcribe: exception", (e as Error).message);
    return null;
  }
}

/**
 * Fetch a WhatsApp media (image/document) and return it as a base64 data URL
 * usable directly in OpenAI multimodal `image_url` content parts.
 *
 * WhatsApp's lookaside.fbsbx.com URLs require a Bearer token, so the AI cannot
 * fetch them directly. We download server-side, then inline as data URL.
 */
async function fetchWhatsappMediaAsDataUrl(media: any): Promise<{ dataUrl: string; mimeType: string } | null> {
  try {
    const mediaId: string | undefined = media?.id;
    const directUrl: string | undefined = media?.link || media?.url;
    let mimeType: string = media?.mime_type || "image/jpeg";
    if (!mediaId && !directUrl) return null;

    const settings = await getSettings();
    const accessToken =
      (settings as any)?.access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
    if (!accessToken) {
      log("media-fetch: WhatsApp access token missing");
      return null;
    }

    let downloadUrl = directUrl;
    if (mediaId) {
      const base = ((settings as any)?.api_base_url || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
      const metaResp = await fetch(`${base}/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const metaJson = await metaResp.json().catch(() => ({}));
      if (!metaResp.ok || !metaJson?.url) {
        log("media-fetch: meta resolve failed", metaResp.status, metaJson?.error);
        return null;
      }
      downloadUrl = metaJson.url;
      if (metaJson.mime_type) mimeType = metaJson.mime_type;
    }

    const mediaResp = await fetch(downloadUrl!, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!mediaResp.ok) {
      log("media-fetch: download failed", mediaResp.status);
      return null;
    }
    const buf = await mediaResp.arrayBuffer();
    // Encode to base64 in chunks to avoid call-stack issues on large images
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
    }
    const base64 = btoa(binary);
    return { dataUrl: `data:${mimeType};base64,${base64}`, mimeType };
  } catch (e) {
    errLog("media-fetch: exception", (e as Error).message);
    return null;
  }
}
// Priority:
//  1. explicit orderId from button payload
//  2. latest order with confirmation_status = 'new_wts'
//  3. any recent order from this phone (with leading-zero variant)
async function findOrCreateConversation(phone: string, orderId?: string | null) {
  // Normalize phone variants so we match conversations created by outbound
  // (no `+` e.g. "923233320960") AND inbound (with `+` e.g. "+923233320960")
  // AND legacy local format (e.g. "03233320960").
  const digits = phone.replace(/\D/g, "");           // 923233320960
  const withPlus = `+${digits}`;                      // +923233320960
  const localZero = digits.startsWith("92") ? `0${digits.slice(2)}` : digits; // 03233320960
  const phoneVariants = Array.from(new Set([phone, digits, withPlus, localZero]));

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
      .in("customer_phone", phoneVariants)
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
      .in("customer_phone", phoneVariants)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    order = data;
  }

  // Conversation lookup: prefer the conversation already linked to this exact order.
  let conv: any = null;
  if (order) {
    const { data } = await admin
      .from("whatsapp_conversations")
      .select("*")
      .eq("order_id", order.order_id)
      .maybeSingle();
    conv = data;
  }

  // Otherwise look for a prior conversation from this phone — but ONLY reuse it
  // when its linked order is for the SAME product (or it's unlinked). Different
  // product on the same phone → keep threads separate so the AI / context don't
  // mix products across orders.
  if (!conv) {
    const { data: candidates } = await admin
      .from("whatsapp_conversations")
      .select("*")
      .in("customer_phone", phoneVariants)
      .order("created_at", { ascending: false })
      .limit(10);

    const list = candidates ?? [];
    for (const cand of list) {
      let reuse = false;
      if (!cand.order_id) {
        // Unlinked thread — always safe to reuse for the same phone, whether
        // or not we have a freshly resolved order. This prevents creating
        // duplicate conversations when the customer has no matching order yet.
        reuse = true;
      } else if (order?.product_name) {
        const { data: prevOrder } = await admin
          .from("orders")
          .select("product_name")
          .eq("order_id", cand.order_id)
          .maybeSingle();
        if (
          prevOrder?.product_name &&
          prevOrder.product_name.trim().toLowerCase() === order.product_name.trim().toLowerCase()
        ) {
          reuse = true;
        }
      } else if (!order) {
        // No order resolved at all — fall back to most recent thread for this phone.
        reuse = true;
      }
      if (reuse) {
        if (order && !cand.order_id) {
          await admin
            .from("whatsapp_conversations")
            .update({
              order_id: order.order_id,
              customer_name: order.customer_name ?? cand.customer_name,
              updated_at: new Date().toISOString(),
            })
            .eq("id", cand.id);
          conv = { ...cand, order_id: order.order_id };
        } else {
          conv = cand;
        }
        break;
      }
    }
  }

  if (!conv) {
    // Create new conversation. Store digits-only (matches outbound normalization).
    const { data: inserted, error } = await admin
      .from("whatsapp_conversations")
      .insert({
        order_id: order?.order_id ?? null,
        customer_phone: digits,
        customer_name: order?.customer_name ?? null,
        status: "pending",
      })
      .select()
      .single();
    if (error) {
      // Race condition: another webhook just inserted an unlinked conversation
      // for this phone (blocked by whatsapp_conversations_phone_unlinked_unique).
      // Fall back to fetching the existing one so we don't drop the message.
      const { data: existing } = await admin
        .from("whatsapp_conversations")
        .select("*")
        .in("customer_phone", phoneVariants)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        conv = existing;
      } else {
        errLog("conversation insert failed", error);
        return { conv: null, order };
      }
    } else {
      conv = inserted;
    }
  }

  return { conv, order };
}

async function resolveReplyTarget(replyToMetaMessageId?: string | null) {
  if (!replyToMetaMessageId) return { conv: null, order: null };

  const { data: repliedMsg } = await admin
    .from("whatsapp_messages")
    .select("conversation_id, order_id, direction")
    .eq("meta_message_id", replyToMetaMessageId)
    .eq("direction", "out")
    .maybeSingle();

  if (!repliedMsg) return { conv: null, order: null };

  const { data: conv } = repliedMsg.conversation_id
    ? await admin
        .from("whatsapp_conversations")
        .select("*")
        .eq("id", repliedMsg.conversation_id)
        .maybeSingle()
    : { data: null };

  const { data: order } = repliedMsg.order_id
    ? await admin
        .from("orders")
        .select("*")
        .eq("order_id", repliedMsg.order_id)
        .maybeSingle()
    : { data: null };

  return { conv, order };
}

// Look up which template (if any) the customer's reply was sent to.
// Returns the template_id stored on the outbound message payload.
async function resolveRepliedTemplate(replyToMetaMessageId?: string | null): Promise<string | null> {
  if (!replyToMetaMessageId) return null;
  const { data: msg } = await admin
    .from("whatsapp_messages")
    .select("payload, message_type, direction")
    .eq("meta_message_id", replyToMetaMessageId)
    .eq("direction", "out")
    .maybeSingle();
  if (!msg) return null;
  const payload: any = msg.payload ?? {};
  const tplId = payload?._template_id ?? null;
  return tplId ? String(tplId) : null;
}

// Module-level helper: validates a stored address looks like a real, detailed,
// courier-deliverable address. Used by applyOutcome (button confirm gating)
// AND aiContinueReply (whether to ask the customer for the address).
// Both city + address are required for a "deliverable" combo.
export function isAddressDeliverable(addr?: string | null, city?: string | null): boolean {
  if (!addr) return false;
  if (city !== undefined) {
    if (!city || String(city).trim().length === 0) return false;
  }
  const raw = String(addr).trim();
  if (raw.length < 12) return false;
  const lower = raw.toLowerCase();
  const fakePattern = /\b(test|testing|tester|fake|dummy|sample|example|n\/?a|none|null|xxx+|asdf+|qwerty|aaaa+|placeholder|abc+|address here|adress|same|here)\b/i;
  if (fakePattern.test(lower)) return false;
  const tokens = raw.split(/\s+/).filter((w) => w.length > 1);
  if (tokens.length < 3) return false;
  const hasNumber = /\d/.test(raw);
  // STRONG indicators: explicitly numbered/structured location markers. These
  // unambiguously point to a deliverable spot for a courier.
  const strongKeyword = /\b(house|flat|plot|shop\s*(?:no|number|#)?\s*\d|office\s*(?:no|number|#)?\s*\d|street\s*(?:no|number|#)?\s*\d|gali\s*(?:no|number|#)?\s*\d|block|sector|phase|apartment|building|floor|villa|tower|plaza)\b/i;
  // WEAK indicators: area/landmark words. Helpful but NOT enough on their own
  // (e.g. "National bank ghalegay" is just a vague POI — courier can't find it).
  const weakKeyword = /\b(shop|office|store|street|road|st\.?|rd\.?|lane|town|village|colony|mohalla|mahalla|gali|bazar|bazaar|market|society|park|stop|stand|gate|center|centre|care|hotel|masjid|mosque|school|college|university|hospital|clinic|bank|station|chowk|square|more|tehsil|tehseel|ward|union|abad|pura|nagar|kot|gunj|ganj|garh|wala|پور|آباد|گھر|مکان|گلی|سڑک|محلہ|فلیٹ|بلاک|سیکٹر|چوک|تحصیل|دکان)\b/gi;
  const landmarkIndicator = /\b(near|opposite|behind|front|side|adjacent|main|stop)\b/i;

  // Has a digit AND any structural/area context → deliverable.
  if (hasNumber && (strongKeyword.test(lower) || weakKeyword.test(lower) || landmarkIndicator.test(lower))) return true;
  // Has a digit and ≥ 4 tokens (e.g. "House 12 Gulshan Block 4") → deliverable.
  if (hasNumber && tokens.length >= 4) return true;
  // Strong structural keyword present → deliverable even without a number
  // (e.g. "Phase 2 DHA Lahore" — phase implies sector structure).
  if (strongKeyword.test(lower)) return true;
  // Weak keywords only: require AT LEAST TWO distinct weak signals OR a
  // landmark + weak keyword + 5+ tokens. A single vague POI like "National
  // bank ghalegay" (3 tokens, only "bank") is NOT enough — courier can't find
  // it without a street/house/sector. AB-803 fix.
  const weakHits = (lower.match(weakKeyword) || []).length;
  if (weakHits >= 2) return true;
  if (weakHits >= 1 && landmarkIndicator.test(lower) && tokens.length >= 5) return true;
  return false;
}

// Apply CRM updates for a button action. Mirrors whatsapp-action logic so
// behavior stays consistent between manual Inbox actions and automated webhook.
//
// ADDRESS-GATING (CRITICAL): when outcome === "confirmed" but the order does
// NOT have a deliverable address on file, we DO NOT confirm the order. We
// stash a "pending_button_intent" on the conversation, force AI takeover, and
// let the AI ask the customer for the full address. The AI flow's
// tryExtractAndConfirmAddress() will finalize the confirmation once a real
// address arrives.
async function applyOutcome(
  order: any,
  outcome: "confirmed" | "more_info" | "canceled",
  conversationId?: string | null,
  buttonText?: string,
) {
  const settings = await getSettings();
  const updates: Record<string, any> = {
    whatsapp_status: outcome,
    whatsapp_last_reply_at: new Date().toISOString(),
  };

  // ── Address-gated confirm path ────────────────────────────────────────────
  // Strategy:
  //   • If stored address is ALREADY deliverable → confirm IMMEDIATELY (no AI
  //     round-trip needed). Otherwise customer never sends a follow-up text
  //     and the order would be stuck in pending_address forever (e.g. AB-369).
  //   • If stored address is missing/weak → gate through the AI, ask the
  //     customer for their full address, finalize once they reply.
  if (outcome === "confirmed") {
    const addrLooksDeliverable = isAddressDeliverable(order.customer_address, order.customer_city);

    if (addrLooksDeliverable && order.confirmation_status !== "confirmed") {
      // Direct confirm — stored address is good enough, no need to ask again.
      const settings = await getSettings();
      const trackedFields = ["confirmation_status", "delivery_status", "shipping_status"];
      const before: Record<string, any> = {};
      for (const f of trackedFields) before[f] = order[f] ?? null;

      const confirmUpdate: Record<string, any> = {
        confirmation_status: "confirmed",
        confirmation_channel: "whatsapp",
        confirmed_at: new Date().toISOString(),
        whatsapp_status: "confirmed",
        whatsapp_last_reply_at: new Date().toISOString(),
        whatsapp_note: `Customer clicked "${buttonText || "YES"}" — auto-confirmed (address on file)`,
      };
      if (settings?.auto_book_shipping) {
        const ds = String(order.delivery_status ?? "").toLowerCase();
        const blockBooking = ["booked", "shipped", "in_transit", "delivered", "returned"].includes(ds);
        if (!blockBooking) {
          confirmUpdate.delivery_status = "booked";
          confirmUpdate.shipping_status = "Booked";
        }
      }
      await admin.from("orders").update(confirmUpdate).eq("order_id", order.order_id);

      if (conversationId) {
        await admin
          .from("whatsapp_conversations")
          .update({
            status: "confirmed",
            outcome: "confirmed",
            pending_button_intent: null,
            ai_enabled: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversationId);
      }
      try {
        await logOrderHistory({
          orderId: order.order_id,
          actionType: "ai_confirm",
          role: "ai",
          before,
          after: confirmUpdate,
          fields: trackedFields,
        });
      } catch (_) { /* non-blocking */ }
      log("button confirm: stored-address auto-confirmed", order.order_id);
      return;
    }

    // Stored address is weak/missing → gate through AI.
    if (conversationId) {
      await admin
        .from("whatsapp_conversations")
        .update({
          ai_enabled: true,
          pending_button_intent: {
            intent: "confirm",
            mapped_status: "confirmed",
            button_text: buttonText || "YES",
            created_at: new Date().toISOString(),
          },
        })
        .eq("id", conversationId);
    }
    // Flag the order but DO NOT change confirmation_status.
    await admin
      .from("orders")
      .update({
        whatsapp_status: "pending_address",
        whatsapp_note: `Customer clicked "${buttonText || "YES"}" — AI validating address before confirm`,
        whatsapp_last_reply_at: new Date().toISOString(),
      })
      .eq("order_id", order.order_id);
    log("button confirm gated: awaiting AI address validation", order.order_id);
    return;
  } else if (outcome === "more_info") {
    updates.confirmation_status = "new";
    updates.confirmation_channel = "agent";
    updates.agent_id = null;
  } else if (outcome === "canceled") {
    // IMPORTANT: WhatsApp button can only confirm orders, NEVER cancel them.
    // We only flag the conversation/order so a human agent can decide.
    // Do NOT change confirmation_status, agent_id, or confirmation_channel.
    updates.whatsapp_note = "Customer requested cancellation via WhatsApp";
  }

  // Snapshot fields we care about BEFORE update so we can write history deltas
  const trackedFields = [
    "confirmation_status",
    "delivery_status",
    "shipping_status",
    "agent_id",
    "note",
  ];
  const before: Record<string, any> = {};
  for (const f of trackedFields) before[f] = order[f] ?? null;

  const { error } = await admin
    .from("orders")
    .update(updates)
    .eq("order_id", order.order_id);
  if (error) {
    errLog("order update failed", order.order_id, error);
    return;
  }
  log("order updated", order.order_id, "→", outcome);

  await logOrderHistory({
    orderId: order.order_id,
    actionType: outcome === "confirmed" ? "whatsapp_confirm" : (outcome === "canceled" ? "whatsapp_cancel" : "whatsapp_more_info"),
    role: "whatsapp",
    before,
    after: updates,
    fields: trackedFields,
  });
}

// ---------------------------------------------------------------------------
// Order history helper — write deltas to order_history using a sentinel UUID
// for non-user actors (whatsapp / ai / system).
// ---------------------------------------------------------------------------
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

async function logOrderHistory(args: {
  orderId: string;
  actionType: string;          // e.g. "ai_confirm", "whatsapp_confirm"
  role: "ai" | "whatsapp" | "system";
  before: Record<string, any>;
  after: Record<string, any>;
  fields: string[];
}) {
  try {
    const groupId = crypto.randomUUID();
    const rows: any[] = [];
    for (const f of args.fields) {
      if (!(f in args.after)) continue;
      const oldV = args.before[f];
      const newV = args.after[f];
      if (String(oldV ?? "") === String(newV ?? "")) continue;
      rows.push({
        order_id: args.orderId,
        changed_by: SYSTEM_USER_ID,
        changed_by_role: args.role,
        action_type: args.actionType,
        field_changed: f,
        old_value: oldV != null ? String(oldV) : null,
        new_value: newV != null ? String(newV) : null,
        group_id: groupId,
      });
    }
    if (rows.length === 0) return;
    const { error } = await admin.from("order_history").insert(rows);
    if (error) errLog("order_history insert failed", error.message);
  } catch (e) {
    errLog("logOrderHistory exception", (e as Error).message);
  }
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
      let replyToMetaMessageId: string | null =
        m.context?.id ??
        m.button?.context?.id ??
        m.interactive?.button_reply?.context?.id ??
        null;
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
        const payload = (m.button.payload ?? "").toString();
        const text = (m.button.text ?? "").toString();
        const norm = `${payload} ${text}`.toLowerCase();
        if (payload === "confirm_order" || /\b(yes|confirm|أكد|نعم|oui)\b/.test(norm)) {
          outcome = "confirmed";
        } else if (payload === "cancel_order" || /\b(cancel|no|إلغاء|الغاء|annuler|non)\b/.test(norm)) {
          outcome = "canceled";
        } else if (payload === "more_info" || /\b(more|info|change|modify|تعديل|معلومات)\b/.test(norm)) {
          outcome = "more_info";
        }
      } else if (m.type === "text") {
        bodyText = m.text?.body ?? "";
      } else if (m.type === "audio" || m.type === "voice") {
        // Voice notes: transcribe with OpenAI Whisper so the AI can understand
        // and reply naturally. We re-tag as "text" downstream so the AI flow
        // (which gates on text) treats it like a normal customer message.
        const transcript = await transcribeWhatsappAudio(m.audio || m.voice);
        if (transcript) {
          bodyText = transcript;
          messageType = "audio_transcribed";
        } else {
          bodyText = "[audio]";
        }
      } else if (m.type === "reaction" && m.reaction) {
        // Customer reacted with an emoji to one of our messages.
        // Store the emoji as the body and reference the original message
        // so the UI can render it as a small reaction badge.
        bodyText = m.reaction.emoji ?? "";
        messageType = "reaction";
        replyToMetaMessageId = m.reaction.message_id ?? replyToMetaMessageId;
      } else {
        bodyText = JSON.stringify(m).slice(0, 500);
      }

      const replyTarget = await resolveReplyTarget(replyToMetaMessageId);
      const { conv, order } = replyTarget.conv
        ? replyTarget
        : await findOrCreateConversation(phone, parsedOrderId);
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

      // Mark any recent campaign recipient on this conversation as "replied".
      try {
        const { data: lastCampRecip } = await admin
          .from("whatsapp_campaign_recipients")
          .select("id, campaign_id, status")
          .eq("conversation_id", conv.id)
          .in("status", ["sent", "delivered", "read"])
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastCampRecip) {
          await admin
            .from("whatsapp_campaign_recipients")
            .update({ status: "replied", replied_at: new Date().toISOString() })
            .eq("id", lastCampRecip.id);
          // Bump campaign reply counter.
          const { count } = await admin
            .from("whatsapp_campaign_recipients")
            .select("*", { count: "exact", head: true })
            .eq("campaign_id", lastCampRecip.campaign_id)
            .eq("status", "replied");
          await admin.from("whatsapp_campaigns").update({
            replied_count: count ?? 0,
          }).eq("id", lastCampRecip.campaign_id);
        }
      } catch (e) {
        errLog("campaign reply mirror failed", e);
      }

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
      // NOTE: last_reply_at is reserved for AI/agent OUTBOUND replies.
      // We only bump last_message_at here (inbound activity). Bumping
      // last_reply_at on every inbound caused the sweeper to skip
      // conversations where the customer sent the final message but the
      // AI never replied (e.g. address arriving right after a button
      // confirm) — the conv looked "freshly answered" forever.
      await admin
        .from("whatsapp_conversations")
        .update({
          last_message_at: nowIso,
          updated_at: nowIso,
          status: nextStatus,
        })
        .eq("id", conv.id);

      // Trigger CRM update for button actions only — never auto-confirm text.
      if (order && outcome) {
        await applyOutcome(order, outcome, conv?.id ?? null, bodyText);
      } else if (!order && outcome) {
        log("button outcome but no matched order", phone, outcome);
      }

      // Resume any paused automation run waiting for this conversation's reply.
      let resumedRun = false;
      try {
        const { data: pausedRun } = await admin
          .from("whatsapp_automation_runs")
          .select("id, current_node_id, automation_id")
          .eq("conversation_id", conv.id)
          .eq("status", "waiting_reply")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (pausedRun) {
          resumedRun = true;
          // Determine the button index by matching the clicked button text against
          // the template_buttons stored on the current node.
          let buttonIndex: number | undefined;
          if (messageType === "button_reply") {
            const { data: autoRow } = await admin
              .from("whatsapp_automations")
              .select("nodes")
              .eq("id", pausedRun.automation_id)
              .maybeSingle();
            const nodes = (autoRow?.nodes as any[]) ?? [];
            const node = nodes.find((n: any) => n.id === pausedRun.current_node_id);
            const buttons: any[] = Array.isArray(node?.data?.template_buttons)
              ? node.data.template_buttons
              : [];
            const idx = buttons.findIndex(
              (b) => String(b?.text ?? "").trim().toLowerCase() === bodyText.trim().toLowerCase(),
            );
            if (idx >= 0) buttonIndex = idx;
          }

          // Fire-and-forget invocation of the runner
          const projectUrl = Deno.env.get("SUPABASE_URL")!;
          const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
          fetch(`${projectUrl}/functions/v1/whatsapp-automation-runner`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
            body: JSON.stringify({
              resume: true,
              run_id: pausedRun.id,
              ...(buttonIndex !== undefined ? { button_index: buttonIndex } : { reply_text: bodyText }),
            }),
          }).catch((e) => errLog("runner resume invoke failed", e));
        }
      } catch (e) {
        errLog("automation resume lookup failed", (e as Error).message);
      }

      // From-template trigger: if no run was resumed and the customer's reply
      // targets one of our outbound template messages, fire matching automations.
      if (!resumedRun) {
        try {
          const repliedTemplateId = await resolveRepliedTemplate(replyToMetaMessageId);
          if (repliedTemplateId) {
            let buttonIndex: number | undefined;
            if (messageType === "button_reply" && bodyText) {
              const { data: tplRow } = await admin
                .from("whatsapp_templates")
                .select("buttons")
                .eq("id", repliedTemplateId)
                .maybeSingle();
              const tplButtons: any[] = Array.isArray(tplRow?.buttons) ? tplRow!.buttons : [];
              const idx = tplButtons.findIndex(
                (b) => String(b?.text ?? "").trim().toLowerCase() === bodyText.trim().toLowerCase(),
              );
              if (idx >= 0) buttonIndex = idx;
            }
            const projectUrl = Deno.env.get("SUPABASE_URL")!;
            const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
            fetch(`${projectUrl}/functions/v1/whatsapp-automation-runner`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
              body: JSON.stringify({
                trigger_type: "from_template",
                template_id: repliedTemplateId,
                conversation_id: conv.id,
                order_id: order?.order_id ?? null,
                customer_phone: from,
                ...(buttonIndex !== undefined
                  ? { button_index: buttonIndex }
                  : { reply_text: bodyText }),
              }),
            }).catch((e) => errLog("from_template runner invoke failed", e));
          }
        } catch (e) {
          errLog("from_template trigger lookup failed", (e as Error).message);
    }
  }


      // Trigger when:
      //  - this is a free-text message (not a button outcome), AND
      //  - either no automation run was resumed, OR the order still needs
      //    info (incomplete address) OR is not yet confirmed — meaning the
      //    customer's reply went into a now-finished automation step but no
      //    further automation node will reply, so the AI must take over.
      // This also covers orders that were auto-switched to the agent queue
      // (status=new, channel=agent) — the AI keeps replying in parallel and
      // can still auto-confirm if the customer eventually provides the info.
      const addressIncomplete =
        !!order && (!order.customer_address || String(order.customer_address).trim().length < 10);
      const orderNotConfirmed =
        !!order && order.confirmation_status !== "confirmed" && order.confirmation_status !== "canceled";
      const aiDisabledForConv = conv?.ai_enabled === false;
      // Image analysis flag — default ON unless admin disabled it in AI settings
      let imageAnalysisOn = true;
      if (m.type === "image") {
        const { data: aiCfgRow } = await admin
          .from("whatsapp_ai_settings")
          .select("ai_image_analysis_enabled")
          .eq("singleton", true)
          .maybeSingle();
        imageAnalysisOn = aiCfgRow?.ai_image_analysis_enabled !== false;
      }
      const shouldContinueWithAI =
        !aiDisabledForConv &&
        (
          (
            (m.type === "text" || messageType === "audio_transcribed") &&
            !outcome &&
            (!resumedRun || addressIncomplete || orderNotConfirmed)
          ) || (
            // Customer sent an image — let the AI look at it and reply
            // (e.g. screenshot of address, photo of CNIC, picture of issue).
            m.type === "image" && imageAnalysisOn && !outcome
          ) || (
            messageType === "button_reply" &&
            !resumedRun
          )
        );

      if (aiDisabledForConv) {
        log("ai-continue: disabled for conversation", conv?.id);
      }

      if (shouldContinueWithAI) {
        // Debounce / batch: wait N seconds for additional messages, dedup outbound replies.
        const triggerAt = Date.now();
        const convId = conv.id;
        const orderId = order?.id ?? null;
        const task = (async () => {
          try {
            const { data: aiCfg } = await admin
              .from("whatsapp_ai_settings")
              .select("ai_batch_wait_seconds, ai_dedup_window_seconds")
              .eq("singleton", true)
              .maybeSingle();
            const batchWaitMs = Math.max(0, (aiCfg?.ai_batch_wait_seconds ?? 20)) * 1000;
            const dedupWindowMs = Math.max(0, (aiCfg?.ai_dedup_window_seconds ?? 30)) * 1000;

            if (resumedRun) await new Promise((r) => setTimeout(r, 1500));
            if (batchWaitMs > 0) await new Promise((r) => setTimeout(r, batchWaitMs));

            // Abort if a NEWER inbound arrived after this one — that newer
            // invocation will own the reply (it will batch in everything since).
            const { data: latestIn } = await admin
              .from("whatsapp_messages")
              .select("created_at")
              .eq("conversation_id", convId)
              .eq("direction", "in")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (latestIn?.created_at && new Date(latestIn.created_at).getTime() > triggerAt + 500) {
              log("ai-continue: superseded by newer inbound, skipping", convId);
              return;
            }

            // Dedup: skip if AI already sent an outbound within the dedup window.
            // EXCEPTION: if the customer's latest inbound is NEWER than that outbound,
            // the customer asked something after our reply (e.g. clicked YES + asked
            // for product picture in the same batch — applyOutcome auto-confirmed but
            // the picture request is still pending). Always answer in that case.
            if (dedupWindowMs > 0) {
              const since = new Date(Date.now() - dedupWindowMs).toISOString();
              const { data: recentOut } = await admin
                .from("whatsapp_messages")
                .select("id, created_at")
                .eq("conversation_id", convId)
                .eq("direction", "out")
                .gt("created_at", since)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (recentOut) {
                const latestInTs = latestIn?.created_at ? new Date(latestIn.created_at).getTime() : 0;
                const recentOutTs = new Date(recentOut.created_at).getTime();
                if (latestInTs > recentOutTs) {
                  log("ai-continue: dedup bypassed — customer message newer than last outbound", convId);
                } else {
                  log("ai-continue: dedup window hit, skipping", convId, recentOut.created_at);
                  return;
                }
              }
            }

            // Aggregate all inbound messages received during the batch window so
            // the AI sees them as a single combined customerText.
            const sinceBatch = new Date(triggerAt - batchWaitMs - 1000).toISOString();
            const { data: batched } = await admin
              .from("whatsapp_messages")
              .select("body, message_type, created_at")
              .eq("conversation_id", convId)
              .eq("direction", "in")
              .gte("created_at", sinceBatch)
              .order("created_at", { ascending: true });
            const combinedText = (batched ?? [])
              .map((m: any) => m.body || `[${m.message_type}]`)
              .filter(Boolean)
              .join("\n");

            // Re-fetch order (status may have changed during the wait).
            let freshOrder = order;
            if (orderId) {
              const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
              if (o) freshOrder = o;
            }
            // Re-fetch conv too — applyOutcome may have stashed pending_button_intent
            // (gated confirm) or flipped ai_enabled while we were waiting.
            let freshConv = conv;
            const { data: c } = await admin
              .from("whatsapp_conversations")
              .select("*")
              .eq("id", convId)
              .maybeSingle();
            if (c) freshConv = c;

            await aiContinueReply({ conv: freshConv, order: freshOrder, customerText: combinedText || bodyText });
          } catch (e) {
            errLog("ai continuation failed", (e as Error).message);
          }
        })();
        // Run after webhook returns, without blocking Meta's response.
        try { (globalThis as any).EdgeRuntime?.waitUntil?.(task); } catch { /* ignore */ }
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
    // Capture Meta's error reason when delivery fails so we can debug (e.g. unsupported audio codec).
    const errMsg = Array.isArray(s.errors) && s.errors.length > 0
      ? (s.errors[0]?.error_data?.details || s.errors[0]?.message || s.errors[0]?.title || JSON.stringify(s.errors))
      : null;
    const update: Record<string, unknown> = { status: s.status };
    if (errMsg) update.error_message = errMsg;
    const { error } = await admin
      .from("whatsapp_messages")
      .update(update)
      .eq("meta_message_id", s.id);
    if (error) errLog("status update failed", s.id, error);
    if (s.status === "failed") log("delivery failed", s.id, errMsg);

    // Mirror status onto campaign recipient (if this msg belongs to a campaign).
    try {
      const recipUpdate: Record<string, unknown> = {};
      const nowIso = new Date().toISOString();
      if (s.status === "delivered") {
        recipUpdate.status = "delivered";
        recipUpdate.delivered_at = nowIso;
      } else if (s.status === "read") {
        recipUpdate.status = "read";
        recipUpdate.read_at = nowIso;
      } else if (s.status === "failed") {
        recipUpdate.status = "failed";
        recipUpdate.failed_at = nowIso;
        if (errMsg) recipUpdate.error_message = errMsg;
      }
      if (Object.keys(recipUpdate).length > 0) {
        const { data: recip } = await admin
          .from("whatsapp_campaign_recipients")
          .update(recipUpdate)
          .eq("meta_message_id", s.id)
          .select("campaign_id")
          .maybeSingle();
        if (recip?.campaign_id) {
          await refreshCampaignCounters(recip.campaign_id);
        }
      }
    } catch (e) {
      errLog("campaign status mirror failed", e);
    }
  }
}

// Recompute campaign counters from recipients table (cheap with indexes).
async function refreshCampaignCounters(campaignId: string) {
  const statuses = ["sent", "delivered", "read", "replied", "failed"] as const;
  const counts: Record<string, number> = {};
  for (const st of statuses) {
    const { count } = await admin
      .from("whatsapp_campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", st);
    counts[st] = count ?? 0;
  }
  // "sent" total = anything that left our side successfully.
  const sentTotal = counts.sent + counts.delivered + counts.read + counts.replied;
  await admin.from("whatsapp_campaigns").update({
    sent_count: sentTotal,
    delivered_count: counts.delivered + counts.read + counts.replied,
    read_count: counts.read + counts.replied,
    replied_count: counts.replied,
    failed_count: counts.failed,
  }).eq("id", campaignId);
}

// ---------------------------------------------------------------------------
// Send a WhatsApp image message (used by the AI when the customer asks for a
// product photo). Logs the outbound message and returns whether it succeeded.
//
// IMPORTANT: WhatsApp Cloud API only accepts image/jpeg and image/png. WebP /
// AVIF / etc. are rejected ("Unsupported Image mime type image/webp"). We
// detect non-JPEG/PNG URLs and route them through the public wsrv.nl image
// proxy which serves a re-encoded JPEG with the correct Content-Type, so
// Meta's media-fetch accepts it.
// ---------------------------------------------------------------------------
function ensureJpegFriendlyUrl(srcUrl: string): string {
  const lower = srcUrl.toLowerCase().split("?")[0];
  if (/\.(jpe?g|png)$/.test(lower)) return srcUrl;
  // Route through wsrv.nl to force re-encoding to image/jpeg.
  return `https://wsrv.nl/?url=${encodeURIComponent(srcUrl)}&output=jpg&q=85`;
}

async function sendWhatsappImage(args: {
  to: string;
  imageUrl: string;
  caption?: string;
  conversationId: string;
  orderId: string | null;
  settings: any;
  accessToken: string;
}): Promise<boolean> {
  const { to, imageUrl, caption, conversationId, orderId, settings, accessToken } = args;
  const finalUrl = ensureJpegFriendlyUrl(imageUrl);
  const mediaObj: any = { link: finalUrl };
  if (caption) mediaObj.caption = caption;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: mediaObj,
  };
  const url = `${settings.api_base_url}/${settings.phone_number_id}/messages`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const respJson = await resp.json().catch(() => ({}));
  const ok = resp.ok;
  const metaMsgId = ok ? respJson?.messages?.[0]?.id : null;
  await admin.from("whatsapp_messages").insert({
    conversation_id: conversationId,
    order_id: orderId,
    direction: "out",
    message_type: "image",
    body: caption || "[image]",
    payload: { ...payload, _ai_continuation: true, _ai_tool: "send_product_image", _src_url: imageUrl },
    meta_message_id: metaMsgId,
    status: ok ? "sent" : "failed",
    error_message: ok ? null : JSON.stringify(respJson).slice(0, 500),
  });
  if (!ok) errLog("ai send_product_image failed", respJson);
  else log("ai send_product_image sent", { conv: conversationId, proxied: finalUrl !== imageUrl });
  return ok;
}

// ---------------------------------------------------------------------------
// AI continuation: when a customer replies in free text and no automation run
// is paused, generate an AI follow-up reply using the same logic as the
// automation runner's `ai_step` so the conversation keeps flowing
// (e.g. for collecting missing address details).
// ---------------------------------------------------------------------------
async function aiContinueReply(args: {
  conv: any;
  order: any | null;
  customerText: string;
}) {
  const { conv, order } = args;
  if (!conv?.id) return;

  const { data: aiSettings } = await admin
    .from("whatsapp_ai_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (!aiSettings) {
    log("ai-continue: settings missing");
    return;
  }

  const { data: keyRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "openai_api_key")
    .maybeSingle();
  const apiKey = (keyRow?.value as string)?.trim() || Deno.env.get("OPENAI_API_KEY") || "";
  if (!apiKey) {
    errLog("ai-continue: no OpenAI API key configured (set openai_api_key in AI Settings → Connection)");
    return;
  }

  const { data: msgs } = await admin
    .from("whatsapp_messages")
    .select("direction,body,message_type,created_at,payload")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(15);
  const orderedMsgs = (msgs ?? []).slice().reverse();

  // Build standard text-only history. We will rewrite the LAST inbound entry
  // into a multimodal message if it (or any consecutive trailing inbound)
  // contains an image, so the AI can actually see what the customer sent.
  const history: any[] = orderedMsgs.map((m: any) => ({
    role: m.direction === "in" ? "user" : "assistant",
    content: m.body || `[${m.message_type}]`,
  }));

  // Find trailing inbound images (the customer just sent one or more images,
  // possibly with a text caption batched in). We attach them to the last user
  // message as image_url parts (OpenAI multimodal format).
  const trailingInboundImages: any[] = [];
  for (let i = orderedMsgs.length - 1; i >= 0; i--) {
    const mm = orderedMsgs[i];
    if (mm.direction !== "in") break;
    if (mm.message_type === "image") {
      const imgPayload = mm.payload?.image || mm.payload;
      trailingInboundImages.unshift(imgPayload);
    }
  }

  if (trailingInboundImages.length > 0) {
    // Inline up to 3 most recent images as base64 data URLs (Meta media URLs
    // are private and require our access token, so the AI can't fetch them).
    const dataUrls: string[] = [];
    for (const img of trailingInboundImages.slice(-3)) {
      const fetched = await fetchWhatsappMediaAsDataUrl(img);
      if (fetched) dataUrls.push(fetched.dataUrl);
    }

    if (dataUrls.length > 0) {
      // Find the last user entry in history and rewrite it as a multimodal
      // message that combines the original text (caption / batched text) with
      // the inlined image(s).
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === "user") {
          const textPart = typeof history[i].content === "string" ? history[i].content : "";
          const parts: any[] = [];
          if (textPart && textPart.trim() && !/^\[image\]$/i.test(textPart.trim())) {
            parts.push({ type: "text", text: textPart });
          } else {
            parts.push({ type: "text", text: "[The customer sent the image(s) above. Look at them and reply naturally in their language.]" });
          }
          for (const url of dataUrls) {
            parts.push({ type: "image_url", image_url: { url } });
          }
          history[i] = { role: "user", content: parts };
          break;
        }
      }
      log("ai-continue: attached inbound images", { count: dataUrls.length, conv: conv.id });
    } else {
      log("ai-continue: failed to fetch inbound images", { conv: conv.id });
    }
  }

  // Look up the product (for image_url + ai_context) linked to this order's product_name
  let product: any = null;
  if (order?.product_name) {
    const { data: p } = await admin
      .from("products")
      .select("id,name,image_url,scraped_image_url,price,product_url,ai_context,ai_context_scraped_at")
      .ilike("name", order.product_name.trim())
      .maybeSingle();
    product = p;
  }

  // Lazy-scrape the product page if we have a product_url but no fresh ai_context.
  // Cached for 7 days inside product-context-fetch. Non-blocking on failure.
  // Also auto-triggers when ai_context is fresh BUT no image was ever scraped
  // (e.g. ai_context predates the scraped_image_url feature) — uses force=true to refresh.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const ctxAge = product?.ai_context_scraped_at
    ? Date.now() - new Date(product.ai_context_scraped_at).getTime()
    : Infinity;
  const ctxStale = !product?.ai_context || ctxAge > SEVEN_DAYS_MS;
  const hasManualImage = !!(product?.image_url && /^https?:\/\//i.test(product.image_url));
  const hasScrapedImage = !!(product?.scraped_image_url && /^https?:\/\//i.test(product.scraped_image_url));
  const needsImageBackfill = !hasManualImage && !hasScrapedImage;
  const shouldScrape = product?.id && product?.product_url && /^https?:\/\//i.test(product.product_url) && (ctxStale || needsImageBackfill);
  if (shouldScrape) {
    try {
      const { data: ctxRes } = await admin.functions.invoke("product-context-fetch", {
        body: { product_id: product.id, force: needsImageBackfill && !ctxStale },
      });
      if (ctxRes?.ai_context) {
        product.ai_context = ctxRes.ai_context;
      }
      if (ctxRes?.scraped_image_url) {
        product.scraped_image_url = ctxRes.scraped_image_url;
      }
    } catch (e) {
      errLog("product-context-fetch invoke failed", (e as Error).message);
    }
  }

  // Effective image for AI tool: manual upload > scraped from store.
  const effectiveImageUrl: string | null = hasManualImage
    ? product.image_url
    : (product?.scraped_image_url && /^https?:\/\//i.test(product.scraped_image_url) ? product.scraped_image_url : null);
  const hasProductImage = !!effectiveImageUrl;

  const productContext: string = product?.ai_context
    ? `\n\nProduct details (from store page — use to answer customer questions about features, materials, sizes, colors, usage, etc. Stay accurate, do NOT invent facts not in this text):\n${product.ai_context}`
    : "";

  const orderCtx = order
    ? `\n\nOrder context:\n- Order ID: ${order.order_id}\n- Customer: ${order.customer_name}\n- Product: ${order.product_name}\n- Quantity: ${order.quantity}\n- Total: ${order.total_amount} PKR\n- City: ${order.customer_city}\n- Address: ${order.customer_address ?? "(not provided)"}`
    : "";
  const hasStoredAddress =
    !!order &&
    isAddressDeliverable(order.customer_address, order.customer_city);
  const addressRule = order && !hasStoredAddress
    ? `\n\nIMPORTANT — ADDRESS COLLECTION: The customer's delivery address is MISSING, FAKE, TEST data, or too vague (current value: "${order.customer_address ?? "(none)"}", city: "${order.customer_city ?? "(none)"}").\n\nA deliverable address needs:\n1) A city / town / tehsil / village name in Pakistan, AND\n2) AT LEAST ONE locator detail — ANY of:\n   - a house/flat/plot/shop NUMBER, OR\n   - a street/lane/road/gali NAME or number, OR\n   - a neighborhood/colony/block/sector/phase/mohalla/tehsil name, OR\n   - a known landmark / shop / hotel / masjid / school / chowk / bank / hospital + area\n\nGOOD examples (ACCEPT — DO NOT ask for house number):\n- "House 12 Street 4 Gulshan-e-Iqbal" ✅\n- "Tehsil Dipalpur Madina Chowk Mobile Care Shop" ✅ (landmark + area + city → deliverable)\n- "Near UBL Bank Main Bazaar Road Batagram" ✅\n- "Mohalla Islamia Gali 2 Layyah" ✅\n\nBAD examples (REJECT and ask for more):\n- "Lahore" (just city, no other detail)\n- "Test" / "same" / random text\n- A single word with no context\n\nRules:\n- ⚠️ DO NOT demand a house number if the customer already gave a clear landmark + area or a shop/office name. Pakistani rural & semi-urban deliveries often work via landmarks — couriers call to find the exact spot.\n- DO NOT keep asking for "house number" once you have city + a recognizable place (shop, hotel, masjid, chowk, mohalla, tehsil, etc.).\n- Politely (in the customer's language) ask for missing details only if address is just a city name or fake.\n- Once the customer gives city + any locator (landmark / shop / area / street / number), thank them and confirm the order will be delivered. The system auto-confirms in the background.`
    : order && hasStoredAddress
    ? `\n\nIMPORTANT: The customer ALREADY has a detailed delivery address on file:\n  📍 ${order.customer_address}, ${order.customer_city}\n\nADDRESS HANDLING RULES:\n- Do NOT proactively ask "Should we deliver to <address>? Reply YES" UNLESS the customer is clearly trying to confirm/place the order in this very message (e.g. they said "confirm", "ok send it", "ship it", "haan bhej do", "deliver kar do", or directly answered a confirmation question you previously asked).\n- If the customer is asking a question (about price, payment method like "cash on delivery", product details, delivery time, color/size, return policy, etc.), JUST answer their question naturally and helpfully. Do NOT ask them to reply YES to an address — they are not at that step yet.\n- If the customer says something like "cash on delivery", "COD", "kitne ka hai", "kab ayega", "what color", treat it as an INFO question — answer it, then optionally invite them to confirm at the end (e.g. "If you'd like to proceed, just say confirm and we'll dispatch."). Do NOT prompt with the stored address.\n- If the customer EXPLICITLY says the stored address is wrong or sends new address details, then capture the new address. The system will auto-confirm in the background.\n- A bare "yes / ok / sahi" reply ONLY counts as a confirmation if your IMMEDIATELY PREVIOUS message asked them to confirm. Otherwise treat it as casual acknowledgement and continue helping.`
    : "";
  const imageRule = hasProductImage
    ? `\n\nProduct image: an official image of "${order.product_name}" is available. If the customer asks for a photo / picture / image of the product (in any language: "تصويرة", "صورة", "tswira", "photo", "image", "pic", "send me the picture", "بعتلي صورة", etc.), CALL the tool \`send_product_image\` to send it as a real WhatsApp image. After calling the tool, write a short natural reply confirming you sent the photo. Never paste the image URL as text.`
    : `\n\nProduct image: no official product image is available. If the customer asks for a photo, politely apologize and offer more details instead. Do NOT call \`send_product_image\`.`;
  const cancelRule = order
    ? `\n\nCANCELLATION HANDLING (CRITICAL):\n- If the customer says they want to cancel the order (in any language: "cancel", "annuler", "إلغاء", "الغاء", "ما بغيتش", "no quiero", "I don't want it", "remove order", "نہیں چاہیے", "cancel kar do", "mat bhejo", "rahne do", "stop", etc.), DO NOT acknowledge cancellation as final and DO NOT change anything.\n- The order is currently "${order.confirmation_status}". You are NOT allowed to cancel a confirmed order or move any order to a cancelled state. Only a human agent can do that.\n- Instead, reply politely and empathetically in the customer's language. First apologize briefly, then ASK why they want to cancel (price? delivery time? changed mind? found cheaper? doesn't need it anymore? quality concerns?).\n- After understanding the reason, try to save the sale with a relevant solution: reassure about quality/warranty, suggest a different variant/quantity, clarify delivery timing, or address their specific concern.\n- IMPORTANT — DISCOUNT POLICY: You CANNOT offer any discount yourself. If (and ONLY if) the customer's reason is clearly about PRICE / TOO EXPENSIVE / "ghali" / "mahnga" / "cher" / "غالي" / "expensive" and they would buy with a discount, CALL the tool \`flag_for_human_discount\` with a short reason. Then tell the customer (in their language) that a human agent will contact them shortly to discuss a special price. Do NOT promise a specific discount amount.\n- If the customer's objection is NOT about price and you can resolve it with reassurance, keep the conversation going naturally. If they accept and you have a deliverable address on file (or they provide one), the system will auto-confirm in the background.\n- Never write phrases like "your order has been cancelled" or "I have cancelled it". Keep the conversation open. If the customer firmly insists after you tried to help (and discount is not the issue), tell them a human agent will contact them shortly to finalize.\n- Keep replies short (1-3 lines), warm, and respectful. Never argue or pressure the customer.`
    : "";

  // Pending button intent — when admin configured "AI gates the button", the
  // webhook stored the customer's clicked intent on the conversation. Tell the
  // AI so it knows what the customer originally wanted and can finalize it
  // properly (after address validation for confirm, or after rescue attempt
  // for cancel).
  const pendingIntent = (conv as any)?.pending_button_intent ?? null;
  const pendingIntentRule = pendingIntent
    ? `\n\nPENDING CUSTOMER INTENT (from a button they clicked):\n- The customer pressed "${pendingIntent.button_text}" which means they want to: ${pendingIntent.intent === "confirm" ? `CONFIRM the order. \n  CRITICAL ADDRESS GATING: The order is NOT yet finalized. The system will only mark it confirmed once we have a COMPLETE & DELIVERABLE address (city + at least one usable locator like house/street/area/landmark). \n  - If the stored address is already detailed enough → reply with a short warm thank-you, briefly read back the address, and the system will auto-confirm. \n  - If the address is missing, vague (e.g. just "Karachi", "Lahore center", "home", a single landmark with no street/area), fake, or too short → THANK them for confirming the order, then in the SAME short message ask politely (in their language) for the FULL address: house/flat #, street, area/block, nearest landmark, + city. \n  - DO NOT say "your order is being processed", "your order is confirmed", "we will ship now", or anything that implies the order is already finalized. Use phrasing like "to ship your order we just need your full address" instead.\n  - Once the customer sends a real complete address, the system will auto-confirm in the background; THEN you can thank them and say the courier will call on arrival.` : pendingIntent.intent === "cancel" ? "CANCEL the order. Follow the CANCELLATION HANDLING rules above — try to understand WHY and rescue the sale. Do NOT acknowledge the cancellation as final yourself." : "request more INFO. Answer their questions accurately."}`
    : "";

  const baseSys = aiSettings.system_prompt || "You are a helpful WhatsApp sales assistant.";
  const inspectionRule = `\n\nPARCEL INSPECTION POLICY (Pakistan COD — CRITICAL):\n- This is Cash on Delivery. The customer IS allowed to OPEN and INSPECT the parcel BEFORE paying the courier.\n- If the customer asks (in any language: "open parcel", "check before pay", "parcel khol kr dekh sakte hain", "khol ke check karna hai", "before payment open", "kya main parcel khol sakta hun", "inspect karna", "dekhna hai pehle", etc.) → reply YES, confirm clearly that they CAN open and check the product before paying, since it's Cash on Delivery.\n- Reassure them: if not satisfied with quality, they can REFUSE the parcel and not pay anything.\n- NEVER say "you cannot open before payment" or "payment first then check". That is WRONG for COD in Pakistan.\n- Keep the reply short, warm, and confident.`;
  const handoffRule = `\n\nHUMAN HANDOFF POLICY (CRITICAL — NO STALLING):\n- You are FORBIDDEN from sending stalling messages like "let me check", "please hold on", "I'll get back to you shortly", "let me confirm and revert", "give me a moment", "خليني نشوف", "ek minute", "ruko zara", or any equivalent in any language.\n- Whenever you would say something like that — OR the customer asks for a brochure / detailed spec sheet / warranty document / OEM info / something not in your product context — you MUST call the tool \`handoff_to_agent\` with a short reason.\n- When you call \`handoff_to_agent\`, your text reply to the customer MUST clearly tell them you are transferring them to a human agent who will contact them shortly. Use the customer's language. Examples:\n  • English: "I'm transferring you to one of our human agents who will assist you shortly 🙏"\n  • Roman Urdu: "Main aap ko hamare human agent ke pass transfer kar raha hoon, wo jaldi aap se contact karenge 🙏"\n  • Urdu: "میں آپ کو ہمارے انسانی ایجنٹ کے پاس منتقل کر رہا ہوں، وہ جلد آپ سے رابطہ کریں گے 🙏"\n- After calling \`handoff_to_agent\`, do NOT continue the conversation yourself. The agent takes over.`;
  const sysPrompt =
    `${baseSys}\n\nBrand tone: ${aiSettings.brand_tone || "friendly"}.\nLanguage rules: ${aiSettings.language_rules || ""}\n\nKeep replies short (about ${aiSettings.response_lines ?? 3} line(s)). Do not invent facts.${orderCtx}${productContext}${addressRule}${imageRule}${cancelRule}${pendingIntentRule}${inspectionRule}${handoffRule}`;

  const rawModel = aiSettings.model || "gpt-4o-mini";
  // Always OpenAI: strip provider prefix; map gemini → gpt-4o-mini.
  const model = rawModel.startsWith("openai/")
    ? rawModel.replace("openai/", "")
    : rawModel.includes("gemini")
    ? "gpt-4o-mini"
    : rawModel;

  const aiUrl = "https://api.openai.com/v1/chat/completions";

  // Build tools list — always include the discount-flag tool when an order
  // exists so AI can escalate price objections to a human; image tool only
  // when an image is available.
  const toolList: any[] = [];
  if (hasProductImage) {
    toolList.push({
      type: "function",
      function: {
        name: "send_product_image",
        description: "Send the official product image to the customer via WhatsApp. Call this whenever the customer asks for a photo/picture/image of the product, in any language.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    });
  }
  if (order) {
    toolList.push({
      type: "function",
      function: {
        name: "handoff_to_agent",
        description: "Transfer this conversation to a human agent and stop the AI. Call this whenever you cannot answer with certainty (missing product spec, technical detail, warranty/return question you don't know, customer insists on speaking to a human, complaint, or any case where you would otherwise say 'let me check / hold on / I'll get back to you'). NEVER tell the customer to 'wait while I check' without calling this tool.",
        parameters: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "Short English reason why a human agent is needed (max 120 chars).",
            },
          },
          required: ["reason"],
          additionalProperties: false,
        },
      },
    });
    toolList.push({
      type: "function",
      function: {
        name: "flag_for_human_discount",
        description: "Flag this conversation so a human agent will follow up to negotiate a price/discount. Call this ONLY when the customer wants to cancel or hesitates clearly because of PRICE / 'too expensive' / 'ghali' / 'mahnga' and would buy with a discount. Never offer a discount yourself; the human agent decides the amount.",
        parameters: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "Short explanation in English of the customer's price objection (max 120 chars).",
            },
          },
          required: ["reason"],
          additionalProperties: false,
        },
      },
    });
  }
  const tools = toolList.length > 0 ? toolList : undefined;

  const settings = await getSettings();
  if (!settings) return;
  const accessToken = (settings as any).access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
  if (!accessToken) {
    errLog("ai-continue: no whatsapp access token");
    return;
  }

  const aiBody: any = {
    model,
    messages: [{ role: "system", content: sysPrompt }, ...history],
    temperature: aiSettings.temperature ?? 0.7,
    max_tokens: aiSettings.max_tokens ?? 400,
  };
  if (tools) aiBody.tools = tools;

  const aiResp = await fetch(aiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(aiBody),
  });
  if (!aiResp.ok) {
    const t = await aiResp.text();
    errLog("ai-continue openai err", aiResp.status, t.slice(0, 200));
    return;
  }
  const aiJson = await aiResp.json();
  const aiMsg = aiJson.choices?.[0]?.message;
  const toolCalls = aiMsg?.tool_calls ?? [];
  let reply: string = aiMsg?.content?.trim() || "";

  // If the AI asked to send the product image, send it first via WhatsApp media,
  // then ask the AI for a short follow-up text.
  let imageSent = false;
  if (hasProductImage && toolCalls.some((c: any) => c?.function?.name === "send_product_image")) {
    imageSent = await sendWhatsappImage({
      to: conv.customer_phone,
      imageUrl: effectiveImageUrl!,
      caption: order?.product_name ? `${order.product_name}` : undefined,
      conversationId: conv.id,
      orderId: order?.order_id ?? null,
      settings,
      accessToken,
    });

    if (imageSent && !reply) {
      // Ask the model for a short natural follow-up confirming the image was sent.
      const followResp = await fetch(aiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: sysPrompt },
            ...history,
            { role: "assistant", content: "(I just sent the product photo to the customer.)" },
            { role: "system", content: "Now write a short natural follow-up message confirming the photo was sent and inviting the customer to continue (e.g. asking if they want to confirm the order or need more info). Reply in the customer's language. 1-2 short lines max." },
          ],
          temperature: aiSettings.temperature ?? 0.7,
          max_tokens: 120,
        }),
      });
      if (followResp.ok) {
        const fj = await followResp.json();
        reply = fj.choices?.[0]?.message?.content?.trim() || "";
      }
    }
  }

  // Handle flag_for_human_discount tool call: add a label on the conversation
  // and capture a note on the order so an agent will pick it up.
  const discountFlag = toolCalls.find(
    (c: any) => c?.function?.name === "flag_for_human_discount",
  );
  if (discountFlag && order) {
    let reason = "";
    try {
      const args = JSON.parse(discountFlag.function?.arguments || "{}");
      reason = String(args?.reason || "").slice(0, 120);
    } catch { /* ignore */ }
    try {
      const existing: string[] = Array.isArray((conv as any).labels)
        ? (conv as any).labels
        : [];
      const nextLabels = Array.from(
        new Set([...existing, "wants_human_agent_discount"]),
      );
      await admin
        .from("whatsapp_conversations")
        .update({ labels: nextLabels })
        .eq("id", conv.id);
      await admin
        .from("orders")
        .update({
          whatsapp_note:
            `Customer wants discount — needs human agent. ${reason ? `Reason: ${reason}` : ""}`.slice(0, 500),
          whatsapp_last_reply_at: new Date().toISOString(),
        })
        .eq("order_id", order.order_id);
      log("ai-continue: flagged for human discount", { conv: conv.id, reason });
    } catch (e) {
      errLog("flag_for_human_discount handler failed", (e as Error).message);
    }
  }

  // Handle handoff_to_agent tool call: route the order to the agent queue
  // (confirmation_status='new', agent_id=null, channel='agent') and turn AI
  // off on this conversation so a human takes over.
  const handoffCall = toolCalls.find(
    (c: any) => c?.function?.name === "handoff_to_agent",
  );
  if (handoffCall && order) {
    let reason = "";
    try {
      const args = JSON.parse(handoffCall.function?.arguments || "{}");
      reason = String(args?.reason || "").slice(0, 120);
    } catch { /* ignore */ }
    try {
      await admin
        .from("whatsapp_conversations")
        .update({
          ai_enabled: false,
          status: "needs_human",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conv.id);

      const beforeStatus = order.confirmation_status;
      const beforeAgent = order.agent_id;
      const releasable = !["confirmed", "booked", "shipped", "delivered", "canceled", "cancelled"]
        .includes(String(order.confirmation_status || "").toLowerCase());

      if (releasable) {
        await admin
          .from("orders")
          .update({
            confirmation_status: "new",
            confirmation_channel: "agent",
            agent_id: null,
            whatsapp_status: "handoff_to_agent",
            whatsapp_note: `AI handoff to human agent. ${reason ? `Reason: ${reason}` : ""}`.slice(0, 500),
            whatsapp_last_reply_at: new Date().toISOString(),
          })
          .eq("order_id", order.order_id);

        try {
          await logOrderHistory({
            orderId: order.order_id,
            actionType: "whatsapp_handoff",
            role: "ai",
            before: { confirmation_status: beforeStatus, agent_id: beforeAgent ?? null },
            after: { confirmation_status: "new", agent_id: null },
            fields: ["confirmation_status", "agent_id"],
          });
        } catch { /* non-fatal */ }
      } else {
        await admin
          .from("orders")
          .update({
            whatsapp_status: "handoff_to_agent",
            whatsapp_note: `AI handoff to human agent (order already ${order.confirmation_status}). ${reason ? `Reason: ${reason}` : ""}`.slice(0, 500),
            whatsapp_last_reply_at: new Date().toISOString(),
          })
          .eq("order_id", order.order_id);
      }
      log("ai-continue: handoff_to_agent", { conv: conv.id, order: order.order_id, reason });
    } catch (e) {
      errLog("handoff_to_agent handler failed", (e as Error).message);
    }
  }

  if (!reply && !imageSent) {
    log("ai-continue: empty reply");
    return;
  }
  if (!reply && imageSent) {
    // Nothing more to send; image already delivered.
    await admin
      .from("whatsapp_conversations")
      .update({ status: "ai_active", updated_at: new Date().toISOString() })
      .eq("id", conv.id);
    return;
  }

  const to = conv.customer_phone;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: reply },
  };
  const url = `${settings.api_base_url}/${settings.phone_number_id}/messages`;
  const sendResp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const sendJson = await sendResp.json();
  const ok = sendResp.ok;
  const metaMsgId = ok ? sendJson?.messages?.[0]?.id : null;

  await admin.from("whatsapp_messages").insert({
    conversation_id: conv.id,
    order_id: order?.order_id ?? null,
    direction: "out",
    message_type: "text",
    body: reply,
    payload: { ...payload, _ai_continuation: true },
    meta_message_id: metaMsgId,
    status: ok ? "sent" : "failed",
    error_message: ok ? null : JSON.stringify(sendJson).slice(0, 500),
  });

  if (ok) {
    await admin
      .from("whatsapp_conversations")
      .update({ status: "ai_active", updated_at: new Date().toISOString() })
      .eq("id", conv.id);
    log("ai-continue: replied", { conv: conv.id, len: reply.length });

    // After replying, attempt to extract a complete address from the customer's
    // latest message + history. If we get a deliverable address, update the
    // order (mapping city to ORIO cache) and auto-confirm.
    if (order) {
      try {
        await tryExtractAndConfirmAddress({
          order,
          conv,
          customerText: args.customerText,
          history,
          apiKey,
          model,
        });
      } catch (e) {
        errLog("address extraction failed", (e as Error).message);
      }
    }
  } else {
    errLog("ai-continue: send failed", sendJson);
  }
}

// ---------------------------------------------------------------------------
// Extract a complete delivery address via OpenAI (JSON mode), match the city
// to ORIO cities cache, then update + auto-confirm the order.
// ---------------------------------------------------------------------------
async function tryExtractAndConfirmAddress(args: {
  order: any;
  conv: any;
  customerText: string;
  history: { role: string; content: string }[];
  apiKey: string;
  model: string;
}) {
  const { order, conv, customerText, history, apiKey, model } = args;

  // Use module-level isAddressDeliverable for consistency.
  const alreadyDeliverable = isAddressDeliverable(order.customer_address, order.customer_city);
  const pendingIntent = (conv as any)?.pending_button_intent ?? null;
  const hasPendingIntent = !!pendingIntent;
  if (
    order.confirmation_status === "confirmed" &&
    alreadyDeliverable &&
    !hasPendingIntent
  ) {
    return;
  }

  // SHORT-CIRCUIT: stored address is already deliverable AND order is not yet
  // confirmed. This covers two flows:
  //   (a) Customer clicked the "Confirm" button (pending_button_intent set), OR
  //   (b) Customer replied with text to the template/AI (no button click) and
  //       the stored address from the imported sheet is already complete.
  // In both cases there is no NEW address detail to extract — the AI extractor
  // would return "incomplete" on a generic reply ("ok", "haan", "thanks") and
  // the order would stay on `new` forever even though the bot already told the
  // customer "your order is confirmed". Finalize using the stored address.
  // GUARD: never auto-confirm via the stored-address shortcut if the customer's
  // latest text shows denial, doubt, cancellation, or any negative intent. The
  // shortcut should only fire on positive engagement (or on a pending button
  // intent already captured separately). AB-790 fix.
  const txt = String(customerText || "").toLowerCase().trim();
  const negativeIntentRe = /\b(cancel|annul|annuler|don'?t know|do not know|didn'?t order|did not order|wrong order|not mine|not me|i don'?t want|i do not want|don'?t want it|stop|refuse|return|refund|mistake|by mistake|nahi chahiye|nahin chahiye|nahi chaahiye|mat bhejo|mat bhejna|nahi karna|nahin karna|rahne do|cancel kar do|cancel karo|cancel karna|nahi pata|nahin pata|nai pata|maloom nahi|pata nahi|maine order nahi kiya|order nahi kiya|order nai kiya|galat order|mera order nahi|ghalat|mujhe nahi chahiye|mujhe nahin chahiye|kuch nahi chahiye|paise nahi|paisay nahi|free|muft|mufat|نہیں چاہیے|الغاء|إلغاء|ما بغيتش|لا أريد|لا اريد|نہیں|نہی|پتہ نہیں|پتا نہیں|غلط)\b/i;
  if (negativeIntentRe.test(txt)) {
    log("address-extract: skipped stored-address shortcut (negative intent)", {
      order: order.order_id,
      sample: txt.slice(0, 80),
    });
    return;
  }

  // POSITIVE INTENT GUARD (AB-862 fix): the stored-address shortcut must only
  // fire when the customer has clearly expressed CONFIRMATION INTENT — either
  // by clicking the YES button (pending_button_intent set) or by sending a
  // clearly affirmative text. A neutral/auto-reply ("Hello & Welcome to Land
  // Advisor 😊", "thanks", a greeting, or a business auto-responder) must NOT
  // trigger auto-confirmation. Without this guard the system finalizes orders
  // the customer never agreed to.
  const positiveIntentRe = /\b(yes|yeah|yep|yup|sure|ok|okay|okk+|k|kk+|confirm|confirmed|done|haan|haanji|han|hanji|jee|jee?\s*haan|ji|ji\s*haan|theek|thik|thik\s*hai|theek\s*hai|sahi|sahih|correct|right|right\s*hai|order\s*kar|order\s*do|bhej\s*do|bhejo|deliver|chahiye|chaahiye|chahyie|mangwa|mangwao|book|book\s*kar|accept|agree|approve|proceed|go\s*ahead|نعم|أيوة|تمام|موافق|بسم\s*الله|ہاں|جی|جی\s*ہاں|ٹھیک|درست|تصدیق|بھیج|منگوا)\b/i;
  const hasPositiveIntent = positiveIntentRe.test(txt);
  if (!hasPendingIntent && !hasPositiveIntent) {
    log("address-extract: skipped stored-address shortcut (no positive intent)", {
      order: order.order_id,
      sample: txt.slice(0, 80),
    });
    return;
  }


  if (
    alreadyDeliverable &&
    order.confirmation_status !== "confirmed"
  ) {
    const trackedFields = [
      "confirmation_status",
      "delivery_status",
      "shipping_status",
    ];
    const before: Record<string, any> = {};
    for (const f of trackedFields) before[f] = order[f] ?? null;

    const settings = await getSettings();
    const confirmUpdate: Record<string, any> = {
      confirmation_status: "confirmed",
      confirmation_channel: "whatsapp",
      confirmed_at: new Date().toISOString(),
      whatsapp_status: "confirmed",
      whatsapp_last_reply_at: new Date().toISOString(),
    };
    if (settings?.auto_book_shipping) {
      const ds = String(order.delivery_status ?? "").toLowerCase();
      const blockBooking = ["booked", "shipped", "in_transit", "delivered", "returned"].includes(ds);
      if (!blockBooking) {
        confirmUpdate.delivery_status = "booked";
        confirmUpdate.shipping_status = "Booked";
      }
    }
    const { error: updErr } = await admin
      .from("orders")
      .update(confirmUpdate)
      .eq("order_id", order.order_id);
    if (updErr) {
      errLog("address-extract: stored-address confirm failed", updErr);
      return;
    }
    await admin
      .from("whatsapp_conversations")
      .update({
        status: "confirmed",
        outcome: "confirmed",
        pending_button_intent: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conv.id);
    await logOrderHistory({
      orderId: order.order_id,
      actionType: "ai_confirm",
      role: "ai",
      before,
      after: confirmUpdate,
      fields: trackedFields,
    });
    log("address-extract: stored-address auto-confirmed", {
      order: order.order_id,
      city: order.customer_city,
    });
    return;
  }

  // Load ORIO cities for matching
  const { data: cities } = await admin
    .from("orio_cities_cache")
    .select("city_name");
  const cityNames = (cities ?? []).map((c: any) => c.city_name);
  if (cityNames.length === 0) {
    log("address-extract: no orio cities cached, skipping");
    return;
  }

  const extractPrompt = `You are an address-extraction assistant for a courier in Pakistan. Your job is to ensure the address is DETAILED ENOUGH for a courier to find the exact location without calling the customer.

A "deliverable" address requires:
1) A city OR town OR tehsil OR village name (anywhere in Pakistan), AND
2) SPECIFIC location details — "near [landmark]" ALONE is NOT enough. The customer must provide at least ONE of:
   - a house / flat / plot / shop / office NUMBER (e.g. "House 45", "Plot 12", "Shop 3"), OR
   - a specific street / lane / road / gali NAME or number (e.g. "Ajmera Road", "Street 4", "Gali 3"), OR
   - a neighborhood / area / colony / block / sector / phase / mohalla name (e.g. "Gulshan-e-Iqbal Block 7", "DHA Phase 5", "Saddar", "Johar Town", "Mohalla Islamia"), OR
   - a COMBINATION of landmark + street/area (e.g. "near Allahdin Hotel, Main Bazaar Road" — NOT just "near Allahdin Hotel" alone)

REJECT these as incomplete (complete=false):
- "Near Allahdin Hotel" (landmark only, no street/area/number)
- "Chowk Fawara" (landmark only)
- "opposite XYZ Masjid" (landmark only, no area)
- Just a city name (e.g. "Lahore" alone)
- Single vague words: "home", "here", "same", "send it"
- Affirmations / payment / generic chatter with NO address detail: "yes", "ok", "sahi", "haan", "confirm", "cash on delivery", "COD", "send karo", "deliver kar do", "bhej do", "thik hai" — these are NOT addresses, even if a previous message contained one
- Fake / test / placeholder values

ACCEPT these as complete (complete=true):
- "House 12 Street 4 Gulshan-e-Iqbal" (has number + street + area)
- "Near Allahdin Hotel Main Bazaar Road" (landmark + street)
- "Mohalla Islamia Gali 2" (area + street)
- "Plot 7 near UBL Bank" (has number + landmark)
- "DHA Phase 5 Block D" (area + block)

Return JSON ONLY in this exact schema:
{ "complete": boolean, "full_address": string, "city": string }

Rules:
- "complete" = true ONLY if the address has a city/town + a house/plot number OR a street/gali name OR an area/mohalla/block/sector. A landmark alone (near X, opposite X, chowk X) without any of these is NOT complete.
- "full_address" must be a single line containing all the detail parts the customer provided (house/flat, street, block/sector/phase, area, landmark) — DO NOT include the city.
- "city" must be the city/town/village name in English/Latin script (e.g. "Karachi", "Lahore", "Peshawar", "Batagram", "Layyah").
- For obvious fake/test/placeholder values or single vague words, return complete=false.
- DO NOT invent details. Only use what the customer explicitly said anywhere in the conversation (history + latest message).`;

  // CRITICAL: Only feed CUSTOMER messages to the extractor. If we include
  // assistant turns, the AI will read back the address the bot echoed (e.g.
  // "Should we deliver to: <stored address>?") and treat it as customer-
  // provided, then a bare "YES" reply will look like a complete address and
  // auto-confirm the order. The customer must have ACTUALLY typed address
  // details themselves.
  const customerHistory = history.filter((h) => h.role === "user");
  const extractMessages = [
    { role: "system", content: extractPrompt },
    ...customerHistory.slice(-10),
    { role: "user", content: customerText },
  ];

  const exUrl = "https://api.openai.com/v1/chat/completions";

  const exResp = await fetch(exUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: extractMessages,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    }),
  });
  if (!exResp.ok) {
    errLog("address-extract openai err", exResp.status);
    return;
  }
  const exJson = await exResp.json();
  const raw = exJson.choices?.[0]?.message?.content?.trim() || "{}";
  let parsed: { complete?: boolean; full_address?: string; city?: string } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    log("address-extract: invalid JSON", raw.slice(0, 200));
    return;
  }

  if (!parsed.complete || !parsed.full_address || !parsed.city) {
    log("address-extract: incomplete", parsed);
    return;
  }

  // Match city to ORIO cache (case-insensitive, trimmed). City matching is
  // NON-BLOCKING: if no match, we still confirm the order using the raw city
  // text the customer provided — admins can fix it later.
  const wanted = parsed.city.trim().toLowerCase();
  let matchedCity = cityNames.find((c: string) => c.toLowerCase() === wanted);
  if (!matchedCity) {
    matchedCity = cityNames.find((c: string) => {
      const lc = c.toLowerCase();
      return lc.includes(wanted) || wanted.includes(lc);
    });
  }
  const finalCity = matchedCity || parsed.city.trim();
  if (!matchedCity) {
    log("address-extract: city not in ORIO cache, using raw", parsed.city);
  }

  // Snapshot before for history (capture original values BEFORE any update)
  const trackedFields = [
    "confirmation_status",
    "customer_address",
    "customer_city",
    "delivery_status",
    "shipping_status",
  ];
  const before: Record<string, any> = {};
  for (const f of trackedFields) before[f] = order[f] ?? null;

  // STEP 1: Update address + city FIRST and wait for it to commit.
  // This guarantees that any downstream consumer (ORIO sync, triggers, etc.)
  // that reads the order after confirmation will see the new address — never
  // the stale one.
  const newAddress = parsed.full_address.trim();
  const addressUpdate: Record<string, any> = {
    customer_address: newAddress,
    customer_city: finalCity,
  };
  const { error: addrErr } = await admin
    .from("orders")
    .update(addressUpdate)
    .eq("order_id", order.order_id);
  if (addrErr) {
    errLog("address-extract: address update failed", addrErr);
    return;
  }

  // STEP 2: Re-fetch to confirm the address is persisted, then confirm the
  // order (and optionally trigger auto-book to ORIO). Doing this as a separate
  // statement means the row's address column is already committed when the
  // booked status is set.
  const { data: refreshed } = await admin
    .from("orders")
    .select("customer_address, customer_city")
    .eq("order_id", order.order_id)
    .maybeSingle();
  if (!refreshed || refreshed.customer_address !== newAddress) {
    errLog("address-extract: address not persisted, aborting confirmation", {
      expected: newAddress,
      got: refreshed?.customer_address,
    });
    return;
  }

  // STEP 3: Confirm + (optionally) book for shipping.
  // If the order is ALREADY confirmed (e.g. customer clicked the confirm
  // button before sending the address), we keep the existing confirmation
  // metadata but still trigger booking if it hasn't shipped yet — and we
  // always make sure whatsapp_status reflects the final state.
  const settings = await getSettings();
  const wasAlreadyConfirmed = order.confirmation_status === "confirmed";
  const confirmUpdate: Record<string, any> = {
    whatsapp_status: "confirmed",
    whatsapp_last_reply_at: new Date().toISOString(),
  };
  if (!wasAlreadyConfirmed) {
    confirmUpdate.confirmation_status = "confirmed";
    confirmUpdate.confirmation_channel = "whatsapp";
    confirmUpdate.confirmed_at = new Date().toISOString();
  }
  if (settings?.auto_book_shipping) {
    // Only (re)book if not already booked/shipped/delivered.
    const ds = String(order.delivery_status ?? "").toLowerCase();
    const blockBooking = ["booked", "shipped", "in_transit", "delivered", "returned"].includes(ds);
    if (!blockBooking) {
      confirmUpdate.delivery_status = "booked";
      confirmUpdate.shipping_status = "Booked";
    }
  }
  const { error: updErr } = await admin
    .from("orders")
    .update(confirmUpdate)
    .eq("order_id", order.order_id);
  if (updErr) {
    errLog("address-extract: confirmation update failed", updErr);
    return;
  }

  await admin
    .from("whatsapp_conversations")
    .update({
      status: "confirmed",
      outcome: "confirmed",
      pending_button_intent: null, // Clear: AI gating finalized via confirm.
      updated_at: new Date().toISOString(),
    })
    .eq("id", conv.id);

  // Combined "after" for history logging
  const after = { ...addressUpdate, ...confirmUpdate };
  await logOrderHistory({
    orderId: order.order_id,
    actionType: "ai_confirm",
    role: "ai",
    before,
    after,
    fields: trackedFields,
  });

  log("address-extract: auto-confirmed", {
    order: order.order_id,
    city: finalCity,
    matched: !!matchedCity,
    addr_len: parsed.full_address.length,
  });
}

// ---------------------------------------------------------------------------
// Sweep: find conversations where the customer's last message went unanswered
// (no outbound reply after the last inbound) and trigger AI continuation so
// the AI keeps the conversation flowing automatically.
// ---------------------------------------------------------------------------
async function sweepUnansweredConversations(opts?: { limit?: number; minSilenceSec?: number }) {
  const limit = Math.max(1, Math.min(50, opts?.limit ?? 20));
  const minSilenceSec = Math.max(30, opts?.minSilenceSec ?? 90);
  const cutoffIso = new Date(Date.now() - minSilenceSec * 1000).toISOString();

  // Candidate convs: AI enabled, had a recent inbound (last 24h) and the
  // last activity is older than the silence threshold. We filter on
  // last_message_at (any activity) — NOT last_reply_at — so convs where
  // the customer sent the final message but the AI never replied still
  // get picked up. The per-iteration check below ensures the very last
  // message was inbound.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: convs } = await admin
    .from("whatsapp_conversations")
    .select("id, order_id, customer_phone, ai_enabled, last_reply_at, last_message_at")
    .eq("ai_enabled", true)
    .gte("last_message_at", since24h)
    .lte("last_message_at", cutoffIso)
    .order("last_message_at", { ascending: false })
    .limit(limit * 3); // overshoot then filter

  let triggered = 0;
  for (const conv of convs ?? []) {
    if (triggered >= limit) break;
    try {
      // Last message in conversation must be inbound (direction=in)
      const { data: lastMsg } = await admin
        .from("whatsapp_messages")
        .select("direction, body, message_type, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastMsg || lastMsg.direction !== "in") continue;
      // Silence threshold based on lastMsg.created_at
      if (new Date(lastMsg.created_at).getTime() > Date.now() - minSilenceSec * 1000) continue;

      // Skip if any outbound was sent after the last inbound
      const { data: laterOut } = await admin
        .from("whatsapp_messages")
        .select("id")
        .eq("conversation_id", conv.id)
        .eq("direction", "out")
        .gt("created_at", lastMsg.created_at)
        .limit(1)
        .maybeSingle();
      if (laterOut) continue;

      // Skip if there's a paused automation run waiting on this conversation
      const { data: pausedRun } = await admin
        .from("whatsapp_automation_runs")
        .select("id")
        .eq("conversation_id", conv.id)
        .eq("status", "waiting_reply")
        .limit(1)
        .maybeSingle();
      if (pausedRun) continue;

      // Resolve order if any
      let order: any = null;
      if (conv.order_id) {
        const { data: o } = await admin
          .from("orders")
          .select("*")
          .eq("order_id", conv.order_id)
          .maybeSingle();
        order = o ?? null;
      }

      // Aggregate recent inbound messages (last 5 min) so the AI sees full context
      const sinceBatch = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: batched } = await admin
        .from("whatsapp_messages")
        .select("body, message_type, created_at, direction")
        .eq("conversation_id", conv.id)
        .eq("direction", "in")
        .gte("created_at", sinceBatch)
        .order("created_at", { ascending: true });
      const combinedText = (batched ?? [])
        .map((m: any) => m.body || `[${m.message_type}]`)
        .filter(Boolean)
        .join("\n") || lastMsg.body || `[${lastMsg.message_type}]`;

      log("sweep: ai-continue triggered", { conv: conv.id, order: order?.order_id ?? null });
      await aiContinueReply({ conv, order, customerText: combinedText });
      triggered++;
    } catch (e) {
      errLog("sweep iteration failed", (e as Error).message);
    }
  }
  return { scanned: convs?.length ?? 0, triggered };
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
    // Internal sweep mode — invoked by pg_cron via service role JWT.
    const url = new URL(req.url);
    if (url.searchParams.get("sweep") === "1") {
      const result = await sweepUnansweredConversations({});
      log("sweep done", result);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Body-based sweep trigger (e.g., supabase.functions.invoke("whatsapp-webhook", { body: { sweep: true } }))
    if (body?.sweep === true) {
      const result = await sweepUnansweredConversations({
        limit: body?.limit,
        minSilenceSec: body?.min_silence_sec,
      });
      log("sweep done (body)", result);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
