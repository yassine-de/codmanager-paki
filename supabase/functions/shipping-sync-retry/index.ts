// @ts-nocheck
// Cron fallback: retries confirmed + booked orders without a synced carrier shipment.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: settings } = await supabase
      .from("app_settings")
      .select("key,value")
      .in("key", ["carrier_sync_enabled", "active_carrier_code"]);
    const byKey = Object.fromEntries((settings || []).map((s: any) => [s.key, s.value]));
    if (byKey.carrier_sync_enabled === "false") {
      return new Response(JSON.stringify({ skipped: true, reason: "Carrier sync disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const activeCarrierCode = byKey.active_carrier_code || Deno.env.get("ACTIVE_CARRIER_CODE") || Deno.env.get("DEFAULT_CARRIER_CODE") || "postex";

    const { data: carrier, error: carrierError } = await supabase
      .from("carriers")
      .select("id")
      .eq("code", activeCarrierCode)
      .maybeSingle();
    if (carrierError) throw carrierError;
    if (!carrier) throw new Error("Default carrier is not configured");

    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, order_id, confirmed_at, updated_at, shipments(id, sync_status, carrier_id, sync_error, updated_at)")
      .eq("confirmation_status", "confirmed")
      .eq("delivery_status", "booked")
      .order("confirmed_at", { ascending: true, nullsFirst: true })
      .limit(1000);
    if (error) throw error;

    // Each run only gets ~50 calls. Orders that failed on bad data (unknown city, invalid
    // items count...) fail again every time, so they used to fill the whole slice and starve
    // newly confirmed orders: 48 such orders left only ~2 slots per run and 44 orders sat
    // unbooked for hours. Order of priority now:
    //   1. confirmed orders that never got a shipment (oldest first)
    //   2. failed shipments, oldest attempt first, but a data failure is only retried once
    //      the order has been edited since the last attempt (e.g. an agent fixed the city).
    const PERMANENT_ERROR = /city not found|does not cover city|city is empty|items value is invalid|city not allowed/i;
    const now = Date.now();
    const fresh: any[] = [];
    const retryable: { order: any; lastAttempt: number }[] = [];
    let skippedPermanent = 0;

    for (const order of orders || []) {
      const shipments = order.shipments || [];
      if (shipments.length === 0) {
        fresh.push(order);
        continue;
      }
      const stuck = shipments.find((s: any) => s.carrier_id === carrier.id && ["pending", "failed"].includes(s.sync_status));
      if (!stuck) continue;

      const lastAttempt = stuck.updated_at ? new Date(stuck.updated_at).getTime() : 0;
      const editedSince = new Date(order.updated_at).getTime() > lastAttempt;
      const permanent = stuck.sync_status === "failed" && PERMANENT_ERROR.test(stuck.sync_error || "");
      if (permanent && !editedSince) {
        skippedPermanent++;
        continue;
      }
      if (!permanent && now - lastAttempt < 2 * 60_000) continue; // just tried, give it a minute
      retryable.push({ order, lastAttempt });
    }

    retryable.sort((a, b) => a.lastAttempt - b.lastAttempt);
    const candidates = [...fresh, ...retryable.map((r) => r.order)].slice(0, 50);

    console.log(`[shipping-sync-retry] scanned=${(orders || []).length} fresh=${fresh.length} retryable=${retryable.length} skipped_permanent=${skippedPermanent} candidates=${candidates.length}`);

    if (candidates.length === 0) {
      return new Response(JSON.stringify({ retried: 0, skipped_permanent: skippedPermanent, message: "No stuck orders" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/carrier-shipping-sync`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const results: any[] = [];
    // Stay well inside the edge function time limit; whatever is left goes in the next run.
    const deadline = Date.now() + 100_000;
    let deferred = 0;

    const callSync = async (orderId: string) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "sync-order", order_id: orderId }),
      });
      return { res, data: await res.json() };
    };

    for (const order of candidates) {
      if (Date.now() > deadline) {
        deferred++;
        continue;
      }
      try {
        let { res, data } = await callSync(order.order_id);
        // Chained edge calls share a per-trace rate limit; one short retry is enough.
        if (!res.ok && /rate limit/i.test(String(data?.error || ""))) {
          await new Promise((r) => setTimeout(r, 1000));
          ({ res, data } = await callSync(order.order_id));
        }
        results.push({ order_id: order.order_id, ok: res.ok, ...data });
      } catch (e) {
        results.push({ order_id: order.order_id, error: (e as Error).message });
      }
    }

    console.log(`[shipping-sync-retry] done retried=${results.length} deferred=${deferred} succeeded=${results.filter((r) => r.ok && !r.error && !r.skipped).length}`);

    await supabase.from("app_settings").upsert(
      { key: "carrier_last_retry_run", value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

    return new Response(JSON.stringify({
      retried: results.length,
      deferred,
      skipped_permanent: skippedPermanent,
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
