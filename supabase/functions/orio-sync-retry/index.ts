// Cron-Fallback: retries orders stuck in pending/failed sync
// Runs every 10 min. Calls orio-sync (sync-order action) for each candidate.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Check ORIO enabled
    const { data: enabled } = await supabase
      .from("app_settings").select("value").eq("key", "orio_api_enabled").maybeSingle();
    if (!enabled || enabled.value !== "true") {
      return new Response(JSON.stringify({ skipped: true, reason: "ORIO disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find stuck orders: confirmed + booked + no orio_order_id + sync pending/failed
    const { data: stuck } = await supabase
      .from("orders")
      .select("id, order_id, orio_sync_status")
      .eq("confirmation_status", "confirmed")
      .eq("delivery_status", "booked")
      .is("orio_order_id", null)
      .or("orio_sync_status.is.null,orio_sync_status.eq.pending,orio_sync_status.eq.failed")
      .limit(50);

    if (!stuck || stuck.length === 0) {
      return new Response(JSON.stringify({ retried: 0, message: "No stuck orders" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Retrying ${stuck.length} stuck orders`);

    const results: any[] = [];
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/orio-sync`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    for (const o of stuck) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "sync-order", order_id: o.order_id }),
        });
        const data = await res.json();
        results.push({ order_id: o.order_id, ok: res.ok, ...data });
      } catch (e) {
        results.push({ order_id: o.order_id, error: (e as Error).message });
      }
    }

    await supabase.from("app_settings").upsert(
      { key: "orio_last_retry_run", value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

    const ok = results.filter((r) => r.ok && !r.error && !r.skipped).length;
    return new Response(JSON.stringify({ retried: stuck.length, succeeded: ok, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("orio-sync-retry error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
