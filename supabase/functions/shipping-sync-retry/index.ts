// @ts-nocheck
// Cron fallback: retries confirmed + booked orders without a synced carrier shipment.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_CARRIER_CODE = Deno.env.get("DEFAULT_CARRIER_CODE") || "postex";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: enabled } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "carrier_sync_enabled")
      .maybeSingle();
    if (enabled?.value === "false") {
      return new Response(JSON.stringify({ skipped: true, reason: "Carrier sync disabled" }), {
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

    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, order_id, shipments(id, sync_status, carrier_id)")
      .eq("confirmation_status", "confirmed")
      .eq("delivery_status", "booked")
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(200);
    if (error) throw error;

    const candidates = (orders || []).filter((order: any) => {
      const shipments = order.shipments || [];
      return shipments.length === 0 || shipments.some((s: any) => s.carrier_id === carrier.id && ["pending", "failed"].includes(s.sync_status));
    }).slice(0, 50);

    if (candidates.length === 0) {
      return new Response(JSON.stringify({ retried: 0, message: "No stuck orders" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/shipping-sync`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const results: any[] = [];

    for (const order of candidates) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "sync-order", order_id: order.order_id }),
        });
        const data = await res.json();
        results.push({ order_id: order.order_id, ok: res.ok, ...data });
      } catch (e) {
        results.push({ order_id: order.order_id, error: (e as Error).message });
      }
    }

    await supabase.from("app_settings").upsert(
      { key: "carrier_last_retry_run", value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

    return new Response(JSON.stringify({
      retried: candidates.length,
      succeeded: results.filter((r) => r.ok && !r.error && !r.skipped).length,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("shipping-sync-retry error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
