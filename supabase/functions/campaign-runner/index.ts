// @ts-nocheck
// Campaign runner: server-side WhatsApp template broadcasts that keep running without any
// browser tab. The audience is built and logged in SQL (see 20261110100000_campaign_engine.sql);
// this function only talks to Meta and decides pacing.
//
// Actions:
//   preview            → audience counts for a set of filters
//   limits             → the phone number's Meta throughput + daily messaging tier
//   start              → build recipients, mark sending, kick the first run
//   process            → (internal) send one budgeted slice, then chain the next one
//   process_scheduled  → cron, every minute: start due scheduled campaigns and revive any
//                        "sending" campaign whose runner chain broke
//   pause / resume / cancel
//
// How a run works: claim N pending recipients (SKIP LOCKED, so two runners can never send the
// same one), send them in parallel to hit the target rate, record the whole tick with a single
// RPC, sleep out the rest of the second. A run is capped (time and message count) so it stays
// inside edge-function limits, then re-invokes itself to continue.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const MAX_RUN_MS = 45_000;
const MAX_PER_RUN = 1500;
const LOCK_MS = 90_000;
const MAX_ATTEMPTS = 3;
const MAX_PER_MINUTE = 4800; // 80 msg/s: Meta's default (STANDARD) throughput per number
const SYSTEMIC_STREAK = 10;

// Meta errors that mean "slow down / try again", not "this recipient is bad".
const RETRY_CODES = new Set([130429, 131016, 131057, 80007, 4, 17, 32, 613]);
const RATE_LIMIT_CODES = new Set([130429, 80007, 4, 17, 32, 613]);
// Errors that legitimately hit many recipients in a row without meaning the campaign is broken.
const PER_RECIPIENT_CODES = new Set(["131026", "131021", "131030", "133010", "131050", "131047"]);
const TIER_LIMITS: Record<string, number | null> = {
  TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: null,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

// Resolve a body placeholder ({{customer_name}}, {{1}}, {{var_2}}...) to a value.
function resolveVar(name: string, vars: Record<string, any>): string {
  const positional = [vars.customer_name, vars.product_name, vars.order_id, vars.price, vars.city];
  const synonyms: Record<string, any> = {
    name: vars.customer_name, customer: vars.customer_name, customer_name: vars.customer_name,
    product: vars.product_name, product_name: vars.product_name,
    order: vars.order_id, order_id: vars.order_id,
    price: vars.price, total: vars.price, amount: vars.price,
    city: vars.city, address: vars.city,
  };
  if (vars[name] != null && String(vars[name]).trim() !== "") return String(vars[name]);
  const key = name.toLowerCase();
  if (synonyms[key] != null && String(synonyms[key]).trim() !== "") return String(synonyms[key]);
  const numMatch = key.match(/^(?:var|param|p|v)?_?(\d+)$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < positional.length) {
      const val = positional[idx];
      if (val != null && String(val).trim() !== "") return String(val);
    }
  }
  return "—"; // Meta rejects empty parameters
}

