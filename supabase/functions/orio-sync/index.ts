import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ORIO_BASE = "https://apis.orio.digital/api";

function getOrioConfig() {
  const token = Deno.env.get("ORIO_API_TOKEN");
  if (!token) throw new Error("ORIO_API_TOKEN not configured");
  return {
    token,
    acno: "OR-04820",
    platformId: 7,
  };
}

function orioHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// ─── Cities (v1) ───
async function getCities(supabase: ReturnType<typeof createClient>) {
  const { data: cached } = await supabase
    .from("orio_cities_cache")
    .select("*")
    .gt("cached_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1);

  if (cached && cached.length > 0) {
    // Load all cities in batches to avoid the 1000 row default limit
    let allCities: any[] = [];
    const batchSize = 1000;
    let from = 0;
    while (true) {
      const { data: batch } = await supabase
        .from("orio_cities_cache")
        .select("*")
        .range(from, from + batchSize - 1);
      if (!batch || batch.length === 0) break;
      allCities = allCities.concat(batch);
      if (batch.length < batchSize) break;
      from += batchSize;
    }
    return allCities;
  }

  const cfg = getOrioConfig();
  const res = await fetch(`${ORIO_BASE}/cities`, {
    method: "POST",
    headers: orioHeaders(cfg.token),
    body: JSON.stringify({ acno: cfg.acno, country_id: 1 }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ORIO cities API error: ${res.status} ${t}`);
  }

  const cities = await res.json();

  // Clear old cache and insert fresh
  await supabase.from("orio_cities_cache").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  if (Array.isArray(cities) && cities.length > 0) {
    const rows = cities.map((c: any) => ({
      city_id: parseInt(c.id, 10),
      city_name: c.city_name,
      province_id: c.province_id ? parseInt(c.province_id, 10) : null,
      cached_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 200) {
      await supabase.from("orio_cities_cache").insert(rows.slice(i, i + 200));
    }
  }

  return cities.map((c: any) => ({
    city_id: parseInt(c.id, 10),
    city_name: c.city_name,
    province_id: c.province_id ? parseInt(c.province_id, 10) : null,
  }));
}

// ─── Create Shipment (v1: POST /api/order with array body) ───
async function createShipment(
  supabase: ReturnType<typeof createClient>,
  order: any
) {
  if (order.orio_order_id || order.orio_sync_status === "synced") {
    return { skipped: true, reason: "Already synced" };
  }

  const cfg = getOrioConfig();

  // Resolve city — robust matching: exact, then whitespace-stripped
  const cities = await getCities(supabase);
  console.log(`Cities loaded: ${cities.length}, looking for: "${order.customer_city}"`);
  const rawCity = (order.customer_city || "").trim().toLowerCase();
  const stripped = rawCity.replace(/\s+/g, "");
  const matchedCity =
    cities.find((c: any) => (c.city_name || "").trim().toLowerCase() === rawCity) ||
    cities.find((c: any) => (c.city_name || "").trim().toLowerCase().replace(/\s+/g, "") === stripped);

  if (!matchedCity) {
    await supabase
      .from("orders")
      .update({
        orio_sync_status: "failed",
        orio_sync_error: `City not found: "${order.customer_city}"`,
      })
      .eq("id", order.id);
    throw new Error(`City not found: "${order.customer_city}"`);
  }

  // Find origin city (Lahore default, id varies)
  const lahore = cities.find((c: any) => (c.city_name || "").toLowerCase() === "lahore");
  const originCityId = lahore ? lahore.city_id : 375;
  const originProvinceId = lahore ? lahore.province_id : 4;

  // v1 order format
  const orioOrder = {
    acno: cfg.acno,
    // Shipper info (our company)
    shipper_name: "COD Pakistani",
    shipper_email: "Badereddine@gmail.com",
    shipper_address: "Lahore",
    shipper_contact: "03332259447",
    // Billing (same as shipper)
    billingperson_name: "COD Pakistani",
    billingperson_email: "Badereddine@gmail.com",
    billingperson_address: "Lahore",
    billingperson_contact: "03332259447",
    // Consignee
    consignee_name: order.customer_name || "Customer",
    consignee_address: order.customer_address || order.customer_city || "N/A",
    consignee_email: "customer@na.com",
    consignee_contact: order.customer_phone || "03000000000",
    consignee_latitude: 0,
    consignee_longitude: 0,
    // Location
    origin_country_id: 1,
    origin_province_id: originProvinceId,
    origin_city_id: originCityId,
    destination_country_id: 1,
    destination_province_id: matchedCity.province_id || 1,
    destination_city_id: matchedCity.city_id,
    // Order details
    cnic_number: "0000000000000",
    order_ref: order.order_id,
    platform_id: cfg.platformId,
    customer_platform_id: 5120,
    payment_method_id: 1, // COD
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

  console.log("Sending ORIO order:", JSON.stringify(orioOrder));

  const res = await fetch(`${ORIO_BASE}/order`, {
    method: "POST",
    headers: orioHeaders(cfg.token),
    body: JSON.stringify([orioOrder]),
  });

  const responseText = await res.text();
  console.log("ORIO response:", responseText);

  let responseData: any;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = { raw: responseText };
  }

  if (!res.ok || responseData.status === 0) {
    const errorMsg = responseData?.message || responseData?.payload?.error || responseText;
    await supabase
      .from("orders")
      .update({
        orio_sync_status: "failed",
        orio_sync_error: `ORIO error: ${JSON.stringify(errorMsg).substring(0, 500)}`,
      })
      .eq("id", order.id);
    throw new Error(`ORIO create order failed: ${JSON.stringify(errorMsg).substring(0, 200)}`);
  }

  // Extract order ID from response
  const orioOrderId = responseData?.payload?.[0]?.order_id
    || responseData?.data?.[0]?.order_id
    || responseData?.payload?.order_id;

  const consignmentNo = responseData?.payload?.[0]?.consigment_no
    || responseData?.data?.[0]?.consigment_no
    || null;

  // Guard: ORIO returned 200 but no order_id — treat as failed so it stays visible & retryable
  if (!orioOrderId) {
    await supabase
      .from("orders")
      .update({
        orio_sync_status: "failed",
        orio_sync_error: "ORIO returned 200 but no order_id in response",
      })
      .eq("id", order.id);
    throw new Error("ORIO response missing order_id");
  }

  await supabase
    .from("orders")
    .update({
      orio_order_id: orioOrderId,
      orio_consignment_no: consignmentNo,
      orio_sync_status: "synced",
      orio_sync_error: null,
      orio_synced_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  return { success: true, orio_order_id: orioOrderId, consignment_no: consignmentNo, response: responseData };
}

// ─── Track Shipment (v1: POST /api/track) ───
async function trackShipment(
  supabase: ReturnType<typeof createClient>,
  orderId: string
) {
  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (!order?.orio_order_id) throw new Error("No ORIO order ID for tracking");

  const cfg = getOrioConfig();
  const res = await fetch(`${ORIO_BASE}/track`, {
    method: "POST",
    headers: orioHeaders(cfg.token),
    body: JSON.stringify({
      order_id: order.orio_order_id,
      acno: cfg.acno,
    }),
  });

  const data = await res.json();

  if (data.status === "1" && data.payload) {
    await supabase
      .from("orders")
      .update({
        orio_consignment_no: data.payload.consigment_no,
        orio_shipping_status: data.payload.status,
      })
      .eq("id", orderId);

    return data.payload;
  }

  return data;
}

// ─── Sync confirmed order ───
async function syncConfirmedOrder(
  supabase: ReturnType<typeof createClient>,
  orderIdOrDbId: string
) {
  let { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderIdOrDbId)
    .maybeSingle();

  if (!order) {
    const result = await supabase
      .from("orders")
      .select("*")
      .eq("order_id", orderIdOrDbId)
      .maybeSingle();
    order = result.data;
  }

  if (!order) throw new Error(`Order not found: ${orderIdOrDbId}`);
  if (order.confirmation_status !== "confirmed") {
    return { skipped: true, reason: "Order is not confirmed" };
  }

  return await createShipment(supabase, order);
}

// ─── Main Handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { action, order_id, orio_order_id } = body;

    // Check if ORIO API is enabled (skip for read-only actions like cities/track)
    const writeActions = ["sync-order", "sync-all-pending"];
    if (writeActions.includes(action)) {
      const { data: enabledSetting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "orio_api_enabled")
        .maybeSingle();
      if (!enabledSetting || enabledSetting.value !== "true") {
        return new Response(
          JSON.stringify({ error: "ORIO API is disabled. Enable it in Settings → Integrations." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

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
        result = await trackShipment(supabase, order_id);
        break;

      case "track-by-orio-id": {
        if (!orio_order_id) throw new Error("orio_order_id required");
        const cfg = getOrioConfig();
        const res = await fetch(`${ORIO_BASE}/track`, {
          method: "POST",
          headers: orioHeaders(cfg.token),
          body: JSON.stringify({ order_id: orio_order_id, acno: cfg.acno }),
        });
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0 && data[0].payload) {
          result = data[0].payload;
        } else if (data?.payload) {
          result = data.payload;
        } else {
          result = data;
        }
        break;
      }

      case "sync-all-pending": {
        const { data: pending } = await supabase
          .from("orders")
          .select("*")
          .eq("confirmation_status", "confirmed")
          .or("orio_sync_status.is.null,orio_sync_status.eq.pending,orio_sync_status.eq.failed")
          .is("orio_order_id", null)
          .limit(50);

        const results = [];
        for (const o of pending || []) {
          try {
            const r = await createShipment(supabase, o);
            results.push({ order_id: o.order_id, ...r });
          } catch (e) {
            results.push({ order_id: o.order_id, error: (e as Error).message });
          }
        }
        result = { synced: results.length, results };
        break;
      }

      case "platforms": {
        const cfg = getOrioConfig();
        const endpoints = ["customer-platforms", "get-platforms", "platforms"];
        const platformResults: any[] = [];
        for (const ep of endpoints) {
          try {
            const res = await fetch(`${ORIO_BASE}/${ep}`, {
              method: "POST",
              headers: orioHeaders(cfg.token),
              body: JSON.stringify({ acno: cfg.acno }),
            });
            const text = await res.text();
            platformResults.push({ endpoint: ep, status: res.status, body: text.substring(0, 500) });
          } catch (e) {
            platformResults.push({ endpoint: ep, error: (e as Error).message });
          }
        }
        result = platformResults;
        break;
      }

      case "store-config": {
        const url = Deno.env.get("SUPABASE_URL")!;
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        await supabase.from("app_settings").upsert({ key: "supabase_url", value: url }, { onConflict: "key" });
        await supabase.from("app_settings").upsert({ key: "supabase_service_role_key", value: key }, { onConflict: "key" });
        result = { stored: true };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("orio-sync error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
