// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_CARRIER_API_BASE = "https://apis.orio.digital/api";
const DEFAULT_CARRIER_CODE = Deno.env.get("DEFAULT_CARRIER_CODE") || "orio";

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
  if (!data) throw new Error("Default carrier is not configured");
  return data;
}

async function getCarrierConfig(supabase: ReturnType<typeof createClient>) {
  const { data: settings } = await supabase
    .from("app_settings")
    .select("key,value")
    .in("key", ["carrier_api_token", "carrier_account_number", "carrier_sync_enabled"]);

  const byKey = Object.fromEntries((settings || []).map((s: any) => [s.key, s.value]));
  const token = byKey.carrier_api_token || Deno.env.get("CARRIER_API_TOKEN");
  if (!token) throw new Error("Carrier API token is not configured");

  return {
    token,
    acno: byKey.carrier_account_number || Deno.env.get("CARRIER_ACCOUNT_NUMBER") || "OR-04820",
    enabled: byKey.carrier_sync_enabled !== "false",
    platformId: Number(Deno.env.get("CARRIER_PLATFORM_ID") || 7),
  };
}

function carrierHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function normalizeStatus(status?: string | null) {
  const value = (status || "").toLowerCase().trim();
  if (!value) return "booked";
  if (["delivered"].includes(value)) return "delivered";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  if (["ready for return"].includes(value)) return "ready_for_return";
  if (["return", "return to shipper", "returned"].includes(value)) return "returned";
  if (["failed attempt", "customer not available", "customer not answering", "refused to accept", "incomplete address"].includes(value)) return "failed_attempt";
  if (["new", "booked", "pickup ready"].includes(value)) return "booked";
  return "shipped";
}

function mapDeliveryStatus(normalizedStatus: string) {
  if (normalizedStatus === "delivered") return "delivered";
  if (normalizedStatus === "cancelled") return "cancelled";
  if (normalizedStatus === "ready_for_return") return "ready_for_return";
  if (normalizedStatus === "returned" || normalizedStatus === "return_received") return "return";
  if (normalizedStatus === "failed_attempt") return "failed_attempt";
  if (normalizedStatus === "booked") return "booked";
  return "shipped";
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
  const res = await fetch(`${DEFAULT_CARRIER_API_BASE}/cities`, {
    method: "POST",
    headers: carrierHeaders(cfg.token),
    body: JSON.stringify({ acno: cfg.acno, country_id: 1 }),
  });

  if (!res.ok) {
    throw new Error(`Carrier cities API error: ${res.status} ${await res.text()}`);
  }

  const cities = await res.json();
  await supabase.from("carrier_city_cache").delete().eq("carrier_id", carrier.id);

  const rows = (Array.isArray(cities) ? cities : []).map((c: any) => ({
    carrier_id: carrier.id,
    carrier_city_id: String(c.id ?? c.city_id ?? ""),
    city_name: c.city_name || c.name,
    province_name: c.province_name || (c.province_id ? String(c.province_id) : null),
    is_pickup_city: true,
    is_delivery_city: true,
    cached_at: new Date().toISOString(),
  })).filter((row: any) => row.city_name);

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("carrier_city_cache").insert(rows.slice(i, i + 200));
    if (error) throw error;
  }

  return rows;
}

