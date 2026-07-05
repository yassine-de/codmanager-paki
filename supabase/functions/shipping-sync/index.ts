// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const POSTEX_API_BASE = Deno.env.get("POSTEX_API_BASE") || "https://api.postex.pk/services/integration/api/order";
const DEFAULT_CARRIER_CODE = Deno.env.get("DEFAULT_CARRIER_CODE") || "postex";

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getCarrier(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("carriers")
    .select("*")
    .eq("code", DEFAULT_CARRIER_CODE)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Default carrier is not configured: ${DEFAULT_CARRIER_CODE}`);
  if (!data.enabled) throw new Error(`Default carrier is disabled: ${DEFAULT_CARRIER_CODE}`);
  return data;
}

async function getCarrierConfig(supabase: ReturnType<typeof createClient>) {
  const { data: settings } = await supabase
    .from("app_settings")
    .select("key,value")
    .in("key", [
      "carrier_api_token",
      "carrier_sync_enabled",
      "carrier_pickup_address",
      "carrier_pickup_address_code",
      "postex_api_token",
      "postex_pickup_address",
      "postex_pickup_address_code",
    ]);

  const byKey = Object.fromEntries((settings || []).map((s: any) => [s.key, s.value]));
  const token = byKey.postex_api_token || byKey.carrier_api_token || Deno.env.get("POSTEX_API_TOKEN") || Deno.env.get("CARRIER_API_TOKEN");
  if (!token) throw new Error("PostEx API token is not configured");

  return {
    token,
    enabled: byKey.carrier_sync_enabled !== "false",
    pickupAddress: byKey.postex_pickup_address || byKey.carrier_pickup_address || Deno.env.get("POSTEX_PICKUP_ADDRESS") || "",
    pickupAddressCode: byKey.postex_pickup_address_code || byKey.carrier_pickup_address_code || Deno.env.get("POSTEX_PICKUP_ADDRESS_CODE") || "",
  };
}

function postexHeaders(token: string) {
  return {
    token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function normalizeStatus(status?: string | null, code?: string | null) {
  const value = (status || "").toLowerCase().trim();
  const messageCode = String(code || "").trim();
  if (messageCode === "0005" || value === "delivered") return "delivered";
  if (["0002", "0006", "0007"].includes(messageCode) || value === "returned") return "returned";
  if (messageCode === "0013" || value === "attempted") return "failed_attempt";
  if (value === "out for return") return "ready_for_return";
  if (value === "out for delivery") return "out_for_delivery";
  if (["postex warehouse", "picked by postex", "en-route to postex warehouse", "package on root", "package on route"].includes(value)) return "in_transit";
  if (["unbooked", "booked", "at merchant's warehouse", "at merchant warehouse", "un-assigned by me"].includes(value)) return "booked";
  if (value === "delivery under review") return "failed_attempt";
  if (value === "expired") return "cancelled";
  return value ? "shipped" : "booked";
}

function mapDeliveryStatus(normalizedStatus: string) {
  if (normalizedStatus === "delivered") return "delivered";
  if (normalizedStatus === "cancelled") return "cancelled";
  if (normalizedStatus === "ready_for_return") return "ready_for_return";
  if (normalizedStatus === "returned" || normalizedStatus === "return_received") return "return";
  if (normalizedStatus === "failed_attempt") return "failed_attempt";
  if (normalizedStatus === "out_for_delivery") return "with_courier";
  if (normalizedStatus === "booked") return "booked";
  return "shipped";
}

function latestTrackingStatus(payload: any) {
  const history = payload?.transactionStatusHistory;
  if (Array.isArray(history) && history.length > 0) {
    const last = history[history.length - 1];
    return {
      status: last.transactionStatusMessage || payload.transactionStatus,
      code: last.transactionStatusMessageCode,
    };
  }
  return { status: payload?.transactionStatus || payload?.orderStatus, code: null };
}

function buildOrderDetail(order: any) {
  const parts = [];
  if (order.product_name) parts.push(`${order.product_name} x ${order.quantity || 1}`);
  if (order.order_id) parts.push(`Ref: ${order.order_id}`);
  return parts.join(" | ") || "COD order";
}

async function getCities(supabase: ReturnType<typeof createClient>) {
  const carrier = await getCarrier(supabase);
  const { data: cached } = await supabase
    .from("carrier_city_cache")
    .select("*")
    .eq("carrier_id", carrier.id)
    .gt("cached_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1);

  if (cached && cached.length > 0) {
    const allCities: any[] = [];
    const batchSize = 1000;
    let from = 0;
    while (true) {
      const { data: batch, error } = await supabase
        .from("carrier_city_cache")
        .select("*")
        .eq("carrier_id", carrier.id)
        .order("city_name")
        .range(from, from + batchSize - 1);
      if (error) throw error;
      if (!batch || batch.length === 0) break;
      allCities.push(...batch);
      if (batch.length < batchSize) break;
      from += batchSize;
    }
    return allCities;
  }

  const cfg = await getCarrierConfig(supabase);
  const res = await fetch(`${POSTEX_API_BASE}/v2/get-operational-city?operationalCityType=delivery`, {
    method: "GET",
    headers: postexHeaders(cfg.token),
  });
  const data = await res.json();
  if (!res.ok || String(data?.statusCode || "") !== "200") {
    throw new Error(`PostEx cities API error: ${res.status} ${JSON.stringify(data).substring(0, 500)}`);
  }

  await supabase.from("carrier_city_cache").delete().eq("carrier_id", carrier.id);
  const rows = (Array.isArray(data.dist) ? data.dist : []).map((city: any) => ({
    carrier_id: carrier.id,
    carrier_city_id: city.operationalCityName,
    city_name: city.operationalCityName,
    province_name: city.countryName || "Pakistan",
    is_pickup_city: String(city.isPickupCity).toLowerCase() === "true",
    is_delivery_city: String(city.isDeliveryCity).toLowerCase() === "true",
    cached_at: new Date().toISOString(),
  })).filter((row: any) => row.city_name);

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("carrier_city_cache").insert(rows.slice(i, i + 200));
    if (error) throw error;
  }
  return rows;
}

async function findShipmentByTracking(supabase: ReturnType<typeof createClient>, trackingNumber: string) {
  const carrier = await getCarrier(supabase);
  const { data, error } = await supabase
    .from("shipments")
    .select("*, carriers(*)")
    .eq("carrier_id", carrier.id)
    .or(`tracking_number.eq.${trackingNumber},carrier_order_id.eq.${trackingNumber}`)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createShipment(supabase: ReturnType<typeof createClient>, order: any) {
  const carrier = await getCarrier(supabase);
  const { data: existing } = await supabase
    .from("shipments")
    .select("*")
    .eq("order_uuid", order.id)
    .eq("carrier_id", carrier.id)
    .maybeSingle();
  if (existing?.sync_status === "synced") {
    return { skipped: true, reason: "Already synced", shipment: existing };
  }

  const cfg = await getCarrierConfig(supabase);
  if (!cfg.enabled) throw new Error("Carrier API is disabled");

  const cities = await getCities(supabase);
  const rawCity = (order.customer_city || "").trim().toLowerCase();
  const stripped = rawCity.replace(/\s+/g, "");
  const matchedCity =
    cities.find((c: any) => (c.city_name || "").trim().toLowerCase() === rawCity) ||
    cities.find((c: any) => (c.city_name || "").trim().toLowerCase().replace(/\s+/g, "") === stripped);

  if (!matchedCity) {
    const payload = {
      order_uuid: order.id,
      order_id: order.order_id,
      carrier_id: carrier.id,
      sync_status: "failed",
      sync_error: `PostEx city not found: "${order.customer_city}"`,
    };
    if (existing) await supabase.from("shipments").update(payload).eq("id", existing.id);
    else await supabase.from("shipments").insert(payload);
    throw new Error(`PostEx city not found: "${order.customer_city}"`);
  }

  const postexOrder: Record<string, unknown> = {
    cityName: matchedCity.city_name,
    customerName: order.customer_name || "Customer",
    customerPhone: order.customer_phone || "03000000000",
    deliveryAddress: order.customer_address || order.customer_city || "N/A",
    invoiceDivision: 1,
    invoicePayment: Number(order.total_amount || 0),
    items: Number(order.quantity || 1),
    orderDetail: buildOrderDetail(order),
    orderRefNumber: order.order_id,
    orderType: "Normal",
    transactionNotes: order.note || "",
  };
  if (cfg.pickupAddressCode) postexOrder.pickupAddressCode = cfg.pickupAddressCode;

  const res = await fetch(`${POSTEX_API_BASE}/v3/create-order`, {
    method: "POST",
    headers: postexHeaders(cfg.token),
    body: JSON.stringify(postexOrder),
  });
  const responseText = await res.text();
  let responseData: any;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = { raw: responseText };
  }

  if (!res.ok || String(responseData?.statusCode || "") !== "200") {
    const errorMsg = responseData?.statusMessage || responseData?.message || responseText;
    const payload = {
      order_uuid: order.id,
      order_id: order.order_id,
      carrier_id: carrier.id,
      sync_status: "failed",
      sync_error: `PostEx error: ${JSON.stringify(errorMsg).substring(0, 500)}`,
      raw_create_response: responseData,
    };
    if (existing) await supabase.from("shipments").update(payload).eq("id", existing.id);
    else await supabase.from("shipments").insert(payload);
    throw new Error(`PostEx create order failed: ${JSON.stringify(errorMsg).substring(0, 200)}`);
  }

  const trackingNumber = responseData?.dist?.trackingNumber;
  if (!trackingNumber) throw new Error("PostEx response missing trackingNumber");

  const carrierStatus = responseData?.dist?.orderStatus || "UnBooked";
  const normalizedStatus = normalizeStatus(carrierStatus);
  const shipmentPayload = {
    order_uuid: order.id,
    order_id: order.order_id,
    carrier_id: carrier.id,
    carrier_order_id: String(trackingNumber),
    tracking_number: String(trackingNumber),
    carrier_status: carrierStatus,
    normalized_status: normalizedStatus,
    sync_status: "synced",
    sync_error: null,
    booked_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    raw_create_response: responseData,
  };

  let shipment = existing;
  if (existing) {
    const { data, error } = await supabase.from("shipments").update(shipmentPayload).eq("id", existing.id).select("*").single();
    if (error) throw error;
    shipment = data;
  } else {
    const { data, error } = await supabase.from("shipments").insert(shipmentPayload).select("*").single();
    if (error) throw error;
    shipment = data;
  }

  await supabase.from("orders").update({
    delivery_status: mapDeliveryStatus(normalizedStatus),
    fulfillment_status: carrier.fulfillment_mode === "self_fulfilled" ? "pending" : "carrier_managed",
    shipping_company: carrier.name,
    shipping_status: carrierStatus,
    shipped_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", order.id);

  if (carrier.fulfillment_mode === "self_fulfilled") {
    await supabase.from("fulfillment_items").upsert({
      order_uuid: order.id,
      order_id: order.order_id,
      shipment_id: shipment.id,
      status: "pending",
    }, { onConflict: "shipment_id" });
  }

  return { success: true, shipment, carrier_order_id: String(trackingNumber), tracking_number: String(trackingNumber), response: responseData };
}

async function syncConfirmedOrder(supabase: ReturnType<typeof createClient>, orderIdOrDbId: string) {
  let { data: order } = await supabase.from("orders").select("*").eq("id", orderIdOrDbId).maybeSingle();
  if (!order) {
    const result = await supabase.from("orders").select("*").eq("order_id", orderIdOrDbId).maybeSingle();
    order = result.data;
  }
  if (!order) throw new Error(`Order not found: ${orderIdOrDbId}`);
  if (order.confirmation_status !== "confirmed") return { skipped: true, reason: "Order is not confirmed" };
  return createShipment(supabase, order);
}

async function trackByTrackingNumber(supabase: ReturnType<typeof createClient>, trackingNumber: string) {
  const cfg = await getCarrierConfig(supabase);
  const res = await fetch(`${POSTEX_API_BASE}/v1/track-order/${encodeURIComponent(trackingNumber)}`, {
    method: "GET",
    headers: postexHeaders(cfg.token),
  });
  const data = await res.json();
  if (!res.ok || String(data?.statusCode || "") !== "200") {
    throw new Error(`PostEx tracking failed: ${JSON.stringify(data).substring(0, 300)}`);
  }

  const payload = data?.dist || data;
  const status = latestTrackingStatus(payload);
  const normalized = normalizeStatus(status.status, status.code);
  const shipment = await findShipmentByTracking(supabase, trackingNumber);

  if (shipment) {
    const now = new Date().toISOString();
    await supabase.from("shipments").update({
      tracking_number: payload.trackingNumber || shipment.tracking_number,
      carrier_status: status.status,
      normalized_status: normalized,
      sync_status: "synced",
      sync_error: null,
      last_synced_at: now,
      raw_tracking_response: data,
    }).eq("id", shipment.id);
    await supabase.from("shipment_events").insert({
      shipment_id: shipment.id,
      carrier_status: status.status,
      normalized_status: normalized,
      raw_event: payload,
      occurred_at: now,
    });
    await supabase.from("orders").update({
      delivery_status: mapDeliveryStatus(normalized),
      shipping_status: status.status,
      delivered_at: normalized === "delivered" ? now : undefined,
      updated_at: now,
    }).eq("id", shipment.order_uuid);
  }

  return payload;
}

async function generateLoadSheet(supabase: ReturnType<typeof createClient>, trackingNumbers: string[]) {
  const cfg = await getCarrierConfig(supabase);
  if (trackingNumbers.length === 0) throw new Error("tracking_numbers required");
  const res = await fetch(`${POSTEX_API_BASE}/v2/generate-load-sheet`, {
    method: "POST",
    headers: postexHeaders(cfg.token),
    body: JSON.stringify({
      pickupAddress: cfg.pickupAddress || undefined,
      trackingNumbers,
    }),
  });
  const contentType = res.headers.get("content-type") || "";
  const bytes = await res.arrayBuffer();
  if (!res.ok) {
    const text = new TextDecoder().decode(bytes);
    throw new Error(`PostEx load sheet failed: ${text.substring(0, 300)}`);
  }
  return {
    success: true,
    content_type: contentType,
    pdf_base64: btoa(String.fromCharCode(...new Uint8Array(bytes))),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { action, order_id, carrier_order_id, tracking_number, tracking_numbers } = body;
    let result: any;

    switch (action) {
      case "cities":
        result = await getCities(supabase);
        break;
      case "sync-order":
        if (!order_id) throw new Error("order_id required");
        result = await syncConfirmedOrder(supabase, order_id);
        break;
      case "track":
      case "track-by-carrier-order-id": {
        const tracking = tracking_number || carrier_order_id || order_id;
        if (!tracking) throw new Error("tracking_number required");
        result = await trackByTrackingNumber(supabase, String(tracking));
        break;
      }
      case "sync-all-pending": {
        const { data: pending, error } = await supabase
          .from("orders")
          .select("*")
          .eq("confirmation_status", "confirmed")
          .limit(50);
        if (error) throw error;
        const results = [];
        for (const order of pending || []) {
          try {
            results.push({ order_id: order.order_id, ...(await createShipment(supabase, order)) });
          } catch (e) {
            results.push({ order_id: order.order_id, error: (e as Error).message });
          }
        }
        result = { synced: results.length, results };
        break;
      }
      case "generate-load-sheet": {
        result = await generateLoadSheet(supabase, (tracking_numbers || []).map(String));
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("shipping-sync error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
