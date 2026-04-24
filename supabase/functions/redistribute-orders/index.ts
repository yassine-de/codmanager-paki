import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const INACTIVE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes without heartbeat = inactive
    const inactiveCutoff = new Date(Date.now() - INACTIVE_THRESHOLD_MS).toISOString();

    // 0. Release expired order locks (2 min timeout on new orders)
    await supabase.rpc("release_expired_order_locks");

    // 1. Find inactive agents (no heartbeat in last 10 min)
    const { data: inactivePresence } = await supabase
      .from("user_presence")
      .select("user_id")
      .or(`is_active.eq.false,last_seen.lt.${inactiveCutoff}`);

    const inactiveAgentIds = (inactivePresence || []).map((p: any) => p.user_id);

    if (inactiveAgentIds.length === 0) {
      return new Response(JSON.stringify({ message: "No inactive agents", redistributed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Find pending orders assigned to inactive agents (no_answer, postponed, new)
    const { data: stuckOrders, error: fetchErr } = await supabase
      .from("orders")
      .select("id, agent_id, confirmation_status")
      .in("agent_id", inactiveAgentIds)
      .in("confirmation_status", ["new", "no_answer", "postponed"]);

    if (fetchErr) throw fetchErr;

    if (!stuckOrders || stuckOrders.length === 0) {
      return new Response(JSON.stringify({ message: "No stuck orders", redistributed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Release orders back to global queue by setting agent_id to NULL
    // For postponed orders, keep original_agent_id for context
    const orderIds = stuckOrders.map((o: any) => o.id);

    // Before nullifying agent_id, preserve original_agent_id for ALL treated orders
    // (no_answer, postponed — any status where the agent actually worked on it)
    for (const agentId of inactiveAgentIds) {
      const agentOrders = stuckOrders
        .filter((o: any) => o.agent_id === agentId && o.confirmation_status !== "new")
        .map((o: any) => o.id);
      if (agentOrders.length > 0) {
        await supabase
          .from("orders")
          .update({ original_agent_id: agentId })
          .in("id", agentOrders)
          .is("original_agent_id", null);
      }
    }

    // Now release orders back to global queue
    const { error: updateErr } = await supabase
      .from("orders")
      .update({ agent_id: null })
      .in("id", orderIds);

    if (updateErr) throw updateErr;

    console.log(`Redistributed ${orderIds.length} orders from ${inactiveAgentIds.length} inactive agents`);

    return new Response(JSON.stringify({
      message: "Orders redistributed",
      redistributed: orderIds.length,
      inactiveAgents: inactiveAgentIds.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
