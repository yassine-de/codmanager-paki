// @ts-nocheck
// WhatsApp Automation Runner
// Executes whatsapp_automations flows (nodes + edges).
//
// Modes:
//  - { trigger_type, order_id }                           → start new run(s)
//  - { resume: true, run_id, button_index? | reply_text? } → continue paused run
//  - { tick: true }                                       → wake delayed runs (cron)
//
// Node types supported: send_template, send_message, ai_step, condition, delay, add_tag, remove_tag.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const log = (...a: unknown[]) => console.log("[wa-runner]", ...a);
const errLog = (...a: unknown[]) => console.error("[wa-runner]", ...a);

interface FlowNode {
  id: string;
  type: string;
  data: Record<string, any>;
}
interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

function normalizePhone(phone: string, defaultCC: string) {
  let p = (phone || "").replace(/\D/g, "");
  if (!p) return "";
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = defaultCC + p.slice(1);
  return p;
}

function render(template: string, vars: Record<string, any>) {
  return (template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

async function getSettings() {
  const { data } = await admin
    .from("whatsapp_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  return data;
}

function findNextNode(edges: FlowEdge[], fromId: string, handle?: string) {
  return edges.find(
    (e) =>
      e.source === fromId &&
      (handle === undefined ? !e.sourceHandle : e.sourceHandle === handle),
  );
}

async function appendLog(runId: string, entry: any) {
  const { data } = await admin
    .from("whatsapp_automation_runs")
    .select("steps_log")
    .eq("id", runId)
    .maybeSingle();
  const log = Array.isArray(data?.steps_log) ? data!.steps_log : [];
  log.push({ at: new Date().toISOString(), ...entry });
  await admin
    .from("whatsapp_automation_runs")
    .update({ steps_log: log })
    .eq("id", runId);
}

// Send WhatsApp template via Meta Cloud API directly (admin context, no auth header).
async function sendTemplate(args: {
  templateId: string;
  to: string;
  vars: Record<string, any>;
  conversationId: string | null;
  orderId: string | null;
  runId: string;
}) {
  const { templateId, to, vars, conversationId, orderId, runId } = args;
  const settings = await getSettings();
  if (!settings) throw new Error("WhatsApp settings missing");
  if (!settings.integration_enabled || !settings.sending_enabled)
    throw new Error("Sending disabled");

  const accessToken = (settings as any).access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
  if (!accessToken) throw new Error("Access token missing");

  const { data: tpl } = await admin
    .from("whatsapp_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (!tpl) throw new Error("Template not found");

  const templateName = tpl.meta_template_name || tpl.name;
  const language = tpl.language || "en_US";

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

  // Body parameters: detect {{var}} placeholders in the template body in the
  // order they appear, and map each to a value from `vars`. Meta requires the
  // parameter count to match the template definition exactly — otherwise it
  // returns "(#132000) Number of parameters does not match the expected number
  // of params".
  const body = String(tpl.body || "");
  const placeholders: string[] = [];
  const re = /\{\{\s*([\w]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    placeholders.push(m[1]);
  }
  if (placeholders.length > 0) {
    const positionalFallback = [
      String(vars.customer_name ?? "").trim(),
      String(vars.product_name ?? "").trim(),
      String(vars.price ?? "").trim(),
      String(vars.city ?? "").trim(),
      String(vars.order_id ?? "").trim(),
    ];
    const finalFallback = positionalFallback.find(Boolean) || "-";
    const resolvePlaceholder = (name: string, idx: number) => {
      const raw = vars[name];
      let val = raw == null ? "" : String(raw).trim();
      const lower = String(name).toLowerCase();
      if (!val && (lower.includes("customer") || lower === "name")) val = String(vars.customer_name ?? "").trim();
      else if (!val && lower.includes("product")) val = String(vars.product_name ?? "").trim();
      else if (!val && (lower.includes("amount") || lower.includes("price") || lower.includes("total"))) val = String(vars.price ?? "").trim();
      else if (!val && lower.includes("city")) val = String(vars.city ?? "").trim();
      else if (!val && lower.includes("order")) val = String(vars.order_id ?? "").trim();
      const varMatch = /^var_(\d+)$/i.exec(name);
      if (!val && varMatch) val = positionalFallback[Math.max(0, Number(varMatch[1]) - 1)] || "";
      if (!val) val = positionalFallback[idx] || finalFallback;
      return val;
    };
    components.push({
      type: "body",
      parameters: placeholders.map((name, idx) => ({
        type: "text",
        text: resolvePlaceholder(name, idx),
      })),
    });
  }

  const payload: any = {
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
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const respJson = await resp.json();
  const ok = resp.ok;
  const metaMsgId = ok ? respJson?.messages?.[0]?.id : null;

  const previewVars = {
    ...vars,
    ...Object.fromEntries(placeholders.map((name, idx) => {
      const values = [
        String(vars.customer_name ?? "").trim(),
        String(vars.product_name ?? "").trim(),
        String(vars.price ?? "").trim(),
        String(vars.city ?? "").trim(),
        String(vars.order_id ?? "").trim(),
      ];
      return [name, vars[name] ?? values[Math.max(0, (/^var_(\d+)$/i.exec(name)?.[1] ? Number(/^var_(\d+)$/i.exec(name)?.[1]) - 1 : idx))] ?? values[idx] ?? "-"];
    })),
  };
  const previewBody = render(tpl.body || `[template: ${templateName}]`, previewVars);

  if (conversationId) {
    await admin.from("whatsapp_messages").insert({
      conversation_id: conversationId,
      order_id: orderId,
      direction: "out",
      message_type: "template",
      body: previewBody,
      payload: { ...payload, _template_id: templateId, _automation_run_id: runId },
      meta_message_id: metaMsgId,
      status: ok ? "sent" : "failed",
      error_message: ok ? null : JSON.stringify(respJson).slice(0, 500),
    });
    if (ok) {
      const nowIso = new Date().toISOString();
      await admin
        .from("whatsapp_conversations")
        .update({
          last_message_at: nowIso,
          updated_at: nowIso,
          status: "awaiting_reply",
        })
        .eq("id", conversationId);
    }
  }
  if (!ok) throw new Error(`Meta send failed: ${JSON.stringify(respJson).slice(0, 300)}`);
  return { metaMsgId };
}

async function sendText(args: {
  body: string;
  to: string;
  conversationId: string | null;
  orderId: string | null;
  runId: string;
}) {
  const { body, to, conversationId, orderId, runId } = args;
  const settings = await getSettings();
  if (!settings) throw new Error("WhatsApp settings missing");
  const accessToken = (settings as any).access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
  if (!accessToken) throw new Error("Access token missing");

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body },
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

  if (conversationId) {
    await admin.from("whatsapp_messages").insert({
      conversation_id: conversationId,
      order_id: orderId,
      direction: "out",
      message_type: "text",
      body,
      payload: { ...payload, _automation_run_id: runId },
      meta_message_id: metaMsgId,
      status: ok ? "sent" : "failed",
      error_message: ok ? null : JSON.stringify(respJson).slice(0, 500),
    });
  }
  if (!ok) throw new Error(`Meta send failed: ${JSON.stringify(respJson).slice(0, 300)}`);
}

async function ensureConversation(order: any, normalizedPhone: string) {
  if (!order) return null;

  // 1) Prefer the conversation already linked to this exact order.
  const { data: byOrder } = await admin
    .from("whatsapp_conversations")
    .select("*")
    .eq("order_id", order.order_id)
    .maybeSingle();
  if (byOrder) return byOrder;

  // 2) Otherwise look for a prior conversation from this phone — but ONLY reuse
  //    it when its linked order is for the SAME product. Different product on
  //    the same phone → keep threads separate so the AI doesn't mix products.
  const digits = (normalizedPhone || "").replace(/\D/g, "");
  const withPlus = digits ? `+${digits}` : "";
  const localZero = digits.startsWith("92") ? `0${digits.slice(2)}` : digits;
  const phoneVariants = Array.from(
    new Set([normalizedPhone, digits, withPlus, localZero].filter(Boolean)),
  );
  if (phoneVariants.length > 0) {
    const { data: candidates } = await admin
      .from("whatsapp_conversations")
      .select("*")
      .in("customer_phone", phoneVariants)
      .order("created_at", { ascending: false })
      .limit(10);

    for (const cand of candidates ?? []) {
      let reuse = false;
      if (!cand.order_id) {
        // Unlinked thread — safe to claim for this order.
        reuse = true;
      } else {
        const { data: prevOrder } = await admin
          .from("orders")
          .select("product_name")
          .eq("order_id", cand.order_id)
          .maybeSingle();
        if (
          prevOrder?.product_name &&
          order.product_name &&
          prevOrder.product_name.trim().toLowerCase() === order.product_name.trim().toLowerCase()
        ) {
          reuse = true;
        }
      }
      if (reuse) {
        await admin
          .from("whatsapp_conversations")
          .update({
            order_id: order.order_id,
            customer_name: order.customer_name ?? cand.customer_name,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cand.id);
        return { ...cand, order_id: order.order_id };
      }
    }
    // No same-product match → fall through and create a new conversation.
  }

  // 3) No existing conversation — create one.
  const { data: ins, error } = await admin
    .from("whatsapp_conversations")
    .insert({
      order_id: order.order_id,
      customer_phone: normalizedPhone,
      customer_name: order.customer_name ?? null,
      status: "pending",
    })
    .select()
    .single();
  if (error) {
    errLog("conversation insert failed", error);
    return null;
  }
  return ins;
}

function evaluateCondition(node: FlowNode, ctx: { order: any }) {
  const { field, op, value } = node.data ?? {};
  const fv = field ? (ctx.order?.[field] ?? null) : null;
  const v = value ?? "";
  const fvStr = fv == null ? "" : String(fv);
  switch (op) {
    case "eq":
    case "equals":
      return fvStr === String(v);
    case "neq":
      return fvStr !== String(v);
    case "contains":
      return fvStr.toLowerCase().includes(String(v).toLowerCase());
    case "in":
      return String(v).split(",").map((s) => s.trim()).includes(fvStr);
    default:
      return Boolean(fv);
  }
}

async function executeFlow(args: {
  runId: string;
  automation: any;
  order: any | null;
  conversation: any | null;
  startNodeId: string;
}) {
  const { runId, automation, order, conversation, startNodeId } = args;
  const nodes: FlowNode[] = (automation.nodes as any) ?? [];
  const edges: FlowEdge[] = (automation.edges as any) ?? [];

  const settings = await getSettings();
  const defaultCC = settings?.default_country_code || "92";
  const normalizedPhone = normalizePhone(order?.customer_phone || conversation?.customer_phone || "", defaultCC);

  const vars = {
    customer_name: order?.customer_name ?? "",
    product_name: order?.product_name ?? "",
    price: order?.total_amount ?? "",
    city: order?.customer_city ?? "",
    address: order?.customer_address ?? "",
    order_id: order?.order_id ?? "",
    quantity: order?.quantity ?? "",
  };

  let currentId: string | null = startNodeId;
  let safety = 0;
  while (currentId && safety++ < 50) {
    const node = nodes.find((n) => n.id === currentId);
    if (!node) {
      await appendLog(runId, { type: "error", message: `node not found: ${currentId}` });
      break;
    }

    try {
      if (node.type === "send_template") {
        const tplId = node.data?.template_id;
        if (!tplId) throw new Error("send_template missing template_id");
        if (!normalizedPhone) throw new Error("Customer phone invalid");
        await sendTemplate({
          templateId: tplId,
          to: normalizedPhone,
          vars,
          conversationId: conversation?.id ?? null,
          orderId: order?.order_id ?? null,
          runId,
        });
        await appendLog(runId, { type: "send_template", node_id: node.id, template_id: tplId });

        // ── Switch-to-agent timer ─────────────────────────────────────────
        // Only for new_order trigger when the automation has it enabled.
        // We schedule the deadline once (don't reschedule on subsequent templates).
        try {
          const triggerType = automation?.trigger_type;
          const sw = (automation?.trigger_config as any)?.switch_to_agent;
          if (
            triggerType === "new_order" &&
            sw?.enabled &&
            order?.order_id &&
            order?.confirmation_status === "new_wts" &&
            !order?.agent_switch_scheduled_at
          ) {
            const value = Math.max(1, Number(sw.value) || 30);
            const unit = sw.unit === "hours" ? "hours" : "minutes";
            const ms = unit === "hours" ? value * 3600_000 : value * 60_000;
            const deadline = new Date(Date.now() + ms).toISOString();
            await admin
              .from("orders")
              .update({ agent_switch_scheduled_at: deadline })
              .eq("order_id", order.order_id);
            order.agent_switch_scheduled_at = deadline;
            await appendLog(runId, {
              type: "switch_to_agent_scheduled",
              deadline,
              value,
              unit,
            });
          }
        } catch (e) {
          errLog("schedule switch-to-agent failed", e);
        }

        const buttons = Array.isArray(node.data?.template_buttons) ? node.data.template_buttons : [];
        if (buttons.length > 0) {
          await admin
            .from("whatsapp_automation_runs")
            .update({
              status: "waiting_reply",
              current_node_id: node.id,
            })
            .eq("id", runId);
          return;
        }
        currentId = findNextNode(edges, node.id)?.target ?? null;
      } else if (node.type === "send_message") {
        const text = render(String(node.data?.message ?? ""), vars);
        if (!text.trim()) throw new Error("send_message empty");
        if (!normalizedPhone) throw new Error("Customer phone invalid");
        await sendText({
          body: text,
          to: normalizedPhone,
          conversationId: conversation?.id ?? null,
          orderId: order?.order_id ?? null,
          runId,
        });
        await appendLog(runId, { type: "send_message", node_id: node.id });
        currentId = findNextNode(edges, node.id)?.target ?? null;
      } else if (node.type === "ai_step") {
        // Actually execute the AI: generate a reply with OpenAI and send it as text.
        const customPrompt = String(node.data?.prompt ?? "").trim();
        if (!normalizedPhone) throw new Error("Customer phone invalid");

        // SHORT-CIRCUIT (AB-861 fix): if this AI step's job is to collect a
        // delivery address but the order ALREADY has a deliverable address on
        // file AND has been auto-confirmed by applyOutcome, do NOT send a
        // redundant "please send your full detailed address" message. The
        // customer was just told the order is confirmed — asking for the
        // address again contradicts that and confuses them.
        const orderAlreadyConfirmed = order?.confirmation_status === "confirmed";
        const storedAddrOk = !!order && isAddressDeliverable(order.customer_address, order.customer_city);
        if (orderAlreadyConfirmed && storedAddrOk) {
          await appendLog(runId, { type: "ai_step", node_id: node.id, skipped: "order_confirmed_with_deliverable_address" });
          currentId = findNextNode(edges, node.id)?.target ?? null;
          continue;
        }

        // Load AI settings + key + history for context
        const { data: aiSettings } = await admin
          .from("whatsapp_ai_settings")
          .select("*")
          .eq("singleton", true)
          .maybeSingle();
        if (!aiSettings) throw new Error("AI settings missing");

        const { data: keyRow } = await admin
          .from("app_settings")
          .select("value")
          .eq("key", "openai_api_key")
          .maybeSingle();
        const apiKey = (keyRow?.value as string)?.trim() || Deno.env.get("OPENAI_API_KEY") || "";
        if (!apiKey) throw new Error("OpenAI API key not configured (AI Settings → Connection).");

        // Conversation history
        let history: any[] = [];
        if (conversation?.id) {
          const { data: msgs } = await admin
            .from("whatsapp_messages")
            .select("direction,body,message_type,created_at")
            .eq("conversation_id", conversation.id)
            .order("created_at", { ascending: false })
            .limit(15);
          history = (msgs ?? []).reverse().map((m: any) => ({
            role: m.direction === "in" ? "user" : "assistant",
            content: m.body || `[${m.message_type}]`,
          }));
        }

        // Build system prompt: node-level prompt overrides global if provided.
        const orderCtx = order
          ? `\n\nOrder context:\n- Order ID: ${order.order_id}\n- Customer: ${order.customer_name}\n- Product: ${order.product_name}\n- Quantity: ${order.quantity}\n- Total: ${order.total_amount} PKR\n- City: ${order.customer_city}\n- Address: ${order.customer_address ?? "(not provided)"}`
          : "";
        // Address-completion rule: explicit, deterministic signal so the AI
        // does NOT re-ask for an address that is already deliverable on file.
        const addressDeliverable = !!order && isAddressDeliverable(order.customer_address, order.customer_city);
        const addressRule = !order
          ? ""
          : addressDeliverable
          ? `\n\nADDRESS STATUS: The customer's stored address ("${order.customer_address}", ${order.customer_city}) is ALREADY detailed enough for delivery. DO NOT ask the customer to send their address again. Just send a short, warm confirmation that the order is being processed and the courier will contact them. Never write "please send your full address", "to ensure smooth delivery please send", or any equivalent.`
          : `\n\nADDRESS STATUS: The stored address ("${order.customer_address ?? "(none)"}", ${order.customer_city ?? "(none)"}) is missing or too vague for the courier. Politely ask the customer (in their language) for the FULL address: house/flat #, street, area/block, nearest landmark, and city. Keep asking in follow-ups until you receive a complete, deliverable address. Do NOT confirm the order yourself — the system will auto-confirm once the address is complete.`;
        // Resolve effective system prompt based on node-level mode:
        //  - instructions_mode = "general" → always use global AI Settings prompt
        //  - instructions_mode = "custom"  → use node prompt; mode "override" replaces, "append" extends global
        const instructionsMode = node.data?.instructions_mode === "custom" ? "custom" : "general";
        const promptMode = node.data?.prompt_mode === "append" ? "append" : "override";
        const globalPrompt = aiSettings.system_prompt || "You are a helpful WhatsApp sales assistant.";
        let baseSys: string;
        if (instructionsMode === "custom" && customPrompt) {
          baseSys = promptMode === "append"
            ? `${globalPrompt}\n\n--- Step-specific instructions ---\n${customPrompt}`
            : customPrompt;
        } else {
          baseSys = globalPrompt;
        }
        const sysPrompt =
          `${baseSys}\n\nBrand tone: ${aiSettings.brand_tone || "friendly"}.\nLanguage rules: ${aiSettings.language_rules || ""}\n\nKeep replies short (about ${aiSettings.response_lines ?? 3} line(s)). Do not invent facts.${orderCtx}${addressRule}`;

        // Normalize model → OpenAI compatible
        const rawModel = aiSettings.model || "gpt-4o-mini";
        const model = rawModel.startsWith("openai/")
          ? rawModel.replace("openai/", "")
          : rawModel.includes("gemini")
          ? "gpt-4o-mini"
          : rawModel;

        const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
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
          throw new Error(`OpenAI ${aiResp.status}: ${t.slice(0, 200)}`);
        }
        const aiJson = await aiResp.json();
        const reply: string = aiJson.choices?.[0]?.message?.content?.trim() || "";
        if (!reply) throw new Error("AI returned empty reply");

        await sendText({
          body: reply,
          to: normalizedPhone,
          conversationId: conversation?.id ?? null,
          orderId: order?.order_id ?? null,
          runId,
        });
        await appendLog(runId, { type: "ai_step", node_id: node.id, reply_len: reply.length });

        // Continue to next node (or pause to wait for customer reply if there's none)
        const nextEdge = findNextNode(edges, node.id);
        if (!nextEdge) {
          await admin
            .from("whatsapp_automation_runs")
            .update({ status: "waiting_reply", current_node_id: node.id })
            .eq("id", runId);
          return;
        }
        currentId = nextEdge.target;
      } else if (node.type === "delay") {
        const minutes = Number(node.data?.minutes ?? 0);
        if (minutes > 0) {
          const waitUntil = new Date(Date.now() + minutes * 60_000).toISOString();
          await admin
            .from("whatsapp_automation_runs")
            .update({
              status: "waiting_delay",
              current_node_id: node.id,
              wait_until: waitUntil,
            })
            .eq("id", runId);
          await appendLog(runId, { type: "delay", node_id: node.id, until: waitUntil });
          return;
        }
        currentId = findNextNode(edges, node.id)?.target ?? null;
      } else if (node.type === "condition") {
        const branch = evaluateCondition(node, { order }) ? "true" : "false";
        await appendLog(runId, { type: "condition", node_id: node.id, branch });
        currentId = findNextNode(edges, node.id, branch)?.target ?? null;
      } else if (node.type === "add_tag" || node.type === "remove_tag") {
        await appendLog(runId, { type: node.type, node_id: node.id });
        currentId = findNextNode(edges, node.id)?.target ?? null;
      } else {
        await appendLog(runId, { type: "skip_unknown", node_type: node.type, node_id: node.id });
        currentId = findNextNode(edges, node.id)?.target ?? null;
      }
    } catch (e) {
      const msg = (e as Error).message;
      errLog("node failed", node.id, msg);
      await appendLog(runId, { type: "error", node_id: node.id, message: msg });
      await admin
        .from("whatsapp_automation_runs")
        .update({
          status: "failed",
          error_message: msg,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
      
      return;
    }
  }

  await admin
    .from("whatsapp_automation_runs")
    .update({
      status: "completed",
      current_node_id: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);

  const { data: autoRow } = await admin
    .from("whatsapp_automations")
    .select("success_count")
    .eq("id", automation.id)
    .maybeSingle();
  await admin
    .from("whatsapp_automations")
    .update({
      success_count: (autoRow?.success_count ?? 0) + 1,
      last_run_at: new Date().toISOString(),
    })
    .eq("id", automation.id);
}

async function startNewRuns(triggerType: string, orderId: string) {
  const { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (!order) {
    log("order not found", orderId);
    return { started: 0 };
  }

  // For new_order trigger, only run if the order is routed to WhatsApp
  // (gating trigger sets confirmation_channel='whatsapp' when product has whatsapp_confirmation_enabled=true)
  if (triggerType === "new_order" && order.confirmation_channel !== "whatsapp") {
    log("order not routed to whatsapp channel, skipping automation", orderId, order.confirmation_channel);
    return { started: 0 };
  }

  const { data: autos } = await admin
    .from("whatsapp_automations")
    .select("*")
    .eq("trigger_type", triggerType)
    .eq("status", "active");
  if (!autos?.length) {
    log("no active automations for", triggerType);
    return { started: 0 };
  }

  const settings = await getSettings();
  const defaultCC = settings?.default_country_code || "92";
  const normalizedPhone = normalizePhone(order.customer_phone || "", defaultCC);
  const conv = await ensureConversation(order, normalizedPhone);

  let started = 0;
  for (const a of autos) {
    const nodes: FlowNode[] = (a.nodes as any) ?? [];
    if (!nodes.length) continue;
    const edges: FlowEdge[] = (a.edges as any) ?? [];
    const targetIds = new Set(edges.map((e) => e.target));
    const entry = nodes.find((n) => !targetIds.has(n.id)) ?? nodes[0];

    const { data: run, error } = await admin
      .from("whatsapp_automation_runs")
      .insert({
        automation_id: a.id,
        order_id: order.order_id,
        customer_phone: normalizedPhone,
        conversation_id: conv?.id ?? null,
        status: "running",
        current_node_id: entry.id,
        trigger_payload: { trigger_type: triggerType, order_id: orderId },
        steps_log: [],
      })
      .select()
      .single();
    if (error) {
      errLog("run insert failed", error);
      continue;
    }

    await admin
      .from("whatsapp_automations")
      .update({
        runs_count: (a.runs_count ?? 0) + 1,
        last_run_at: new Date().toISOString(),
      })
      .eq("id", a.id);

    await executeFlow({
      runId: run.id,
      automation: a,
      order,
      conversation: conv,
      startNodeId: entry.id,
    });
    started++;
  }
  return { started };
}

/**
 * Apply the per-button "action" configured on the from_template trigger.
 *
 * Action shape:
 *  - status: "no_change" | <confirmation_status>  (admin-mapped target)
 *  - ai_takeover: boolean                         (enable AI on the conversation)
 *  - ai_gate: "off" | "validate"                  (NEW)
 *      - "off"      → apply status immediately (legacy behavior).
 *      - "validate" → DO NOT apply status. Store the desired outcome as a
 *                     "pending_button_intent" on the conversation, force
 *                     ai_enabled=true, and let the AI engine drive the
 *                     conversation. The AI will only finalize the status
 *                     after validating address / handling cancel rescue.
 *  - intent_kind: "confirm" | "cancel" | "info"   (NEW, optional hint for AI)
 *
 * Logs to order_history only when the order status actually changes.
 */
async function applyButtonAction(opts: {
  action:
    | {
        status?: string;
        ai_takeover?: boolean;
        ai_gate?: "off" | "validate";
        intent_kind?: "confirm" | "cancel" | "info";
      }
    | undefined;
  order: any | null;
  conversationId: string | null;
  buttonText: string;
}) {
  const { action, order, conversationId, buttonText } = opts;
  if (!action) return;

  // Address-deliverable check (mirrors webhook's isAddressDeliverable).
  // Used to FORCE AI gating on confirm buttons when the address is incomplete,
  // regardless of admin-configured ai_gate setting. This prevents premature
  // order confirmation when the customer only gave a city / vague text.
  const isAddressDeliverable = (addr?: string | null, city?: string | null): boolean => {
    if (!addr) return false;
    if (!city || String(city).trim().length === 0) return false;
    const raw = String(addr).trim();
    if (raw.length < 12) return false;
    const lower = raw.toLowerCase();
    const fakePattern = /\b(test|testing|tester|fake|dummy|sample|example|n\/?a|none|null|xxx+|asdf+|qwerty|aaaa+|placeholder|abc+|address here|adress|same|here)\b/i;
    if (fakePattern.test(lower)) return false;
    const tokens = raw.split(/\s+/).filter((w) => w.length > 1);
    if (tokens.length < 3) return false;
    const hasNumber = /\d/.test(raw);
    const strongKeyword = /\b(house|flat|plot|shop\s*(?:no|number|#)?\s*\d|office\s*(?:no|number|#)?\s*\d|street\s*(?:no|number|#)?\s*\d|gali\s*(?:no|number|#)?\s*\d|block|sector|phase|apartment|building|floor|villa|tower|plaza)\b/i;
    const weakKeyword = /\b(shop|office|store|street|road|st\.?|rd\.?|lane|town|village|colony|mohalla|mahalla|gali|bazar|bazaar|market|society|park|stop|stand|gate|center|centre|care|hotel|masjid|mosque|school|college|university|hospital|clinic|bank|station|chowk|square|more|tehsil|tehseel|ward|union|abad|pura|nagar|kot|gunj|ganj|garh|wala|پور|آباد|گھر|مکان|گلی|سڑک|محلہ|فلیٹ|بلاک|سیکٹر|چوک|تحصیل|دکان)\b/gi;
    const landmarkIndicator = /\b(near|opposite|behind|front|side|adjacent|main|stop)\b/i;
    if (hasNumber && (strongKeyword.test(lower) || weakKeyword.test(lower) || landmarkIndicator.test(lower))) return true;
    if (hasNumber && tokens.length >= 4) return true;
    if (strongKeyword.test(lower)) return true;
    const weakHits = (lower.match(weakKeyword) || []).length;
    if (weakHits >= 2) return true;
    return false;
  };

  // Address-gating logic for confirm-buttons:
  //   • Stored address ALREADY deliverable → SKIP gate, confirm immediately
  //     (otherwise customer never replies and order stays stuck in
  //     pending_address forever, e.g. AB-369).
  //   • Address missing/weak → force AI gate to ask customer.
  const wantsConfirm =
    action.status === "confirmed" ||
    action.intent_kind === "confirm";
  const storedAddrDeliverable = !!order && isAddressDeliverable(order.customer_address, order.customer_city);
  const forceAddressGate = wantsConfirm && !!order && !storedAddrDeliverable;

  // CRITICAL: when the customer pressed a CONFIRM button AND the stored address
  // is already deliverable, NEVER gate. We confirm immediately. Otherwise we
  // would stash a pending_button_intent and rely on the AI / customer to send
  // a follow-up text that may never come, leaving the order stuck on WhatsApp
  // forever (AB-606).
  const skipGateForConfirmedAddress = wantsConfirm && storedAddrDeliverable;
  const aiGated = !skipGateForConfirmedAddress && (action.ai_gate === "validate" || forceAddressGate);
  const wantsTakeover = !skipGateForConfirmedAddress && (action.ai_takeover === true || aiGated);

  // 1) AI takeover (gated buttons always force takeover so AI drives the convo)
  if (conversationId && wantsTakeover) {
    await admin
      .from("whatsapp_conversations")
      .update({ ai_enabled: true })
      .eq("id", conversationId);
  }

  if (!order) return;

  const status = action.status;
  const hasMappedStatus = !!status && status !== "no_change";

  // 2) AI-gated path: stash the intent, do NOT change order status yet.
  if (aiGated && conversationId) {
    const intentKind =
      action.intent_kind ||
      (status === "confirmed"
        ? "confirm"
        : status === "cancelled" || status === "canceled"
        ? "cancel"
        : "info");

    const pending = {
      intent: intentKind,
      mapped_status: hasMappedStatus ? status : null,
      button_text: buttonText,
      created_at: new Date().toISOString(),
    };
    await admin
      .from("whatsapp_conversations")
      .update({ pending_button_intent: pending })
      .eq("id", conversationId);

    // Still flag the order so admins see customer interaction, but DON'T touch status.
    const noteText = forceAddressGate
      ? `Customer clicked "${buttonText}" — awaiting full delivery address`
      : `Customer clicked "${buttonText}" — AI validating (${intentKind})`;
    await admin
      .from("orders")
      .update({
        whatsapp_status: forceAddressGate ? "pending_address" : (order.whatsapp_status ?? null),
        whatsapp_note: noteText,
        whatsapp_last_reply_at: new Date().toISOString(),
      })
      .eq("order_id", order.order_id);
    return;
  }

  // 3) Non-gated path: apply mapping immediately (legacy).
  const noteFlag = skipGateForConfirmedAddress
    ? `Customer clicked "${buttonText}" — auto-confirmed (address on file)`
    : `Customer clicked "${buttonText}" on WhatsApp`;
  const updates: Record<string, any> = {
    whatsapp_note: noteFlag,
    whatsapp_last_reply_at: new Date().toISOString(),
  };
  if (skipGateForConfirmedAddress) {
    updates.whatsapp_status = "confirmed";
  }

  if (hasMappedStatus) {
    const before = order.confirmation_status;
    updates.confirmation_status = status;
    updates.confirmation_channel = "whatsapp";
    if (status === "confirmed") updates.confirmed_at = new Date().toISOString();
    if (status === "cancelled" || status === "canceled")
      updates.cancel_reason = `Cancelled via WhatsApp button "${buttonText}"`;

    await admin.from("orders").update(updates).eq("order_id", order.order_id);

    if (before !== status) {
      await admin.from("order_history").insert({
        order_id: order.order_id,
        action_type: "whatsapp_button",
        changed_by: order.seller_id,
        changed_by_role: "whatsapp",
        field_changed: "confirmation_status",
        old_value: before ?? null,
        new_value: status,
      });
    }
  } else {
    await admin.from("orders").update(updates).eq("order_id", order.order_id);
  }

  // When skipping gate for a confirmed-address auto-confirm, also clear any
  // stale pending_button_intent on the conversation and mark it confirmed so
  // the AI does NOT keep asking the customer for their address.
  if (skipGateForConfirmedAddress && conversationId) {
    await admin
      .from("whatsapp_conversations")
      .update({
        status: "confirmed",
        outcome: "confirmed",
        pending_button_intent: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
  }
}

/**
 * Start runs for the `from_template` trigger.
 * Triggered by the webhook when a customer replies to one of our outbound
 * template messages. Picks the entry node from edges where `source = "__trigger__"`
 * and `sourceHandle = "btn:N"` (matching the clicked button) or `"default"`.
 */
async function startNewRunsFromTemplate(args: {
  templateId: string;
  conversationId: string;
  orderId?: string | null;
  customerPhone?: string | null;
  buttonIndex?: number;
  replyText?: string;
}) {
  const { data: conv } = await admin
    .from("whatsapp_conversations")
    .select("*")
    .eq("id", args.conversationId)
    .maybeSingle();
  if (!conv) {
    log("from_template: conversation not found", args.conversationId);
    return { started: 0 };
  }
  const phone =
    (args.customerPhone && args.customerPhone.replace(/\D/g, "")) ||
    (conv.customer_phone || "").replace(/\D/g, "");

  const { data: order } = args.orderId
    ? await admin.from("orders").select("*").eq("order_id", args.orderId).maybeSingle()
    : { data: null };

  const { data: autos } = await admin
    .from("whatsapp_automations")
    .select("*")
    .eq("trigger_type", "from_template")
    .eq("status", "active");
  const matched = (autos ?? []).filter(
    (a) => (a.trigger_config as any)?.template_id === args.templateId,
  );
  if (!matched.length) {
    log("from_template: no automations for template", args.templateId);
    return { started: 0 };
  }

  const handleWanted =
    typeof args.buttonIndex === "number" ? `btn:${args.buttonIndex}` : "default";

  let started = 0;
  for (const a of matched) {
    const nodes: FlowNode[] = (a.nodes as any) ?? [];
    const edges: FlowEdge[] = (a.edges as any) ?? [];
    if (!nodes.length || !edges.length) continue;

    const triggerEdges = edges.filter((e) => e.source === "__trigger__");
    const entryEdge =
      triggerEdges.find((e) => e.sourceHandle === handleWanted) ||
      (handleWanted !== "default"
        ? triggerEdges.find((e) => e.sourceHandle === "default")
        : undefined);

    if (!entryEdge) {
      log("from_template: no branch for handle", { auto: a.id, handle: handleWanted });
      continue;
    }
    const entryNode = nodes.find((n) => n.id === entryEdge.target);
    if (!entryNode) {
      log("from_template: entry node missing", entryEdge.target);
      continue;
    }

    const { data: run, error } = await admin
      .from("whatsapp_automation_runs")
      .insert({
        automation_id: a.id,
        order_id: order?.order_id ?? null,
        customer_phone: phone,
        conversation_id: conv.id,
        status: "running",
        current_node_id: entryNode.id,
        trigger_payload: {
          trigger_type: "from_template",
          template_id: args.templateId,
          conversation_id: conv.id,
          button_index: args.buttonIndex ?? null,
          reply_text: args.replyText ?? null,
        },
        steps_log: [],
      })
      .select()
      .single();
    if (error) {
      errLog("from_template run insert failed", error);
      continue;
    }

    await admin
      .from("whatsapp_automations")
      .update({
        runs_count: (a.runs_count ?? 0) + 1,
        last_run_at: new Date().toISOString(),
      })
      .eq("id", a.id);

    // Apply per-button action (status change + AI takeover) BEFORE running the flow,
    // so downstream steps see the updated order state.
    if (typeof args.buttonIndex === "number") {
      const cfg = (a.trigger_config as any) ?? {};
      const buttonActions = Array.isArray(cfg.button_actions) ? cfg.button_actions : [];
      const tplButtons = Array.isArray(cfg.template_buttons) ? cfg.template_buttons : [];
      const action = buttonActions[args.buttonIndex];
      const buttonText =
        tplButtons[args.buttonIndex]?.text || args.replyText || `Button ${args.buttonIndex + 1}`;
      try {
        await applyButtonAction({
          action,
          order,
          conversationId: conv.id,
          buttonText,
        });
      } catch (e) {
        errLog("applyButtonAction failed", (e as Error).message);
      }
    }

    // Re-fetch the order so executeFlow sees the new status (if changed).
    const { data: refreshedOrder } = order
      ? await admin.from("orders").select("*").eq("order_id", order.order_id).maybeSingle()
      : { data: null };

    await executeFlow({
      runId: run.id,
      automation: a,
      order: refreshedOrder ?? order,
      conversation: conv,
      startNodeId: entryNode.id,
    });
    started++;
  }
  return { started };
}

async function resumeRun(runId: string, opts: { buttonIndex?: number; replyText?: string }) {
  const { data: run } = await admin
    .from("whatsapp_automation_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { ok: false, error: "run not found" };
  if (!["waiting_reply", "waiting_delay", "running"].includes(run.status))
    return { ok: false, error: `run status ${run.status}` };

  const { data: automation } = await admin
    .from("whatsapp_automations")
    .select("*")
    .eq("id", run.automation_id)
    .maybeSingle();
  if (!automation) return { ok: false, error: "automation not found" };

  const { data: order } = run.order_id
    ? await admin.from("orders").select("*").eq("order_id", run.order_id).maybeSingle()
    : { data: null };
  const { data: conv } = run.conversation_id
    ? await admin
        .from("whatsapp_conversations")
        .select("*")
        .eq("id", run.conversation_id)
        .maybeSingle()
    : { data: null };

  const edges: FlowEdge[] = (automation.edges as any) ?? [];
  const nodes: FlowNode[] = (automation.nodes as any) ?? [];
  let handle: string | undefined;
  if (typeof opts.buttonIndex === "number") handle = `btn:${opts.buttonIndex}`;

  // Apply per-button action configured on the current send_template node
  // (status mapping + AI gate / takeover) BEFORE moving to the next node.
  if (typeof opts.buttonIndex === "number" && run.current_node_id) {
    const currentNode = nodes.find((n) => n.id === run.current_node_id);
    if (currentNode?.type === "send_template") {
      const buttonActions = Array.isArray(currentNode.data?.button_actions)
        ? currentNode.data.button_actions
        : [];
      const tplButtons = Array.isArray(currentNode.data?.template_buttons)
        ? currentNode.data.template_buttons
        : [];
      const action = buttonActions[opts.buttonIndex];
      const buttonText =
        tplButtons[opts.buttonIndex]?.text ||
        opts.replyText ||
        `Button ${opts.buttonIndex + 1}`;
      try {
        await applyButtonAction({
          action,
          order,
          conversationId: conv?.id ?? null,
          buttonText,
        });
      } catch (e) {
        errLog("send_template applyButtonAction failed", (e as Error).message);
      }
    }
  }

  // Re-fetch order so downstream steps see any status change.
  const { data: refreshedOrder } = run.order_id
    ? await admin.from("orders").select("*").eq("order_id", run.order_id).maybeSingle()
    : { data: null };

  const next = run.current_node_id
    ? findNextNode(edges, run.current_node_id, handle) ??
      findNextNode(edges, run.current_node_id)
    : null;

  if (!next) {
    await admin
      .from("whatsapp_automation_runs")
      .update({
        status: "completed",
        current_node_id: null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return { ok: true, completed: true };
  }

  await admin
    .from("whatsapp_automation_runs")
    .update({ status: "running", current_node_id: next.target, wait_until: null })
    .eq("id", runId);

  await executeFlow({
    runId,
    automation,
    order: refreshedOrder ?? order,
    conversation: conv,
    startNodeId: next.target,
  });
  return { ok: true };
}

async function tickDelays() {
  const { data: due } = await admin
    .from("whatsapp_automation_runs")
    .select("id")
    .eq("status", "waiting_delay")
    .lte("wait_until", new Date().toISOString())
    .limit(50);
  if (due?.length) {
    for (const r of due) {
      await resumeRun(r.id, {});
    }
  }
  const switched = await tickAgentSwitches();
  const recovered = await sweepMissedNewOrders();
  const handedOff = await tickPendingIntentHandoff();
  return { processed: due?.length ?? 0, switched, recovered, handedOff };
}

// Hand off conversations stuck on a `pending_button_intent` for too long to a
// human agent. Triggered when the customer pressed a button (e.g. confirm)
// that was AI-gated, but never replied to the AI's follow-up question. Without
// this fallback the order would stay pinned in WhatsApp limbo (AB-606).
//
// Threshold: 60 minutes since `pending_button_intent.created_at` AND no
// inbound message in the last 60 minutes either.
async function tickPendingIntentHandoff(): Promise<number> {
  const cutoffIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: convs, error } = await admin
    .from("whatsapp_conversations")
    .select("id, order_id, pending_button_intent, last_message_at")
    .not("pending_button_intent", "is", null)
    .lte("last_message_at", cutoffIso)
    .limit(100);
  if (error) {
    errLog("tickPendingIntentHandoff query", error.message);
    return 0;
  }
  if (!convs?.length) return 0;
  let handed = 0;
  for (const c of convs) {
    try {
      const intent: any = c.pending_button_intent ?? null;
      const intentCreatedAt = intent?.created_at ? new Date(intent.created_at).getTime() : 0;
      if (intentCreatedAt && intentCreatedAt > Date.now() - 60 * 60 * 1000) continue;

      if (c.order_id) {
        const { data: ord } = await admin
          .from("orders")
          .select("order_id, confirmation_status, customer_address, customer_city")
          .eq("order_id", c.order_id)
          .maybeSingle();
        if (ord) {
          // SAFETY (allowlist): only orders still in WhatsApp initial states
          // (`new_wts` / `pending_address`) may be handed off to the agent
          // queue. Any other status — including confirmed, cancelled,
          // no_answer, postponed, wrong_number, unreachable, or already
          // routed `new` — must NEVER be overwritten back to `new` by this
          // sweeper. Without this guard a single run wiped 170+ treated
          // orders (incident 2026-05-01).
          const allowedStatuses = ["new_wts", "pending_address"];
          const before = ord.confirmation_status;
          if (!allowedStatuses.includes(String(before))) {
            // Just clear the conversation pending intent and skip the order.
            log("pending-intent: skipping handoff — order not in allowed state", {
              conv: c.id, order: c.order_id, status: before,
            });
          } else {
            // Update with DB-side guard to prevent races: if status changed
            // between read and write, the update is a no-op.
            const { data: updated, error: updErr } = await admin
              .from("orders")
              .update({
                confirmation_channel: "agent",
                confirmation_status: "new",
                agent_id: null,
                assigned_at: null,
                whatsapp_status: "handed_to_agent",
                whatsapp_note: "Auto-routed to agent — customer never replied to AI address request",
                last_activity_at: new Date().toISOString(),
              })
              .eq("order_id", c.order_id)
              .in("confirmation_status", allowedStatuses)
              .select("order_id");
            if (updErr) {
              errLog("pending-intent: handoff update failed", c.order_id, updErr.message);
            } else if (updated && updated.length > 0) {
              await admin.from("order_history").insert({
                order_id: c.order_id,
                action_type: "whatsapp_auto_handoff",
                changed_by: "00000000-0000-0000-0000-000000000000",
                changed_by_role: "system",
                field_changed: "confirmation_status",
                old_value: before ?? null,
                new_value: "new",
              });
            } else {
              log("pending-intent: handoff skipped — status changed mid-flight", {
                conv: c.id, order: c.order_id, status: before,
              });
            }
          }
        }
      }

      await admin
        .from("whatsapp_conversations")
        .update({
          ai_enabled: false,
          status: "manual_review_needed",
          pending_button_intent: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", c.id);

      handed++;
      log("pending-intent: auto-handoff to agent", { conv: c.id, order: c.order_id });
    } catch (e) {
      errLog("tickPendingIntentHandoff iter failed", (e as Error).message);
    }
  }
  return handed;
}

// Recovery sweep: find recent WhatsApp-routed orders (new_wts/whatsapp channel)
// that never got an automation run started — usually because the pg_net call
// from the AFTER INSERT trigger timed out or hit a 503 — and start one now.
async function sweepMissedNewOrders() {
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: orders, error } = await admin
    .from("orders")
    .select("order_id")
    .eq("confirmation_channel", "whatsapp")
    .eq("confirmation_status", "new_wts")
    .eq("whatsapp_status", "pending")
    .is("whatsapp_last_sent_at", null)
    .gte("created_at", sinceIso)
    .limit(50);
  if (error) {
    errLog("sweepMissedNewOrders query", error.message);
    return 0;
  }
  if (!orders?.length) return 0;
  let started = 0;
  for (const o of orders) {
    const { count } = await admin
      .from("whatsapp_automation_runs")
      .select("id", { count: "exact", head: true })
      .eq("order_id", o.order_id);
    if ((count ?? 0) > 0) continue;
    try {
      const r = await startNewRuns("new_order", o.order_id);
      if (r.started) started += r.started;
      log("recovered missed new_order", { order_id: o.order_id, started: r.started });
    } catch (e) {
      errLog("recover startNewRuns failed", o.order_id, (e as Error).message);
    }
  }
  return started;
}

// Switch WhatsApp orders to the agent queue when the configured timeout
// (trigger_config.switch_to_agent) elapses without a customer reply that
// closed/confirmed the conversation.
async function tickAgentSwitches() {
  const nowIso = new Date().toISOString();
  const { data: orders, error } = await admin
    .from("orders")
    .select("id, order_id, confirmation_status, agent_switch_scheduled_at, agent_switched_at")
    .lte("agent_switch_scheduled_at", nowIso)
    .is("agent_switched_at", null)
    .eq("confirmation_status", "new_wts")
    .limit(100);
  if (error) {
    errLog("tickAgentSwitches query", error.message);
    return 0;
  }
  if (!orders?.length) return 0;
  let count = 0;
  for (const o of orders) {
    const { error: updErr } = await admin
      .from("orders")
      .update({
        confirmation_status: "new",
        agent_switched_at: nowIso,
        agent_id: null,
      })
      .eq("id", o.id)
      .eq("confirmation_status", "new_wts")
      .is("agent_switched_at", null);
    if (updErr) {
      errLog("tickAgentSwitches update", updErr.message);
      continue;
    }
    // Cancel any in-flight automation runs for this order
    await admin
      .from("whatsapp_automation_runs")
      .update({ status: "canceled", finished_at: nowIso })
      .eq("order_id", o.order_id)
      .in("status", ["waiting_reply", "waiting_delay", "running"]);
    count++;
    log("switched-to-agent", { order_id: o.order_id });
  }
  return count;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as any;
    log("invoke", { keys: Object.keys(body || {}) });

    if (body.tick) {
      const r = await tickDelays();
      return new Response(JSON.stringify({ ok: true, ...r }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.resume && body.run_id) {
      const r = await resumeRun(body.run_id, {
        buttonIndex: typeof body.button_index === "number" ? body.button_index : undefined,
        replyText: body.reply_text,
      });
      return new Response(JSON.stringify(r), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.trigger_type === "from_template" && body.template_id && body.conversation_id) {
      const r = await startNewRunsFromTemplate({
        templateId: String(body.template_id),
        conversationId: String(body.conversation_id),
        orderId: body.order_id ? String(body.order_id) : null,
        customerPhone: body.customer_phone ? String(body.customer_phone) : null,
        buttonIndex: typeof body.button_index === "number" ? body.button_index : undefined,
        replyText: body.reply_text ? String(body.reply_text) : undefined,
      });
      return new Response(JSON.stringify({ ok: true, ...r }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.trigger_type && body.order_id) {
      const r = await startNewRuns(String(body.trigger_type), String(body.order_id));
      return new Response(JSON.stringify({ ok: true, ...r }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "invalid payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    errLog("fatal", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
