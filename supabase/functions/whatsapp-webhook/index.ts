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

  // Conversation lookup: prefer order link, fallback to ANY phone variant.
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
      .in("customer_phone", phoneVariants)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    conv = data;
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

      // AI continuation: keep the conversation alive after automation flows.
      // Trigger when:
      //  - this is a free-text message (not a button outcome), AND
      //  - either no automation run was resumed, OR the order still needs
      //    info (e.g. incomplete delivery address) — meaning the customer's
      //    reply went into a now-finished automation step but no further
      //    automation node will reply, so the AI must take over.
      const addressIncomplete =
        !!order && (!order.customer_address || String(order.customer_address).trim().length < 10);
      const aiDisabledForConv = conv?.ai_enabled === false;
      const shouldContinueWithAI =
        m.type === "text" &&
        !outcome &&
        !aiDisabledForConv &&
        (!resumedRun || addressIncomplete);

      if (aiDisabledForConv) {
        log("ai-continue: disabled for conversation", conv?.id);
      }

      if (shouldContinueWithAI) {
        try {
          // Small delay so the resumed runner (if any) finishes its DB writes first.
          if (resumedRun) await new Promise((r) => setTimeout(r, 1500));
          await aiContinueReply({ conv, order, customerText: bodyText });
        } catch (e) {
          errLog("ai continuation failed", (e as Error).message);
        }
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
  }
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
    .select("direction,body,message_type,created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(15);
  const history = (msgs ?? []).reverse().map((m: any) => ({
    role: m.direction === "in" ? "user" : "assistant",
    content: m.body || `[${m.message_type}]`,
  }));

  const orderCtx = order
    ? `\n\nOrder context:\n- Order ID: ${order.order_id}\n- Customer: ${order.customer_name}\n- Product: ${order.product_name}\n- Quantity: ${order.quantity}\n- Total: ${order.total_amount} PKR\n- City: ${order.customer_city}\n- Address: ${order.customer_address ?? "(not provided)"}`
    : "";
  const addressRule = order && (!order.customer_address || String(order.customer_address).trim().length < 10)
    ? `\n\nIMPORTANT: The customer's delivery address is missing or incomplete. Do NOT close the conversation. Politely ask for the full address (house/flat number, street, area/landmark, and city) in the customer's language. Keep asking in follow-ups until you receive a complete, deliverable address.\n\nWhen the customer provides a complete address (with house/flat, street, area, AND city), thank them briefly and confirm the order will be delivered. The system will auto-confirm in the background.`
    : "";
  const baseSys = aiSettings.system_prompt || "You are a helpful WhatsApp sales assistant.";
  const sysPrompt =
    `${baseSys}\n\nBrand tone: ${aiSettings.brand_tone || "friendly"}.\nLanguage rules: ${aiSettings.language_rules || ""}\n\nKeep replies short (about ${aiSettings.response_lines ?? 3} line(s)). Do not invent facts.${orderCtx}${addressRule}`;

  const rawModel = aiSettings.model || "gpt-4o-mini";
  // Always OpenAI: strip provider prefix; map gemini → gpt-4o-mini.
  const model = rawModel.startsWith("openai/")
    ? rawModel.replace("openai/", "")
    : rawModel.includes("gemini")
    ? "gpt-4o-mini"
    : rawModel;

  const aiUrl = "https://api.openai.com/v1/chat/completions";

  const aiResp = await fetch(aiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: sysPrompt }, ...history],
      temperature: aiSettings.temperature ?? 0.7,
      max_tokens: aiSettings.max_tokens ?? 400,
    }),
  });
  if (!aiResp.ok) {
    const t = await aiResp.text();
    errLog("ai-continue openai err", aiResp.status, t.slice(0, 200));
    return;
  }
  const aiJson = await aiResp.json();
  const reply: string = aiJson.choices?.[0]?.message?.content?.trim() || "";
  if (!reply) {
    log("ai-continue: empty reply");
    return;
  }

  const settings = await getSettings();
  if (!settings) return;
  const accessToken = (settings as any).access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
  if (!accessToken) {
    errLog("ai-continue: no whatsapp access token");
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

  // Skip if order already has a long address & is already confirmed
  if (order.confirmation_status === "confirmed") return;

  // Load ORIO cities for matching
  const { data: cities } = await admin
    .from("orio_cities_cache")
    .select("city_name");
  const cityNames = (cities ?? []).map((c: any) => c.city_name);
  if (cityNames.length === 0) {
    log("address-extract: no orio cities cached, skipping");
    return;
  }

  const extractPrompt = `You are an address-extraction assistant. Given a WhatsApp conversation between a customer and a sales agent in Pakistan, extract the customer's complete delivery address ONLY if all required parts are present.

Required parts:
- house_or_flat (house/flat/shop number)
- street (street name or block)
- area (neighborhood / sector / landmark)
- city (must be a real Pakistan city)

Return JSON ONLY in this exact schema:
{ "complete": boolean, "full_address": string, "city": string }

Rules:
- "complete" = true only if house/flat, street, AND area are all present (city is mandatory too).
- "full_address" must be a single line combining house/flat + street + area (DO NOT include the city).
- "city" must be the city name in English/Latin script (e.g. "Karachi", "Lahore").
- If anything is missing or vague, return { "complete": false, "full_address": "", "city": "" }.
- DO NOT invent details. Only use what the customer explicitly said.`;

  const extractMessages = [
    { role: "system", content: extractPrompt },
    ...history.slice(-10),
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

  // STEP 3: Confirm + (optionally) book for shipping
  const settings = await getSettings();
  const confirmUpdate: Record<string, any> = {
    confirmation_status: "confirmed",
    confirmation_channel: "whatsapp",
    confirmed_at: new Date().toISOString(),
    whatsapp_status: "confirmed",
    whatsapp_last_reply_at: new Date().toISOString(),
  };
  if (settings?.auto_book_shipping) {
    confirmUpdate.delivery_status = "booked";
    confirmUpdate.shipping_status = "Booked";
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
    .update({ status: "confirmed", outcome: "confirmed", updated_at: new Date().toISOString() })
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
