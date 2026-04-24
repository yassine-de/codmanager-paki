import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ORIO_BASE = "https://apis.orio.digital/api";

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// Status mapping: ORIO sub-status → our DELIVERY status
// Source: user-provided ORIO status table (17 statuses)
const STATUS_MAP: Record<string, string> = {
  // Direct mappings
  "new": "booked",
  "shipped": "shipped",
  "cancelled": "cancelled",
  "delivered": "delivered",
  // All in-flight courier states → shipped
  "address closed": "shipped",
  "arrived at courier facility": "shipped",
  "booked": "shipped",
  "customer not available": "shipped",
  "hold on customer's request": "shipped",
  "hold on customers request": "shipped", // tolerate missing apostrophe
  "in transit": "shipped",
  "out for delivery": "shipped",
  "pickup ready": "shipped",
  // Failed attempt group → failed_attempt (driver tried but couldn't deliver)
  "failed attempt": "failed_attempt",
  "incomplete address": "failed_attempt",
  "refused to accept": "failed_attempt",
  "customer not answering": "failed_attempt",
  // Terminal / outcome statuses
  "ready for return": "ready_for_return",
  "return to shipper": "return",
  "return": "return",
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
      .not("delivery_status", "in", '("delivered","returned","cancelled","return","rejected")')
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(300);

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

    console.log(`Processing ${orders.length} orders for status sync (parallel batches of 15)`);

    const results: any[] = [];
    const BATCH_SIZE = 15;

    // Statuses considered "post-shipped" — must have a shipped history event
    const POST_SHIPPED = new Set(["shipped", "delivered", "rejected", "returned", "failed_attempt", "ready_for_return", "return"]);

    // Process a single order: track + update
    const processOrder = async (order: any) => {
      try {
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

        let payload: any = null;
        if (Array.isArray(data) && data.length > 0 && data[0].payload) {
          payload = data[0].payload;
        } else if (data?.payload) {
          payload = data.payload;
        }

        if (!payload || !payload.status) {
          return { order_id: order.order_id, skipped: true, reason: "No status in tracking response" };
        }

        const orioStatus = payload.status;
        const mappedStatus = mapOrioStatus(orioStatus);

        const updateData: any = {
          orio_shipping_status: orioStatus,
          orio_consignment_no: payload.consigment_no || undefined,
        };

        if (mappedStatus && mappedStatus !== order.delivery_status) {
          updateData.delivery_status = mappedStatus;
          if (mappedStatus === "delivered") {
            updateData.delivered_at = new Date().toISOString();
          }
          console.log(`Order ${order.order_id}: ${order.delivery_status} → ${mappedStatus} (ORIO: ${orioStatus})`);
        }

        if (orioStatus !== order.orio_shipping_status || mappedStatus !== order.delivery_status) {
          const { error: updateErr } = await supabase
            .from("orders")
            .update(updateData)
            .eq("id", order.id);

          if (updateErr) {
            console.error(`Error updating order ${order.order_id}:`, updateErr);
            return { order_id: order.order_id, error: updateErr.message };
          }

          // Log status change to order_history (single source of truth for billing)
          if (mappedStatus && mappedStatus !== order.delivery_status) {
            const historyRows: any[] = [];
            const now = new Date();

            // If new status is post-shipped, ensure a "shipped" event exists first
            if (POST_SHIPPED.has(mappedStatus) && mappedStatus !== "shipped") {
              const { data: existingShipped } = await supabase
                .from("order_history")
                .select("id")
                .eq("order_id", order.order_id)
                .eq("field_changed", "delivery_status")
                .eq("new_value", "shipped")
                .limit(1)
                .maybeSingle();

              if (!existingShipped) {
                // Insert synthetic shipped event 1ms before the real change so ordering is preserved
                historyRows.push({
                  order_id: order.order_id,
                  field_changed: "delivery_status",
                  old_value: order.delivery_status || "booked",
                  new_value: "shipped",
                  changed_by: "00000000-0000-0000-0000-000000000000",
                  changed_by_role: "system",
                  action_type: "orio_sync_synthetic",
                  created_at: new Date(now.getTime() - 1).toISOString(),
                });
                console.log(`Order ${order.order_id}: inserting synthetic 'shipped' history event (jumped to ${mappedStatus})`);
              }
            }

            // The actual status change
            historyRows.push({
              order_id: order.order_id,
              field_changed: "delivery_status",
              old_value: order.delivery_status,
              new_value: mappedStatus,
              changed_by: "00000000-0000-0000-0000-000000000000",
              changed_by_role: "system",
              action_type: "orio_sync",
              created_at: now.toISOString(),
            });

            const { error: historyErr } = await supabase.from("order_history").insert(historyRows);
            if (historyErr) {
              console.error(`Error logging history for ${order.order_id}:`, historyErr);
            }
          }
        }

        return {
          order_id: order.order_id,
          orio_status: orioStatus,
          mapped_status: mappedStatus,
          updated: mappedStatus !== order.delivery_status,
        };
      } catch (e) {
        console.error(`Error tracking order ${order.order_id}:`, e);
        return { order_id: order.order_id, error: (e as Error).message };
      }
    };

    // Process orders in parallel batches of BATCH_SIZE
    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
      const batch = orders.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(processOrder));
      results.push(...batchResults);
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
