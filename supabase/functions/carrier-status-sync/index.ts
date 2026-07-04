// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_CARRIER_API_BASE = "https://apis.orio.digital/api";
const DEFAULT_CARRIER_CODE = Deno.env.get("DEFAULT_CARRIER_CODE") || "orio";

function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
  };
}

function normalizeStatus(status?: string | null) {
  const value = (status || "").toLowerCase().trim();
  if (!value) return "booked";
  if (value === "delivered") return "delivered";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  if (value === "ready for return") return "ready_for_return";
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
    if (!carrier) throw new Error("Default carrier is not configured");

    const staleBefore = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    const terminal = ["delivered", "returned", "return_received", "cancelled"];

    const { data: shipments, error } = await supabase
      .from("shipments")
      .select("*, orders(id, order_id, delivery_status)")
      .eq("carrier_id", carrier.id)
      .not("carrier_order_id", "is", null)
      .not("normalized_status", "in", `(${terminal.join(",")})`)
      .or(`last_synced_at.is.null,last_synced_at.lt.${staleBefore}`)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(500);
    if (error) throw error;

    const results: any[] = [];
    const batchSize = 15;

    async function processShipment(shipment: any) {
      try {
        const res = await fetch(`${DEFAULT_CARRIER_API_BASE}/track`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ order_id: shipment.carrier_order_id, acno: cfg.acno }),
        });
        const data = await res.json();
        const payload = Array.isArray(data) && data[0]?.payload ? data[0].payload : data?.payload || data;
        if (!payload?.status) {
          return { shipment_id: shipment.id, order_id: shipment.order_id, skipped: true, reason: "No status in tracking response" };
        }

        const normalized = normalizeStatus(payload.status);
        const deliveryStatus = mapDeliveryStatus(normalized);
        const now = new Date().toISOString();

        const { error: shipmentErr } = await supabase.from("shipments").update({
          tracking_number: payload.consigment_no || shipment.tracking_number,
          carrier_status: payload.status,
          normalized_status: normalized,
          sync_status: "synced",
          sync_error: null,
          last_synced_at: now,
          raw_tracking_response: data,
        }).eq("id", shipment.id);
        if (shipmentErr) throw shipmentErr;

        await supabase.from("shipment_events").insert({
          shipment_id: shipment.id,
          carrier_status: payload.status,
          normalized_status: normalized,
          raw_event: payload,
          occurred_at: now,
        });

        if (deliveryStatus !== shipment.orders?.delivery_status) {
          await supabase.from("orders").update({
            delivery_status: deliveryStatus,
            shipping_status: payload.status,
            delivered_at: deliveryStatus === "delivered" ? now : undefined,
            updated_at: now,
          }).eq("id", shipment.order_uuid);

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

        return { shipment_id: shipment.id, order_id: shipment.order_id, carrier_status: payload.status, mapped_status: deliveryStatus, updated: true };
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
