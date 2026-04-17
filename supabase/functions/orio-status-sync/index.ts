import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const ORIO_BASE = "https://apis.orio.digital/api";

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// Status mapping: ORIO status → our delivery_status
const STATUS_MAP: Record<string, string> = {
  // Pre-shipment / pickup stages → keep as "booked"
  "new": "booked",
  "pickup ready": "booked",
  "arrived at courier facility": "booked",
  // In-transit stages → shipped
  "in transit": "shipped",
  "out for delivery": "shipped",
  // Terminal statuses
  "delivered": "delivered",
  "return": "returned",
  "cancelled": "cancelled",
  "failed attempt": "failed",
};

function mapOrioStatus(orioStatus: string): string | null {
  return STATUS_MAP[orioStatus.toLowerCase().trim()] || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = getSupabaseAdmin();

  try {
    // Check if ORIO API is enabled
    const { data: enabledSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "orio_api_enabled")
      .maybeSingle();

    if (!enabledSetting || enabledSetting.value !== "true") {
      console.log("ORIO API is disabled, skipping status sync");
      return new Response(
        JSON.stringify({ skipped: true, reason: "ORIO API disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get ORIO credentials
    const { data: tokenSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "orio_api_token")
      .maybeSingle();

    const { data: acnoSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "orio_account_number")
      .maybeSingle();

    const token = tokenSetting?.value || Deno.env.get("ORIO_API_TOKEN");
    const acno = acnoSetting?.value || "OR-04820";

    if (!token) {
      console.error("No ORIO API token configured");
      return new Response(
        JSON.stringify({ error: "No ORIO API token configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch orders that need status sync — oldest updated first so all orders rotate through
    const { data: orders, error: fetchErr } = await supabase
      .from("orders")
      .select("id, order_id, orio_order_id, delivery_status, orio_shipping_status, updated_at")
      .not("orio_order_id", "is", null)
      .not("delivery_status", "in", '("delivered","returned","cancelled")')
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(50);

    if (fetchErr) {
      console.error("Error fetching orders:", fetchErr);
      throw new Error(fetchErr.message);
    }

    if (!orders || orders.length === 0) {
      console.log("No orders to sync");
      // Update last sync timestamp
      await supabase
        .from("app_settings")
        .upsert({ key: "orio_last_status_sync", value: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
      return new Response(
        JSON.stringify({ synced: 0, message: "No orders to sync" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${orders.length} orders for status sync`);

    const results: any[] = [];

    for (const order of orders) {
      try {
        // Call ORIO track API
        const res = await fetch(`${ORIO_BASE}/track`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            order_id: order.orio_order_id,
            acno: acno,
          }),
        });

        const data = await res.json();

        // Extract payload
        let payload: any = null;
        if (Array.isArray(data) && data.length > 0 && data[0].payload) {
          payload = data[0].payload;
        } else if (data?.payload) {
          payload = data.payload;
        }

        if (!payload || !payload.status) {
          results.push({ order_id: order.order_id, skipped: true, reason: "No status in tracking response" });
          continue;
        }

        const orioStatus = payload.status;
        const mappedStatus = mapOrioStatus(orioStatus);

        // Always store the raw ORIO status
        const updateData: any = {
          orio_shipping_status: orioStatus,
          orio_consignment_no: payload.consigment_no || undefined,
        };

        // Only update delivery_status if mapping exists AND status changed
        if (mappedStatus && mappedStatus !== order.delivery_status) {
          updateData.delivery_status = mappedStatus;

          // Set delivered_at for delivered orders
          if (mappedStatus === "delivered") {
            updateData.delivered_at = new Date().toISOString();
          }

          console.log(`Order ${order.order_id}: ${order.delivery_status} → ${mappedStatus} (ORIO: ${orioStatus})`);
        }

        // Only update if something changed
        if (orioStatus !== order.orio_shipping_status || mappedStatus !== order.delivery_status) {
          const { error: updateErr } = await supabase
            .from("orders")
            .update(updateData)
            .eq("id", order.id);

          if (updateErr) {
            console.error(`Error updating order ${order.order_id}:`, updateErr);
            results.push({ order_id: order.order_id, error: updateErr.message });
            continue;
          }
        }

        results.push({
          order_id: order.order_id,
          orio_status: orioStatus,
          mapped_status: mappedStatus,
          updated: mappedStatus !== order.delivery_status,
        });
      } catch (e) {
        console.error(`Error tracking order ${order.order_id}:`, e);
        results.push({ order_id: order.order_id, error: (e as Error).message });
      }
    }

    // Update last sync timestamp
    await supabase
      .from("app_settings")
      .upsert({ key: "orio_last_status_sync", value: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "key" });

    const updated = results.filter((r) => r.updated).length;
    const errored = results.filter((r) => r.error).length;
    console.log(`Sync complete: ${updated} updated, ${errored} errors, ${results.length} total`);

    return new Response(
      JSON.stringify({ synced: results.length, updated, errors: errored, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("orio-status-sync error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
