// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MNP_API_BASE = Deno.env.get("MNP_API_BASE") || "https://mnpcourier.com/mycodapi/api";
const MNP_TRACKING_BASE = Deno.env.get("MNP_TRACKING_BASE") || "https://tracking.mulphilog.com.pk/api";
const MNP_LABEL_BASE = Deno.env.get("MNP_LABEL_BASE") || "https://mnpcourier.com/mycodapi";
const CARRIER_CODE = "mnp";

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getCarrier(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("carriers")
    .select("*")
    .eq("code", CARRIER_CODE)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("M&P carrier is not configured");
  if (!data.enabled) throw new Error("M&P carrier is disabled");
  return data;
}

async function getMnpConfig(supabase: ReturnType<typeof createClient>) {
  const keys = [
    "mnp_username",
    "mnp_password",
    "mnp_account_no",
    "mnp_location_id",
    "mnp_return_location",
    "mnp_sub_account_id",
    "mnp_insert_type",
    "mnp_service",
    "mnp_default_weight",
    "mnp_default_fragile",
    "mnp_insurance_value",
    "mnp_label_type",
  ];
  const { data: settings } = await supabase.from("app_settings").select("key,value").in("key", keys);
  const byKey = Object.fromEntries((settings || []).map((s: any) => [s.key, s.value]));

  const cfg = {
    username: byKey.mnp_username || Deno.env.get("MNP_USERNAME") || "",
    password: byKey.mnp_password || Deno.env.get("MNP_PASSWORD") || "",
    accountNo: byKey.mnp_account_no || Deno.env.get("MNP_ACCOUNT_NO") || "",
    locationId: byKey.mnp_location_id || Deno.env.get("MNP_LOCATION_ID") || "",
    returnLocation: byKey.mnp_return_location || Deno.env.get("MNP_RETURN_LOCATION") || "",
    subAccountId: byKey.mnp_sub_account_id || Deno.env.get("MNP_SUB_ACCOUNT_ID") || "",
    insertType: Number(byKey.mnp_insert_type || Deno.env.get("MNP_INSERT_TYPE") || 19),
    service: byKey.mnp_service || Deno.env.get("MNP_SERVICE") || "Overnight",
    defaultWeight: Number(byKey.mnp_default_weight || Deno.env.get("MNP_DEFAULT_WEIGHT") || 1),
    fragile: byKey.mnp_default_fragile || Deno.env.get("MNP_DEFAULT_FRAGILE") || "NO",
    insuranceValue: byKey.mnp_insurance_value || Deno.env.get("MNP_INSURANCE_VALUE") || "0",
    labelType: Number(byKey.mnp_label_type || Deno.env.get("MNP_LABEL_TYPE") || 3),
  };

  for (const [key, value] of Object.entries({
    username: cfg.username,
    password: cfg.password,
    accountNo: cfg.accountNo,
    locationId: cfg.locationId,
    returnLocation: cfg.returnLocation,
    subAccountId: cfg.subAccountId,
  })) {
    if (!value) throw new Error(`M&P config missing: ${key}`);
  }

  return cfg;
}

function normalizePhone(phone?: string | null) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("92") && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith("3") && digits.length === 10) return `0${digits}`;
  return digits || "03000000000";
}

function normalizeStatus(status?: string | null) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "booked") return "booked";
  if (value.includes("deliver") && !value.includes("undeliver")) return "delivered";
  if (value.includes("return to shipper") || value === "returned" || value.includes("returned")) return "returned";
  if (value.includes("out for delivery")) return "out_for_delivery";
  if (value.includes("attempt") || value.includes("undeliver") || value.includes("consignee not")) return "failed_attempt";
  if (value.includes("handed over") || value.includes("arrived") || value.includes("depart") || value.includes("transit") || value.includes("in-process")) return "in_transit";
  return "carrier_unknown";
}

function mapDeliveryStatus(normalizedStatus: string, currentStatus?: string | null) {
  if (normalizedStatus === "delivered") return "delivered";
  if (normalizedStatus === "returned") return "return";
  if (normalizedStatus === "failed_attempt") return "failed_attempt";
  if (normalizedStatus === "out_for_delivery") return "with_courier";
  if (normalizedStatus === "in_transit") return "shipped";
  if (normalizedStatus === "booked" || normalizedStatus === "carrier_unknown") {
    const locked = ["printed", "dispatched", "shipped", "in_transit", "with_courier", "out_for_delivery", "delivered", "failed_attempt", "ready_for_return", "return", "returned", "cancelled", "out_of_stock"];
    return currentStatus && locked.includes(currentStatus) ? currentStatus : "booked";
  }
  return currentStatus || "booked";
}