async function metaGet(settings: any, path: string) {
  const token = settings.access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
  const r = await fetch(`${settings.api_base_url}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
}

async function getSettings() {
  const { data } = await admin.from("whatsapp_settings").select("*").eq("singleton", true).maybeSingle();
  return data;
}

// Fire the next run. The `process` action answers immediately and works in the background,
// so awaiting this is quick and the chain does not depend on this isolate staying alive.
async function kick(campaignId: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/campaign-runner`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ action: "process", campaign_id: campaignId, _internal: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("[campaign-runner] kick failed (cron will pick it up)", (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
function buildSender(template: any, settings: any, dryRun: boolean, dryFail: string | null) {
  const templateName = template.meta_template_name || template.name;
  const language = template.language || "en_US";
  const tplBody = String(template.body || "");
  const placeholders: string[] = [];
  const re = /\{\{\s*([\w]+)\s*\}\}/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(tplBody)) !== null) placeholders.push(mm[1]);

  let headerComponent: any = null;
  if (template.header_type && template.header_media_url) {
    const t = String(template.header_type).toLowerCase();
    if (t === "image" || t === "video" || t === "document") {
      headerComponent = { type: "header", parameters: [{ type: t, [t]: { link: template.header_media_url } }] };
    }
  }

  const url = `${settings.api_base_url}/${settings.phone_number_id}/messages`;
  const token = settings.access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");

  return async function send(r: any) {
    const to = normalizePhone(r.customer_phone, settings.default_country_code);
    const base = { id: r.id, to_phone: to, message_id: crypto.randomUUID() };
    if (!to) return { ...base, outcome: "failed", error: JSON.stringify({ error: { message: "Invalid phone" } }) };

    const vars = r.variables ?? {};
    const components: any[] = [];
    if (headerComponent) components.push(headerComponent);
    if (placeholders.length) {
      components.push({
        type: "body",
        parameters: placeholders.map((name) => ({ type: "text", text: resolveVar(name, vars) })),
      });
    }
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: { name: templateName, language: { code: language }, ...(components.length ? { components } : {}) },
    };
    const body = render(tplBody, vars);
    const logged = { ...base, body, payload: { ...payload, _campaign_id: r.campaign_id } };

    if (dryRun) {
      // Test hook: filters.__dry_run skips Meta entirely; filters.__dry_fail=<code> simulates a systemic failure.
      await sleep(120 + Math.random() * 180);
      if (dryFail) {
        return {
          ...logged, outcome: "failed", code: dryFail,
          error: JSON.stringify({ error: { code: Number(dryFail), message: "dry-run simulated failure" } }),
        };
      }
      return { ...logged, outcome: "sent", meta_message_id: `dryrun.${crypto.randomUUID()}` };
    }

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok) return { ...logged, outcome: "sent", meta_message_id: j?.messages?.[0]?.id ?? null };

      const code = j?.error?.code;
      const retryable = resp.status === 429 || resp.status >= 500 || RETRY_CODES.has(Number(code));
      return {
        ...logged,
        outcome: retryable && (r.attempts ?? 0) + 1 < MAX_ATTEMPTS ? "retry" : "failed",
        error: JSON.stringify(j),
        code: code != null ? String(code) : String(resp.status),
        rate_limited: resp.status === 429 || RATE_LIMIT_CODES.has(Number(code)),
      };
    } catch (e) {
      // Timeout / network drop after the request left: Meta may or may not have sent it.
      // Fail rather than retry so a customer never gets the same marketing message twice.
      return {
        ...logged,
        outcome: "failed",
        code: "network",
        error: JSON.stringify({ error: { message: `Network error: ${(e as Error).message} (outcome unknown, not resent)` } }),
      };
    }
  };
}

async function setCampaign(id: string, patch: Record<string, unknown>) {
  await admin.from("whatsapp_campaigns").update(patch).eq("id", id);
}

// Runs one budgeted slice. Returns true when more work remains and the chain should continue.
async function runSlice(campaign: any): Promise<boolean> {
  const id = campaign.id;
  const dryRun = campaign?.filters?.__dry_run === true;

  const [{ data: template }, settings] = await Promise.all([
    admin.from("whatsapp_templates").select("*").eq("id", campaign.template_id).maybeSingle(),
    getSettings(),
  ]);
  if (!template) {
    await setCampaign(id, { status: "failed", completed_at: new Date().toISOString(), last_error: "Template not found (deleted?)" });
    return false;
  }
  const token = settings?.access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
  if (!dryRun && (!settings || !settings.integration_enabled || !settings.sending_enabled || !token)) {
    await setCampaign(id, {
      status: "paused",
      last_error: "WhatsApp sending is disabled or the access token is missing. Fix it in WhatsApp settings, then resume.",
    });
    return false;
  }

  const send = buildSender(template, settings, dryRun, dryRun ? (campaign.filters?.__dry_fail ?? null) : null);
  const throttle = Math.max(1, Math.min(MAX_PER_MINUTE, Number(campaign.throttle_per_minute) || 60));
  let perTick = Math.max(1, Math.round(throttle / 60));
  const tickMs = Math.round((perTick * 60_000) / throttle);

  const startedAt = Date.now();
  let processed = 0;
  let streak = { code: "", n: 0 };

  while (Date.now() - startedAt < MAX_RUN_MS && processed < MAX_PER_RUN) {
    // Heartbeat + cancel/pause check in one write.
    const { data: alive } = await admin
      .from("whatsapp_campaigns")
      .update({ runner_lock_until: new Date(Date.now() + LOCK_MS).toISOString() })
      .eq("id", id)
      .eq("status", "sending")
      .select("id");
    if (!alive?.length) return false;

    const tickStart = Date.now();
    const { data: claimed, error: claimErr } = await admin.rpc("campaign_claim_recipients", {
      p_campaign_id: id,
      p_limit: perTick,
    });
    if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);

    if (!claimed?.length) {
      const { count: remaining } = await admin
        .from("whatsapp_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", id)
        .in("status", ["pending", "processing"]);
      if (!remaining) {
        await admin.rpc("refresh_campaign_counters", { p_campaign_id: id });
        await admin
          .from("whatsapp_campaigns")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", id)
          .eq("status", "sending");
      }
      // Only stale "processing" rows left: the cron revisit sweeps them.
      return false;
    }

    const results = await Promise.all(claimed.map((r: any) => send(r)));

    // A run of identical failures means the campaign itself is broken (wrong template,
    // expired token, tier exhausted...). Stop instead of burning through the audience.
    let pauseReason: string | null = null;
    for (const r of results) {
      if (r.outcome === "sent") streak = { code: "", n: 0 };
      else if (r.outcome === "failed") {
        const code = r.code ?? "?";
        streak = streak.code === code ? { code, n: streak.n + 1 } : { code, n: 1 };
        if (streak.n >= SYSTEMIC_STREAK && !PER_RECIPIENT_CODES.has(code) && !pauseReason) {
          let msg = "";
          try { msg = JSON.parse(r.error)?.error?.message ?? ""; } catch (_) { /* keep empty */ }
          pauseReason = `Paused: ${streak.n} messages in a row failed with the same error${code !== "?" ? ` (#${code})` : ""}. ${msg}`.trim();
        }
      }
    }
    if (pauseReason) {
      // Put this tick's failures back so they are sent after the problem is fixed.
      for (const r of results) if (r.outcome === "failed") r.outcome = "requeue";
    }

    const { error: recErr } = await admin.rpc("campaign_record_results", {
      p_campaign_id: id,
      p_results: results,
      p_log: !dryRun,
    });
    if (recErr) throw new Error(`record failed: ${recErr.message}`);
    processed += claimed.length;

    if (pauseReason) {
      await setCampaign(id, { status: "paused", last_error: pauseReason });
      return false;
    }

    if (results.some((r: any) => r.rate_limited)) {
      perTick = Math.max(1, Math.floor(perTick / 2));
      await sleep(4000);
    }
    const wait = tickMs - (Date.now() - tickStart);
    if (wait > 0) await sleep(wait);
  }
  return true;
}

