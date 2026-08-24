// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MNP_TRACKING_BASE = Deno.env.get("MNP_TRACKING_BASE") || "https://tracking.mulphilog.com.pk/api";
const CARRIER_CODE = "mnp";

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getMnpConfig(supabase: ReturnType<typeof createClient>) {
  const { data: settings } = await supabase
    .from("app_settings")
    .select("key,value")
    .in("key", ["carrier_sync_enabled"]);
  const byKey = Object.fromEntries((settings || []).map((s: any) => [s.key, s.value]));
  return {
    enabled: byKey.carrier_sync_enabled !== "false",
  };
}

function normalizeStatus(status?: string | null) {
  const value = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  if (!value || value === "booked") return "booked";
  if (value.includes("return to shipper") || value === "returned" || value.includes("returned")) return "returned";
  if (value.includes("out for delivery")) return "out_for_delivery";
  if (value.includes("attempt") || value.includes("undeliver") || value.includes("consignee not")) return "failed_attempt";
  if (value.includes("reached at destination") || value.includes("reached destination")) return "reached_at_destination";
  if (value.includes("deliver") && !value.includes("undeliver")) return "delivered";
  if (value.includes("handed over") || value.includes("arrived") || value.includes("depart") || value.includes("transit") || value.includes("in-process")) return "in_transit";
  return "carrier_unknown";
}

function mapDeliveryStatus(normalizedStatus: string, currentStatus?: string | null) {
  if (normalizedStatus === "delivered") return "delivered";
  if (normalizedStatus === "returned") return "return";
  if (normalizedStatus === "failed_attempt") return "failed_attempt";
  if (normalizedStatus === "out_for_delivery") return "with_courier";
  if (normalizedStatus === "reached_at_destination") return "shipped";
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

function parseMnpTime(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = getSupabaseAdmin();

  try {
    const cfg = await getMnpConfig(supabase);
    if (!cfg.enabled) {
      return new Response(JSON.stringify({ skipped: true, reason: "Carrier API disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: carrier, error: carrierError } = await supabase
      .from("carriers")
      .select("id")
      .eq("code", CARRIER_CODE)
      .maybeSingle();
    if (carrierError) throw carrierError;
    if (!carrier) throw new Error("M&P carrier is not configured");

    const staleBefore = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    const deliveredWatchAfter = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    const terminal = ["returned", "return_received", "cancelled"];

    const { data: shipments, error } = await supabase
      .from("shipments")
      .select("*, orders(id, order_id, delivery_status, shipped_at)")
      .eq("carrier_id", carrier.id)
      .not("tracking_number", "is", null)
      .not("normalized_status", "in", `(${terminal.join(",")})`)
      .or(`normalized_status.neq.delivered,created_at.gte.${deliveredWatchAfter}`)
      .or(`last_synced_at.is.null,last_synced_at.lt.${staleBefore},carrier_status.ilike.*Reached*Destination*`)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(200);
    if (error) throw error;

    if ((shipments || []).length === 0) {
      return new Response(JSON.stringify({ synced: 0, message: "No M&P shipments to sync" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    async function processShipment(shipment: any) {
      const consignment = String(shipment.tracking_number || shipment.carrier_order_id || "").trim();
      const now = new Date().toISOString();
      try {
        if (!consignment) throw new Error("Missing M&P tracking number");
        const res = await fetch(`${MNP_TRACKING_BASE}/CNTracking?consignment=${encodeURIComponent(consignment)}&id=4`);
        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
        const trackingRoot = Array.isArray(data) ? data[0] : data;
        if (!res.ok || String(trackingRoot?.isSuccess).toLowerCase() !== "true") {
          throw new Error(trackingRoot?.message || `M&P tracking failed: ${JSON.stringify(data).substring(0, 300)}`);
        }

        const detail = Array.isArray(trackingRoot?.tracking_Details) ? trackingRoot.tracking_Details[0] : null;
        const events = Array.isArray(detail?.CNTrackingDetail) ? detail.CNTrackingDetail : [];
        const latest = events[0] || events[events.length - 1] || {};
        const statusText = latest.TrackingStatus || detail?.DeliveryStatus || "Booked";
        const normalized = normalizeStatus(statusText);
        const deliveryStatus = mapDeliveryStatus(normalized, shipment.orders?.delivery_status);

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
            occurred_at: parseMnpTime(event.TransactionTime) || now,
          });
        }

        if (deliveryStatus !== shipment.orders?.delivery_status) {
          const orderUpdate: Record<string, unknown> = {
            delivery_status: deliveryStatus,
            shipping_status: statusText,
            updated_at: now,
          };
          if (deliveryStatus === "delivered") orderUpdate.delivered_at = now;
          if (shipment.orders?.delivery_status === "delivered" && !["delivered", "paid"].includes(deliveryStatus)) {
            orderUpdate.delivered_at = null;
          }
          if (shouldSetShippedAt(deliveryStatus)) orderUpdate.shipped_at = shipment.orders?.shipped_at || now;
          await supabase.from("orders").update(orderUpdate).eq("id", shipment.order_uuid);

          await supabase.from("order_history").insert({
            order_id: shipment.order_id,
            field_changed: "delivery_status",
            old_value: shipment.orders?.delivery_status,
            new_value: deliveryStatus,
            changed_by: "00000000-0000-0000-0000-000000000000",
            changed_by_role: "system",
            action_type: "carrier_status_sync",
            created_at: now,
          });
        }

        return { shipment_id: shipment.id, order_id: shipment.order_id, tracking_number: consignment, carrier_status: statusText, mapped_status: deliveryStatus, updated: true };
      } catch (e) {
        await supabase.from("shipments").update({
          sync_status: "failed",
          sync_error: (e as Error).message,
          last_synced_at: now,
        }).eq("id", shipment.id);
        return { shipment_id: shipment.id, order_id: shipment.order_id, tracking_number: consignment, error: (e as Error).message };
      }
    }

    const batchSize = 10;
    for (let i = 0; i < (shipments || []).length; i += batchSize) {
      results.push(...await Promise.all(shipments.slice(i, i + batchSize).map(processShipment)));
    }

    const now = new Date().toISOString();
    await supabase.from("app_settings").upsert(
      { key: "mnp_last_status_sync", value: now, updated_at: now },
      { onConflict: "key" },
    );

    return new Response(JSON.stringify({
      synced: results.length,
      updated: results.filter((r) => r.updated).length,
      errors: results.filter((r) => r.error).length,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("mnp-carrier-status-sync error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