function shouldSetShippedAt(deliveryStatus: string) {
  return ["shipped", "in_transit", "with_courier", "delivered", "failed_attempt", "ready_for_return", "return"].includes(deliveryStatus);
}

function buildProductDetails(order: any) {
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  const details = items.length > 0
    ? items.map((item: any) => `${item.product_name || item.sku || "Product"} x ${item.quantity || 1}`).join(" | ")
    : `${order.product_name || "COD order"} x ${order.quantity || 1}`;
  return details.substring(0, 600);
}

async function mnpGet(path: string, params: Record<string, string | number>) {
  const url = new URL(`${MNP_API_BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json();
  if (!res.ok) throw new Error(`M&P API failed: ${res.status} ${JSON.stringify(data).substring(0, 300)}`);
  return data;
}

async function mnpPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${MNP_API_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`M&P API failed: ${res.status} ${JSON.stringify(data).substring(0, 300)}`);
  return data;
}

function base64Encode(text: string) {
  const bytes = new TextEncoder().encode(text);
  return base64EncodeBytes(bytes);
}

function base64EncodeBytes(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

function looksLikePdf(bytes: Uint8Array) {
  if (bytes.length < 5) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

async function mergePdfs(pdfs: Uint8Array[]) {
  if (pdfs.length === 1) return pdfs[0];

  const merged = await PDFDocument.create();
  for (const pdf of pdfs) {
    const source = await PDFDocument.load(pdf);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return await merged.save();
}

function extractHtmlBody(html: string) {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : html;
}

function extractHtmlHead(html: string) {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return match ? match[1] : "";
}

function buildPrintableLabelHtml(labels: string[]) {
  const head = labels.map(extractHtmlHead).filter(Boolean).join("\n");
  const body = labels
    .map((html, index) => `<section class="mnp-label-page">${extractHtmlBody(html)}</section>${index < labels.length - 1 ? '<div class="mnp-page-break"></div>' : ""}`)
    .join("\n");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${MNP_LABEL_BASE.replace(/\/$/, "")}/">
  ${head}
  <style>
    @page { size: A4; margin: 8mm; }
    body { margin: 0; background: #fff; }
    .mnp-page-break { break-after: page; page-break-after: always; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

async function generateLabels(supabase: ReturnType<typeof createClient>, trackingNumbers: string[]) {
  await getCarrier(supabase);
  const cfg = await getMnpConfig(supabase);
  const numbers = Array.from(new Set((trackingNumbers || []).map((value) => String(value || "").trim()).filter(Boolean)));
  if (numbers.length === 0) throw new Error("tracking_numbers required");

  const labels: string[] = [];
  const pdfLabels: Uint8Array[] = [];
  for (const tracking of numbers) {
    const url = new URL(`${MNP_LABEL_BASE.replace(/\/$/, "")}/GetAddressLabel_HTML_image.aspx`);
    url.searchParams.set("con", tracking);
    url.searchParams.set("userid", cfg.username);
    url.searchParams.set("password", cfg.password);
    url.searchParams.set("labeltype", String(cfg.labelType || 3));

    const res = await fetch(url.toString(), { method: "GET" });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!res.ok) throw new Error(`M&P label failed for ${tracking}: ${res.status}`);

    if (looksLikePdf(bytes)) {
      pdfLabels.push(bytes);
      continue;
    }

    const html = new TextDecoder().decode(bytes);
    if (/not\s+found|invalid|error/i.test(html) && !/<table|<img|barcode|consignee/i.test(html)) {
      throw new Error(`M&P label failed for ${tracking}: ${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}`);
    }
    labels.push(html);
  }

  if (pdfLabels.length > 0) {
    if (labels.length > 0) throw new Error("M&P returned mixed PDF and HTML labels");
    const pdf = await mergePdfs(pdfLabels);
    return {
      success: true,
      label_format: "pdf",
      pdf_base64: base64EncodeBytes(pdf),
      tracking_numbers: numbers,
    };
  }

  const printableHtml = buildPrintableLabelHtml(labels);
  return {
    success: true,
    label_format: "html",
    html_base64: base64Encode(printableHtml),
    tracking_numbers: numbers,
  };
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
    let from = 0;
    const batchSize = 1000;
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

  const cfg = await getMnpConfig(supabase);
  const data = await mnpGet("Branches/Get_Cities_All", {
    username: cfg.username,
    password: cfg.password,
    AccountNo: cfg.accountNo,
  });
  const cityList = Array.isArray(data?.City)
    ? data.City
    : Array.isArray(data?.[0]?.City)
      ? data[0].City
      : [];
  const rows = cityList.map((city: string) => ({
    carrier_id: carrier.id,
    carrier_city_id: city,
    city_name: city,
    province_name: null,
    country_name: "Pakistan",
    is_pickup_city: null,
    is_delivery_city: true,
    cached_at: new Date().toISOString(),
  })).filter((row: any) => row.city_name);

  await supabase.from("carrier_city_cache").delete().eq("carrier_id", carrier.id);
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("carrier_city_cache").insert(rows.slice(i, i + 200));
    if (error) throw error;
  }
  return rows;
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
    await supabase.from("fulfillment_items").upsert({
      order_uuid: order.id,
      order_id: order.order_id,
      shipment_id: existing.id,
      status: "pending",
    }, { onConflict: "shipment_id" });
    return { skipped: true, reason: "Already synced", shipment: existing };
  }

  const cfg = await getMnpConfig(supabase);
  const cities = await getCities(supabase);
  const rawCity = String(order.customer_city || "").trim().toLowerCase();
  const stripped = rawCity.replace(/\s+/g, "");
  const matchedCity =
    cities.find((c: any) => String(c.city_name || "").trim().toLowerCase() === rawCity) ||
    cities.find((c: any) => String(c.city_name || "").trim().toLowerCase().replace(/\s+/g, "") === stripped);

  if (!matchedCity) {
    const payload = {
      order_uuid: order.id,
      order_id: order.order_id,
      carrier_id: carrier.id,
      sync_status: "failed",
      sync_error: `M&P city not found: "${order.customer_city}"`,
    };
    if (existing) await supabase.from("shipments").update(payload).eq("id", existing.id);
    else await supabase.from("shipments").insert(payload);
    throw new Error(`M&P city not found: "${order.customer_city}"`);
  }

  const orderNote = String(order.note || "").trim();
  const remarks = orderNote ? `${orderNote} | ALLOWED TO OPEN` : "ALLOWED TO OPEN";
  const payload = {
    username: cfg.username,
    password: cfg.password,
    consigneeName: String(order.customer_name || "Customer").substring(0, 50),
    consigneeAddress: String(order.customer_address || order.customer_city || "N/A").substring(0, 255),
    consigneeMobNo: normalizePhone(order.customer_phone),
    consigneeEmail: "",
    destinationCityName: matchedCity.city_name,
    pieces: Number(order.quantity || 1),
    weight: Number(order.weight || cfg.defaultWeight || 1),
    codAmount: Number(order.total_amount || 0),
    custRefNo: String(order.order_id).substring(0, 50),
    productDetails: buildProductDetails(order),
    fragile: cfg.fragile,
    service: cfg.service,
    remarks: remarks.substring(0, 400),
    insuranceValue: cfg.insuranceValue,
    locationID: cfg.locationId,
    AccountNo: cfg.accountNo,
    InsertType: cfg.insertType,
    ReturnLocation: cfg.returnLocation,
    subAccountId: Number(cfg.subAccountId),
  };

  const responseData = await mnpPost("Booking/InsertBookingData", payload);
  const result = Array.isArray(responseData) ? responseData[0] : responseData;
  if (String(result?.isSuccess).toLowerCase() !== "true" || !result?.orderReferenceId) {
    const errorMsg = result?.message || responseData;
    const failed = {
      order_uuid: order.id,
      order_id: order.order_id,
      carrier_id: carrier.id,
      sync_status: "failed",
      sync_error: `M&P error: ${JSON.stringify(errorMsg).substring(0, 500)}`,
      raw_create_response: responseData,
    };
    if (existing) await supabase.from("shipments").update(failed).eq("id", existing.id);
    else await supabase.from("shipments").insert(failed);
    throw new Error(`M&P create booking failed: ${JSON.stringify(errorMsg).substring(0, 200)}`);
  }

  const consignmentNumber = String(result.orderReferenceId);
  const shipmentPayload = {
    order_uuid: order.id,
    order_id: order.order_id,
    carrier_id: carrier.id,
    carrier_order_id: consignmentNumber,
    tracking_number: consignmentNumber,
    carrier_reference: String(order.order_id),
    carrier_status: "Booked",
    normalized_status: "booked",
    sync_status: "synced",
    sync_error: null,
    booked_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    raw_create_response: responseData,
    metadata: { service: cfg.service, location_id: cfg.locationId, sub_account_id: cfg.subAccountId },
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
    fulfillment_status: "pending",
    shipping_company: carrier.name,
    shipping_status: "Booked",
    updated_at: new Date().toISOString(),
  }).eq("id", order.id);

  await supabase.from("fulfillment_items").upsert({
    order_uuid: order.id,
    order_id: order.order_id,
    shipment_id: shipment.id,
    status: "pending",
  }, { onConflict: "shipment_id" });

  return { success: true, shipment, carrier_order_id: consignmentNumber, tracking_number: consignmentNumber, response: responseData };
}

async function syncConfirmedOrder(supabase: ReturnType<typeof createClient>, orderIdOrDbId: string) {
  let { data: order } = await supabase
    .from("orders")
    .select("*, order_items(id, sku, product_name, quantity, unit_price)")
    .eq("id", orderIdOrDbId)
    .maybeSingle();
  if (!order) {
    const result = await supabase
      .from("orders")
      .select("*, order_items(id, sku, product_name, quantity, unit_price)")
      .eq("order_id", orderIdOrDbId)
      .maybeSingle();
    order = result.data;
  }
  if (!order) throw new Error(`Order not found: ${orderIdOrDbId}`);
  if (order.confirmation_status !== "confirmed") return { skipped: true, reason: "Order is not confirmed" };
  if (order.delivery_status !== "booked") return { skipped: true, reason: "Order is not booked for shipping" };
  return createShipment(supabase, order);
}

async function trackByConsignment(supabase: ReturnType<typeof createClient>, consignment: string) {
  const carrier = await getCarrier(supabase);
  const res = await fetch(`${MNP_TRACKING_BASE}/CNTracking?consignment=${encodeURIComponent(consignment)}&id=4`);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  const trackingRoot = Array.isArray(data) ? data[0] : data;
  if (!res.ok) {
    throw new Error(`M&P tracking failed: ${JSON.stringify(data).substring(0, 300)}`);
  }
  if (String(trackingRoot?.isSuccess).toLowerCase() !== "true") {
    const message = trackingRoot?.message || "M&P tracking is not available yet";
    return {
      success: false,
      trackingNumber: consignment,
      status: "Tracking unavailable",
      transactionStatus: "Tracking unavailable",
      message,
      transactionStatusHistory: [],
      raw_tracking_response: data,
    };
  }

  const detail = Array.isArray(trackingRoot?.tracking_Details) ? trackingRoot.tracking_Details[0] : null;
  const events = Array.isArray(detail?.CNTrackingDetail) ? detail.CNTrackingDetail : [];
  const latest = events[events.length - 1] || {};
  const statusText = latest.TrackingStatus || detail?.DeliveryStatus || "Booked";
  const normalized = normalizeStatus(statusText);
  const { data: shipment, error } = await supabase
    .from("shipments")
    .select("*, orders(delivery_status, shipped_at, delivered_at)")
    .eq("carrier_id", carrier.id)
    .or(`tracking_number.eq.${consignment},carrier_order_id.eq.${consignment}`)
    .maybeSingle();
  if (error) throw error;

  if (shipment) {
    const now = new Date().toISOString();
    await supabase.from("shipments").update({
      carrier_status: statusText,
      normalized_status: normalized,
      sync_status: "synced",
      sync_error: null,
      last_synced_at: now,
      raw_tracking_response: data,
    }).eq("id", shipment.id);

    for (const event of events) {
      await supabase.from("shipment_events").insert({
        shipment_id: shipment.id,
        carrier_status: event.TrackingStatus || statusText,
        normalized_status: normalizeStatus(event.TrackingStatus || statusText),
        location: event.Location || null,
        raw_event: event,
        occurred_at: event.TransactionTime ? new Date(event.TransactionTime).toISOString() : now,
      });
    }

    const nextDeliveryStatus = mapDeliveryStatus(normalized, shipment.orders?.delivery_status);
    const orderUpdate: Record<string, unknown> = {
      delivery_status: nextDeliveryStatus,
      shipping_status: statusText,
      updated_at: now,
    };
    if (nextDeliveryStatus === "delivered") orderUpdate.delivered_at = now;
    if (shipment.orders?.delivery_status === "delivered" && !["delivered", "paid"].includes(nextDeliveryStatus)) {
      orderUpdate.delivered_at = null;
    }
    if (shouldSetShippedAt(nextDeliveryStatus)) orderUpdate.shipped_at = shipment.orders?.shipped_at || now;
    await supabase.from("orders").update(orderUpdate).eq("id", shipment.order_uuid);
  }

  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { action, order_id, carrier_order_id, tracking_number } = body;
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
        result = await trackByConsignment(supabase, String(tracking));
        break;
      }
      case "generate-labels":
      case "generate-airway-bill": {
        const numbers = body.tracking_numbers || body.tracking_number || body.carrier_order_id || body.order_id;
        result = await generateLabels(supabase, Array.isArray(numbers) ? numbers : [numbers]);
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("mnp-shipping-sync error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