async function findShipmentByCarrierOrderId(supabase: ReturnType<typeof createClient>, carrierOrderId: string) {
  const carrier = await getCarrier(supabase);
  const { data, error } = await supabase
    .from("shipments")
    .select("*, carriers(*)")
    .eq("carrier_id", carrier.id)
    .eq("carrier_order_id", String(carrierOrderId))
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
      sync_error: `City not found: "${order.customer_city}"`,
    };
    if (existing) await supabase.from("shipments").update(payload).eq("id", existing.id);
    else await supabase.from("shipments").insert(payload);
    throw new Error(`City not found: "${order.customer_city}"`);
  }

  const lahore = cities.find((c: any) => (c.city_name || "").toLowerCase() === "lahore");
  const originCityId = Number(lahore?.carrier_city_id || 375);
  const originProvinceId = Number(lahore?.province_name || 4);

  const carrierOrder = {
    acno: cfg.acno,
    shipper_name: "COD Pakistani",
    shipper_email: "Badereddine@gmail.com",
    shipper_address: "Lahore",
    shipper_contact: "03332259447",
    billingperson_name: "COD Pakistani",
    billingperson_email: "Badereddine@gmail.com",
    billingperson_address: "Lahore",
    billingperson_contact: "03332259447",
    consignee_name: order.customer_name || "Customer",
    consignee_address: order.customer_address || order.customer_city || "N/A",
    consignee_email: "customer@na.com",
    consignee_contact: order.customer_phone || "03000000000",
    consignee_latitude: 0,
    consignee_longitude: 0,
    origin_country_id: 1,
    origin_province_id: originProvinceId,
    origin_city_id: originCityId,
    destination_country_id: 1,
    destination_province_id: Number(matchedCity.province_name || 1),
    destination_city_id: Number(matchedCity.carrier_city_id),
    cnic_number: "0000000000000",
    order_ref: order.order_id,
    platform_id: cfg.platformId,
    customer_platform_id: 5120,
    payment_method_id: 1,
    shipping_charges: Number(order.shipping_cost || 0),
    piece: order.quantity || 1,
    weight: Number(order.weight || 0.5),
    order_amount: Number(order.total_amount || 0),
    detail: [{
      product_name: order.product_name || "Product",
      product_code: order.order_id || "N/A",
      quantity: order.quantity || 1,
      amount: Number(order.total_amount || 0),
      image_url: order.product_url || "",
    }],
    remarks: order.note || "",
  };

  const res = await fetch(`${DEFAULT_CARRIER_API_BASE}/order`, {
    method: "POST",
    headers: carrierHeaders(cfg.token),
    body: JSON.stringify([carrierOrder]),
  });

  const responseText = await res.text();
  let responseData: any;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = { raw: responseText };
  }

  if (!res.ok || responseData.status === 0) {
    const errorMsg = responseData?.message || responseData?.payload?.error || responseText;
    const payload = {
      order_uuid: order.id,
      order_id: order.order_id,
      carrier_id: carrier.id,
      sync_status: "failed",
      sync_error: `Carrier error: ${JSON.stringify(errorMsg).substring(0, 500)}`,
      raw_create_response: responseData,
    };
    if (existing) await supabase.from("shipments").update(payload).eq("id", existing.id);
    else await supabase.from("shipments").insert(payload);
    throw new Error(`Carrier create order failed: ${JSON.stringify(errorMsg).substring(0, 200)}`);
  }

  const carrierOrderId = responseData?.payload?.[0]?.order_id || responseData?.data?.[0]?.order_id || responseData?.payload?.order_id;
  const trackingNumber = responseData?.payload?.[0]?.consigment_no || responseData?.data?.[0]?.consigment_no || null;
  if (!carrierOrderId) throw new Error("Carrier response missing order_id");

  const shipmentPayload = {
    order_uuid: order.id,
    order_id: order.order_id,
    carrier_id: carrier.id,
    carrier_order_id: String(carrierOrderId),
    tracking_number: trackingNumber,
    carrier_status: "booked",
    normalized_status: "booked",
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
    delivery_status: "booked",
    fulfillment_status: carrier.fulfillment_mode === "self_fulfilled" ? "pending" : "carrier_managed",
    shipping_company: carrier.name,
    shipping_status: "booked",
    shipped_at: new Date().toISOString(),
  }).eq("id", order.id);

  if (carrier.fulfillment_mode === "self_fulfilled") {
    await supabase.from("fulfillment_items").upsert({
      order_uuid: order.id,
      order_id: order.order_id,
      shipment_id: shipment.id,
      status: "pending",
    }, { onConflict: "shipment_id" });
  }

  return { success: true, shipment, carrier_order_id: String(carrierOrderId), tracking_number: trackingNumber, response: responseData };
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

async function trackByCarrierOrderId(supabase: ReturnType<typeof createClient>, carrierOrderId: string) {
  const cfg = await getCarrierConfig(supabase);
  const res = await fetch(`${DEFAULT_CARRIER_API_BASE}/track`, {
    method: "POST",
    headers: carrierHeaders(cfg.token),
    body: JSON.stringify({ order_id: carrierOrderId, acno: cfg.acno }),
  });
  const data = await res.json();
  const payload = Array.isArray(data) && data[0]?.payload ? data[0].payload : data?.payload || data;

  const shipment = await findShipmentByCarrierOrderId(supabase, carrierOrderId);
  if (shipment && payload?.status) {
    const normalized = normalizeStatus(payload.status);
    await supabase.from("shipments").update({
      tracking_number: payload.consigment_no || shipment.tracking_number,
      carrier_status: payload.status,
      normalized_status: normalized,
      last_synced_at: new Date().toISOString(),
      raw_tracking_response: data,
    }).eq("id", shipment.id);
    await supabase.from("shipment_events").insert({
      shipment_id: shipment.id,
      carrier_status: payload.status,
      normalized_status: normalized,
      raw_event: payload,
    });
    await supabase.from("orders").update({
      delivery_status: mapDeliveryStatus(normalized),
      shipping_status: payload.status,
      delivered_at: normalized === "delivered" ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString(),
    }).eq("id", shipment.order_uuid);
  }

  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { action, order_id, carrier_order_id } = body;
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
        if (!order_id) throw new Error("order_id required");
        result = await syncConfirmedOrder(supabase, order_id);
        break;
      case "track-by-carrier-order-id":
        if (!carrier_order_id) throw new Error("carrier_order_id required");
        result = await trackByCarrierOrderId(supabase, String(carrier_order_id));
        break;
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
