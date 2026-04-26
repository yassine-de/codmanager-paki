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
        // Unlinked thread — safe to claim if we have an order.
        reuse = !!order;
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
      errLog("conversation insert failed", error);
      return { conv: null, order };
    }
    conv = inserted;
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
      const shouldContinueWithAI =
        !aiDisabledForConv &&
        (
          (
            m.type === "text" &&
            !outcome &&
            (!resumedRun || addressIncomplete || orderNotConfirmed)
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
                log("ai-continue: dedup window hit, skipping", convId, recentOut.created_at);
                return;
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

            await aiContinueReply({ conv, order: freshOrder, customerText: combinedText || bodyText });
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
// ---------------------------------------------------------------------------
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
  const mediaObj: any = { link: imageUrl };
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
    payload: { ...payload, _ai_continuation: true, _ai_tool: "send_product_image" },
    meta_message_id: metaMsgId,
    status: ok ? "sent" : "failed",
    error_message: ok ? null : JSON.stringify(respJson).slice(0, 500),
  });
  if (!ok) errLog("ai send_product_image failed", respJson);
  else log("ai send_product_image sent", { conv: conversationId });
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
    .select("direction,body,message_type,created_at")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(15);
  const history = (msgs ?? []).reverse().map((m: any) => ({
    role: m.direction === "in" ? "user" : "assistant",
    content: m.body || `[${m.message_type}]`,
  }));

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
  // Validate that the stored address looks like a REAL, DETAILED deliverable
  // address. The goal is NOT to require every part (house+street+area+city),
  // but to ensure the address is detailed enough for a courier to find it AND
  // is not obviously fake / test / placeholder data.
  const isAddressDeliverable = (addr?: string | null): boolean => {
    if (!addr) return false;
    const raw = String(addr).trim();
    if (raw.length < 10) return false;
    const lower = raw.toLowerCase();
    // Reject common fake / test / placeholder patterns
    const fakePattern = /\b(test|testing|tester|fake|dummy|sample|example|n\/?a|none|null|xxx+|asdf+|qwerty|aaaa+|placeholder|abc+|address here|adress|same|here)\b/i;
    if (fakePattern.test(lower)) return false;
    // Need at least 2 distinct word tokens (avoid single-word addresses)
    const tokens = raw.split(/\s+/).filter((w) => w.length > 1);
    if (tokens.length < 2) return false;
    // Detail signal: either contains a digit (house/flat/plot/street #) OR
    // contains a recognizable street/area keyword. One of these is enough.
    const hasNumber = /\d/.test(raw);
    const streetKeyword = /\b(house|flat|plot|street|road|st\.?|rd\.?|lane|block|sector|phase|town|colony|mohalla|near|opposite|main|gali|chowk|bazar|bazaar|market|society|villa|apartment|building|floor|park|stop|stand|gate|tower|plaza|گھر|مکان|گلی|سڑک|محلہ|فلیٹ|بلاک|سیکٹر)\b/i;
    if (!hasNumber && !streetKeyword.test(lower)) return false;
    return true;
  };
  const hasStoredAddress =
    !!order &&
    isAddressDeliverable(order.customer_address) &&
    !!order.customer_city &&
    String(order.customer_city).trim().length > 0;
  const addressRule = order && !hasStoredAddress
    ? `\n\nIMPORTANT: The customer's delivery address is MISSING, FAKE, TEST data, or NOT detailed enough for a courier to find (current value: "${order.customer_address ?? "(none)"}", city: "${order.customer_city ?? "(none)"}"). A deliverable address must be DETAILED — for example a house/flat/plot number, OR a recognizable street/lane/block/sector/landmark, plus a city. The parts do not all need to be present, but the address as a whole must be specific enough for a delivery courier. Do NOT close the conversation and DO NOT confirm delivery to a vague, single-word, test, or placeholder address. Politely (in the customer's language) explain that the courier needs a more detailed address and ask the customer to share something specific: a house/flat number, street name, block/sector, or a clear nearby landmark in their area. Keep asking in follow-ups until the address is detailed and real. Never accept words like "test", "fake", "same", "here", or just a city name as a valid address.\n\nOnly once the customer provides a detailed, real address, thank them briefly and confirm the order will be delivered. The system will auto-confirm in the background.`
    : order && hasStoredAddress
    ? `\n\nIMPORTANT: The customer ALREADY has a detailed delivery address on file:\n  📍 ${order.customer_address}, ${order.customer_city}\n\nDo NOT ask the customer for their address again. Instead:\n- Confirm the existing address by reading it back briefly and ask if it is correct (e.g. "Should we deliver to: <address>, <city>? Reply YES to confirm or send a new address.").\n- If the customer replies with affirmation (yes / ok / sahi / 7aja / na3am / oui / ✅ / thumbs up / "send it" / "deliver" etc.) OR sends only a city name that matches the stored city, treat the existing address as confirmed and tell them their order is being processed for delivery. The system will auto-confirm in the background.\n- Only ask for a new address if the customer explicitly says the stored address is wrong or sends new address details.`
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
    ? `\n\nPENDING CUSTOMER INTENT (from a button they clicked):\n- The customer pressed "${pendingIntent.button_text}" which means they want to: ${pendingIntent.intent === "confirm" ? "CONFIRM the order. You must validate that we have a complete & deliverable address before the system finalizes the confirmation. If the address is already on file and detailed, just acknowledge and the system will auto-confirm. If not, ask for the missing details politely." : pendingIntent.intent === "cancel" ? "CANCEL the order. Follow the CANCELLATION HANDLING rules above — try to understand WHY and rescue the sale. Do NOT acknowledge the cancellation as final yourself." : "request more INFO. Answer their questions accurately."}`
    : "";

  const baseSys = aiSettings.system_prompt || "You are a helpful WhatsApp sales assistant.";
  const sysPrompt =
    `${baseSys}\n\nBrand tone: ${aiSettings.brand_tone || "friendly"}.\nLanguage rules: ${aiSettings.language_rules || ""}\n\nKeep replies short (about ${aiSettings.response_lines ?? 3} line(s)). Do not invent facts.${orderCtx}${productContext}${addressRule}${imageRule}${cancelRule}${pendingIntentRule}`;

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

  const extractPrompt = `You are an address-extraction assistant. Given a WhatsApp conversation between a customer and a sales agent in Pakistan, extract the customer's delivery address ONLY if it is detailed enough for a courier to find.

What "detailed enough" means:
- The address must contain a city (a real Pakistan city) AND
- At least ONE strong location signal: a house/flat/plot/shop number, OR a specific street/lane/road name, OR a clear block/sector/phase identifier, OR a recognizable named landmark (mosque, school, bazaar, plaza, etc.) tied to a specific area.
- A combination of these signals is even better, but not all are required.

Return JSON ONLY in this exact schema:
{ "complete": boolean, "full_address": string, "city": string }

Rules:
- "complete" = true ONLY if the address is specific enough for a courier (a single named landmark with no area/city is NOT enough; a city alone is NOT enough).
- "full_address" must be a single line containing all detail parts the customer provided (house/flat, street, block/sector, area, landmark) — DO NOT include the city.
- "city" must be the city name in English/Latin script (e.g. "Karachi", "Lahore").
- REJECT obvious fake / test / placeholder values such as "test address", "fake", "dummy", "sample", "abc", "xyz", "n/a", "asdf", random keyboard mashing, or a single word. For these, return complete=false.
- REJECT vague answers like just "my home", "same as before", "here", "send it" or only a city name.
- If the address is missing, vague, fake, or not detailed enough, return { "complete": false, "full_address": "", "city": "" }.
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

  // Candidate convs: AI enabled, had a recent inbound, not too stale (last 24h).
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: convs } = await admin
    .from("whatsapp_conversations")
    .select("id, order_id, customer_phone, ai_enabled, last_reply_at, last_message_at")
    .eq("ai_enabled", true)
    .gte("last_reply_at", since24h)
    .lte("last_reply_at", cutoffIso)
    .order("last_reply_at", { ascending: false })
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
