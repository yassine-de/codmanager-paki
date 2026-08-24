// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FALLBACK_CARRIER_CODE = "postex";

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getActiveCarrierCode(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "active_carrier_code")
    .maybeSingle();
  return normalizeCarrierCode(data?.value || Deno.env.get("ACTIVE_CARRIER_CODE") || FALLBACK_CARRIER_CODE);
}

function normalizeCarrierCode(value?: string | null) {
  return String(value || "").trim().toLowerCase() || FALLBACK_CARRIER_CODE;
}

function functionForCarrier(code: string) {
  return normalizeCarrierCode(code) === "mnp" ? "mnp-shipping-sync" : "shipping-sync";
}

function normalizeCity(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function isCityCoverageError(data: any) {
  const message = String(data?.error || data?.message || data?.sync_error || data?.raw || "").toLowerCase();
  return message.includes("city not found") || message.includes("city is not") || message.includes("city unavailable");
}

async function getCarrier(supabase: ReturnType<typeof createClient>, code: string) {
  const { data, error } = await supabase
    .from("carriers")
    .select("*")
    .eq("code", normalizeCarrierCode(code))
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getOrderForSync(supabase: ReturnType<typeof createClient>, orderIdOrDbId: string) {
  let { data: order, error } = await supabase
    .from("orders")
    .select("id, system_id, order_id, customer_city")
    .eq("id", orderIdOrDbId)
    .maybeSingle();

  if (error || !order) {
    const result = await supabase
      .from("orders")
      .select("id, system_id, order_id, customer_city")
      .eq("order_id", orderIdOrDbId)
      .maybeSingle();
    if (result.error) throw result.error;
    order = result.data;
  }

  return order;
}

async function carrierCoversCity(supabase: ReturnType<typeof createClient>, carrierId: string, city?: string | null) {
  const wanted = normalizeCity(city);
  if (!wanted) return { covered: false, reason: "Order city is empty" };

  const { data, error } = await supabase
    .from("carrier_city_cache")
    .select("id,city_name,is_delivery_city,aliases")
    .eq("carrier_id", carrierId)
    .or("is_delivery_city.is.true,is_delivery_city.is.null")
    .limit(2000);
  if (error) throw error;

  const match = (data || []).find((row: any) => {
    const aliases = Array.isArray(row.aliases) ? row.aliases : [];
    return normalizeCity(row.city_name) === wanted || aliases.some((alias: string) => normalizeCity(alias) === wanted);
  });
  return {
    covered: Boolean(match),
    matchedCity: match?.city_name || null,
    reason: match ? null : `Carrier does not cover city "${city}"`,
  };
}

async function logUnmatchedCity(
  supabase: ReturnType<typeof createClient>,
  params: {
    carrierId: string;
    fallbackCarrierCode?: string;
    inputCity?: string | null;
    reason?: string | null;
    order?: any;
  },
) {
  const normalized = normalizeCity(params.inputCity);
  if (!params.carrierId || !normalized) return;

  let fallbackCarrierId: string | null = null;
  if (params.fallbackCarrierCode) {
    const fallback = await getCarrier(supabase, params.fallbackCarrierCode);
    fallbackCarrierId = fallback?.id || null;
  }

  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("carrier_city_unmatched")
    .select("id,occurrence_count")
    .eq("carrier_id", params.carrierId)
    .eq("normalized_city", normalized)
    .maybeSingle();
  if (existingError) throw existingError;

  const payload = {
    carrier_id: params.carrierId,
    fallback_carrier_id: fallbackCarrierId,
    input_city: String(params.inputCity || "").trim(),
    normalized_city: normalized,
    reason: params.reason || null,
    last_order_uuid: params.order?.id || null,
    last_order_id: params.order?.order_id || null,
    last_system_id: params.order?.system_id || null,
    status: "open",
    last_seen_at: now,
    updated_at: now,
  };

  if (existing) {
    await supabase
      .from("carrier_city_unmatched")
      .update({ ...payload, occurrence_count: Number(existing.occurrence_count || 0) + 1 })
      .eq("id", existing.id);
  } else {
    await supabase.from("carrier_city_unmatched").insert({ ...payload, occurrence_count: 1, created_at: now });
  }
}

async function getShipmentCarrierCodes(supabase: ReturnType<typeof createClient>, trackingNumbers: string[]) {
  const codes = new Set<string>();
  for (const tracking of trackingNumbers) {
    const value = String(tracking || "").trim();
    if (!value) continue;

    const { data, error } = await supabase
      .from("shipments")
      .select("carriers(code)")
      .or(`tracking_number.eq.${value},carrier_order_id.eq.${value}`)
      .maybeSingle();
    if (error) throw error;

    const joined = data?.carriers;
    const code = Array.isArray(joined) ? joined[0]?.code : joined?.code;
    if (code) codes.add(normalizeCarrierCode(code));
  }
  return Array.from(codes);
}

async function resolveCarrierForBody(supabase: ReturnType<typeof createClient>, body: any, activeCarrierCode: string) {
  const action = String(body?.action || "");
  const activeCarrier = normalizeCarrierCode(activeCarrierCode);

  if (action === "sync-order") {
    if (!body.order_id) return { carrierCode: activeCarrier, fallbackUsed: false, fallbackReason: null };

    const active = await getCarrier(supabase, activeCarrier);
    if (!active || !active.enabled) {
      return {
        carrierCode: FALLBACK_CARRIER_CODE,
        fallbackUsed: activeCarrier !== FALLBACK_CARRIER_CODE,
        fallbackReason: !active ? `Carrier "${activeCarrier}" is not configured` : `Carrier "${activeCarrier}" is disabled`,
      };
    }

    if (activeCarrier === FALLBACK_CARRIER_CODE) {
      return { carrierCode: activeCarrier, fallbackUsed: false, fallbackReason: null };
    }

    const order = await getOrderForSync(supabase, String(body.order_id));
    if (!order) {
      return { carrierCode: activeCarrier, fallbackUsed: false, fallbackReason: null };
    }

    const coverage = await carrierCoversCity(supabase, active.id, order.customer_city);
    if (!coverage.covered) {
      await logUnmatchedCity(supabase, {
        carrierId: active.id,
        fallbackCarrierCode: FALLBACK_CARRIER_CODE,
        inputCity: order.customer_city,
        reason: coverage.reason,
        order,
      });
      return {
        carrierCode: FALLBACK_CARRIER_CODE,
        fallbackUsed: true,
        fallbackReason: `${coverage.reason}; falling back to PostEx`,
      };
    }

    return { carrierCode: activeCarrier, fallbackUsed: false, fallbackReason: null };
  }

  if (action === "track" || action === "track-by-carrier-order-id") {
    const tracking = body.tracking_number || body.carrier_order_id || body.order_id;
    if (!tracking) return { carrierCode: activeCarrier, fallbackUsed: false, fallbackReason: null };

    const codes = await getShipmentCarrierCodes(supabase, [String(tracking)]);
    if (codes.length === 1) return { carrierCode: codes[0], fallbackUsed: false, fallbackReason: null };
    return { carrierCode: activeCarrier, fallbackUsed: false, fallbackReason: null };
  }

  if (action === "generate-labels" || action === "generate-airway-bill" || action === "generate-load-sheet") {
    const rawNumbers = body.tracking_numbers || body.tracking_number || body.carrier_order_id || body.order_id || [];
    const trackingNumbers = (Array.isArray(rawNumbers) ? rawNumbers : [rawNumbers])
      .map((value: any) => String(value || "").trim())
      .filter(Boolean);
    const codes = await getShipmentCarrierCodes(supabase, trackingNumbers);

    if (codes.length === 1) return { carrierCode: codes[0], fallbackUsed: false, fallbackReason: null };
    if (codes.length > 1) {
      throw new Error(`Mixed carrier labels are not supported in one request: ${codes.join(", ")}`);
    }
    return { carrierCode: activeCarrier, fallbackUsed: false, fallbackReason: null };
  }

  return { carrierCode: activeCarrier, fallbackUsed: false, fallbackReason: null };
}

async function invokeCarrierFunction(targetFunction: string, body: any) {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${targetFunction}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const supabase = getSupabaseAdmin();
    const activeCarrier = await getActiveCarrierCode(supabase);
    const resolved = await resolveCarrierForBody(supabase, body, activeCarrier);
    let targetCarrier = resolved.carrierCode;
    let targetFunction = functionForCarrier(targetCarrier);
    let fallbackUsed = resolved.fallbackUsed;
    let fallbackReason = resolved.fallbackReason;

    let { res, data } = await invokeCarrierFunction(targetFunction, body);

    if (
      body?.action === "sync-order" &&
      targetCarrier !== FALLBACK_CARRIER_CODE &&
      !res.ok &&
      isCityCoverageError(data)
    ) {
      fallbackUsed = true;
      fallbackReason = `${data?.error || "Carrier city coverage failed"}; falling back to PostEx`;
      targetCarrier = FALLBACK_CARRIER_CODE;
      targetFunction = functionForCarrier(targetCarrier);
      ({ res, data } = await invokeCarrierFunction(targetFunction, body));
    }

    return new Response(JSON.stringify({
      ...data,
      active_carrier_code: activeCarrier,
      target_carrier_code: targetCarrier,
      target_function: targetFunction,
      fallback_used: fallbackUsed,
      fallback_reason: fallbackReason,
    }), {
      status: res.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("carrier-shipping-sync error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
