// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const POSTEX_API_BASE = Deno.env.get("POSTEX_API_BASE") || "https://api.postex.pk/services/integration/api/order";
const DEFAULT_CARRIER_CODE = Deno.env.get("DEFAULT_CARRIER_CODE") || "postex";

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function getCarrierConfig(supabase: ReturnType<typeof createClient>) {
  const { data: settings } = await supabase
    .from("app_settings")
    .select("key,value")
    .in("key", ["carrier_api_token", "carrier_sync_enabled", "postex_api_token"]);
  const byKey = Object.fromEntries((settings || []).map((s: any) => [s.key, s.value]));
  const token = byKey.postex_api_token || byKey.carrier_api_token || Deno.env.get("POSTEX_API_TOKEN") || Deno.env.get("CARRIER_API_TOKEN");
  if (!token) throw new Error("PostEx API token is not configured");
  return {
    token,
    enabled: byKey.carrier_sync_enabled !== "false",
  };
}

function postexHeaders(token: string) {
  return {
    token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
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

function normalizeStatus(status?: string | null, code?: string | null) {
  const value = (status || "").toLowerCase().trim();
  const messageCode = String(code || "").trim();
  if (messageCode === "0005" || value === "delivered") return "delivered";
  if (["0002", "0006", "0007"].includes(messageCode) || value === "returned") return "returned";
  if (messageCode === "0013" || value === "attempted") return "failed_attempt";
  if (value === "out for return") return "ready_for_return";
  if (value === "out for delivery") return "out_for_delivery";
  if (["0003", "0004", "0015", "0018", "15", "18"].includes(messageCode)) return "in_transit";
  if (messageCode === "0001") return "booked";
  if (
    ["postex warehouse", "picked by postex", "en-route to postex warehouse", "package on root", "package on route"].includes(value) ||
    value.includes("departed to postex")
  ) return "in_transit";
  if (["unbooked", "un-booked", "booked", "at merchant's warehouse", "at merchant warehouse", "un-assigned by me"].includes(value)) return "booked";
  if (value === "delivery under review") return "failed_attempt";
  if (value === "expired") return "cancelled";
  return value ? "carrier_unknown" : "booked";
}

function mapDeliveryStatus(normalizedStatus: string, currentStatus?: string | null) {
  if (normalizedStatus === "delivered") return "delivered";
  if (normalizedStatus === "cancelled") return "cancelled";
  if (normalizedStatus === "ready_for_return") return "ready_for_return";
  if (normalizedStatus === "returned" || normalizedStatus === "return_received") return "return";
  if (normalizedStatus === "failed_attempt") return "failed_attempt";
  if (normalizedStatus === "out_for_delivery") return "with_courier";
  if (normalizedStatus === "in_transit") return "shipped";
  if (normalizedStatus === "booked" || normalizedStatus === "carrier_unknown") {
    const lockedWarehouseStatuses = ["printed", "dispatched", "shipped", "in_transit", "with_courier", "out_for_delivery", "delivered", "failed_attempt", "ready_for_return", "return", "returned", "cancelled"];
    return currentStatus && lockedWarehouseStatuses.includes(currentStatus) ? currentStatus : "booked";
  }
  return currentStatus || "booked";
}

function shouldSetShippedAt(deliveryStatus: string) {
  return ["shipped", "in_transit", "with_courier", "delivered", "failed_attempt", "ready_for_return", "return"].includes(deliveryStatus);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = getSupabaseAdmin();

  try {
    const cfg = await getCarrierConfig(supabase);
    if (!cfg.enabled) {
      return new Response(JSON.stringify({ skipped: true, reason: "Carrier API disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: carrier, error: carrierError } = await supabase
      .from("carriers")
      .select("id")
      .eq("code", DEFAULT_CARRIER_CODE)
      .maybeSingle();
    if (carrierError) throw carrierError;
    if (!carrier) throw new Error(`Default carrier is not configured: ${DEFAULT_CARRIER_CODE}`);

    const staleBefore = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    const terminal = ["delivered", "returned", "return_received", "cancelled"];

    const { data: shipments, error } = await supabase
      .from("shipments")
      .select("*, orders(id, order_id, delivery_status, shipped_at)")
      .eq("carrier_id", carrier.id)
      .not("tracking_number", "is", null)
      .not("normalized_status", "in", `(${terminal.join(",")})`)
      .or(`last_synced_at.is.null,last_synced_at.lt.${staleBefore}`)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(500);
    if (error) throw error;

    const results: any[] = [];
    const batchSize = 15;

    async function processShipment(shipment: any) {
      try {
        const tracking = shipment.tracking_number || shipment.carrier_order_id;
        const res = await fetch(`${POSTEX_API_BASE}/v1/track-order/${encodeURIComponent(tracking)}`, {
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
        const deliveryStatus = mapDeliveryStatus(normalized, shipment.orders?.delivery_status);
        const now = new Date().toISOString();

        const { error: shipmentErr } = await supabase.from("shipments").update({
          tracking_number: payload.trackingNumber || shipment.tracking_number,
          carrier_status: status.status,
          normalized_status: normalized,
          sync_status: "synced",
          sync_error: null,
          last_synced_at: now,
          raw_tracking_response: data,
        }).eq("id", shipment.id);
        if (shipmentErr) throw shipmentErr;

        await supabase.from("shipment_events").insert({
          shipment_id: shipment.id,
          carrier_status: status.status,
          normalized_status: normalized,
          raw_event: payload,
          occurred_at: now,
        });

        if (deliveryStatus !== shipment.orders?.delivery_status) {
          const orderUpdate: Record<string, unknown> = {
            delivery_status: deliveryStatus,
            shipping_status: status.status,
            updated_at: now,
          };
          if (deliveryStatus === "delivered") orderUpdate.delivered_at = now;
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

        return { shipment_id: shipment.id, order_id: shipment.order_id, carrier_status: status.status, mapped_status: deliveryStatus, updated: true };
      } catch (e) {
        await supabase.from("shipments").update({
          sync_status: "failed",
          sync_error: (e as Error).message,
          last_synced_at: new Date().toISOString(),
        }).eq("id", shipment.id);
        return { shipment_id: shipment.id, order_id: shipment.order_id, error: (e as Error).message };
      }
    }

    for (let i = 0; i < (shipments || []).length; i += batchSize) {
      results.push(...await Promise.all(shipments.slice(i, i + batchSize).map(processShipment)));
    }

    await supabase.from("app_settings").upsert(
      { key: "carrier_last_status_sync", value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

    return new Response(JSON.stringify({
      synced: results.length,
      updated: results.filter((r) => r.updated).length,
      errors: results.filter((r) => r.error).length,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("carrier-status-sync error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