async function processCampaign(campaignId: string) {
  const lockUntil = new Date(Date.now() + LOCK_MS).toISOString();
  const { data: locked } = await admin
    .from("whatsapp_campaigns")
    .update({ runner_lock_until: lockUntil })
    .eq("id", campaignId)
    .eq("status", "sending")
    .or(`runner_lock_until.is.null,runner_lock_until.lt.${new Date().toISOString()}`)
    .select("*");
  const campaign = locked?.[0];
  if (!campaign) return; // not sending, or another runner already holds it

  let more = false;
  try {
    more = await runSlice(campaign);
  } catch (e) {
    console.error("[campaign-runner] slice failed", (e as Error).message);
    await setCampaign(campaignId, { last_error: `Run error: ${(e as Error).message}`.slice(0, 500) });
  } finally {
    await setCampaign(campaignId, { runner_lock_until: null });
  }
  if (more) await kick(campaignId);
}

async function startCampaign(campaignId: string) {
  const { data: c } = await admin.from("whatsapp_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (!c) throw new Error("Campaign not found");
  if (!["draft", "scheduled"].includes(c.status)) throw new Error(`Campaign is already ${c.status}`);

  const { data: total, error } = await admin.rpc("campaign_prepare_recipients", { p_campaign_id: campaignId });
  if (error) throw new Error(error.message);
  if (!total) {
    await setCampaign(campaignId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      last_error: "No recipients matched the filters",
    });
    return { ok: false as const, error: "No recipients matched the filters" };
  }
  const { data: updated } = await admin
    .from("whatsapp_campaigns")
    .update({ status: "sending", started_at: new Date().toISOString(), completed_at: null, runner_lock_until: null })
    .eq("id", campaignId)
    .in("status", ["draft", "scheduled"])
    .select("id");
  if (!updated?.length) return { ok: true as const, total }; // someone else started it meanwhile
  await kick(campaignId);
  return { ok: true as const, total };
}

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "start";

    // Internal calls and cron send the service key; the UI sends a user JWT that must be admin.
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader !== `Bearer ${SERVICE_KEY}`) {
      // Decode the JWT directly (a rotated refresh token can make auth.getUser() 401 on a
      // still-valid access token). verify_jwt=true means the platform already checked its
      // signature; a service_role JWT is as privileged as the env service key.
      let userId: string | null = null;
      let isServiceRole = false;
      const m = authHeader.match(/^Bearer\s+(.+)$/i);
      if (m) {
        try {
          const parts = m[1].split(".");
          if (parts.length >= 2) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
            const live = !payload.exp || payload.exp * 1000 > Date.now();
            if (live && payload?.role === "service_role") isServiceRole = true;
            else if (live && payload?.sub) userId = String(payload.sub);
          }
        } catch (_) { /* fall through */ }
      }
      if (!isServiceRole) {
        if (!userId) return json(401, { ok: false, error: "Unauthorized" });
        const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: userId });
        if (!isAdmin) return json(403, { ok: false, error: "Forbidden" });
      }
    }

    if (action === "preview") {
      const filters = body.campaign?.filters;
      if (!filters) throw new Error("filters required");
      const { data, error } = await admin.rpc("campaign_audience_counts", { p_filters: filters });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      return json(200, {
        ok: true,
        count: row?.recipients ?? 0,
        total_orders: row?.total_orders ?? 0,
        invalid_phones: row?.invalid_phones ?? 0,
        duplicates: row?.duplicates ?? 0,
      });
    }

    if (action === "limits") {
      const settings = await getSettings();
      if (!settings?.phone_number_id) return json(200, { ok: false, error: "WhatsApp is not configured" });
      const [limit, info] = await Promise.all([
        metaGet(settings, `${settings.phone_number_id}?fields=whatsapp_business_manager_messaging_limit`),
        metaGet(settings, `${settings.phone_number_id}?fields=throughput,quality_rating,display_phone_number`),
      ]);
      const tier = limit.body?.whatsapp_business_manager_messaging_limit ?? null;
      const level = info.body?.throughput?.level ?? null;
      return json(200, {
        ok: true,
        tier,
        daily_limit: tier && tier in TIER_LIMITS ? TIER_LIMITS[tier] : null,
        throughput_level: level,
        max_per_minute: MAX_PER_MINUTE,
        quality_rating: info.body?.quality_rating ?? null,
        phone: info.body?.display_phone_number ?? null,
      });
    }

    if (action === "start") {
      if (!body.campaign_id) throw new Error("campaign_id required");
      const r = await startCampaign(body.campaign_id);
      return json(r.ok ? 200 : 400, r);
    }

    if (action === "process") {
      if (!body.campaign_id) throw new Error("campaign_id required");
      const work = processCampaign(body.campaign_id).catch((e) =>
        console.error("[campaign-runner] process failed", (e as Error).message));
      // Answer right away; the work continues in the background past the response.
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
      else await work;
      return json(200, { ok: true, started: true });
    }

    if (action === "process_scheduled") {
      const nowIso = new Date().toISOString();
      let started = 0;

      const { data: due } = await admin
        .from("whatsapp_campaigns")
        .select("id")
        .eq("status", "scheduled")
        .lte("scheduled_at", nowIso)
        .limit(20);
      for (const d of due ?? []) {
        try {
          const r = await startCampaign(d.id);
          if (r.ok) started++;
        } catch (e) {
          console.error("[campaign-runner] scheduled start failed", d.id, (e as Error).message);
        }
      }

      // Revive campaigns whose chain broke (isolate killed, kick lost...): still "sending" but
      // nobody holds the runner lock.
      const { data: orphans } = await admin
        .from("whatsapp_campaigns")
        .select("id")
        .eq("status", "sending")
        .or(`runner_lock_until.is.null,runner_lock_until.lt.${nowIso}`)
        .limit(20);
      for (const o of orphans ?? []) await kick(o.id);

      return json(200, { ok: true, started, revived: orphans?.length ?? 0 });
    }

    if (action === "pause") {
      if (!body.campaign_id) throw new Error("campaign_id required");
      await admin.from("whatsapp_campaigns").update({ status: "paused" }).eq("id", body.campaign_id).eq("status", "sending");
      return json(200, { ok: true });
    }

    if (action === "resume") {
      if (!body.campaign_id) throw new Error("campaign_id required");
      const { data: resumed } = await admin
        .from("whatsapp_campaigns")
        .update({ status: "sending", last_error: null, runner_lock_until: null })
        .eq("id", body.campaign_id)
        .eq("status", "paused")
        .select("id");
      if (resumed?.length) await kick(body.campaign_id);
      return json(200, { ok: true });
    }

    if (action === "cancel") {
      if (!body.campaign_id) throw new Error("campaign_id required");
      await admin
        .from("whatsapp_campaigns")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", body.campaign_id)
        .in("status", ["draft", "scheduled", "sending", "paused"]);
      return json(200, { ok: true });
    }

    return json(400, { ok: false, error: "Unknown action" });
  } catch (e) {
    console.error("[campaign-runner]", e);
    return json(500, { ok: false, error: (e as Error).message });
  }
});
