import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Update: set agent_id to null, preserve original_agent_id for postponed
    const { error: updateErr } = await supabase
      .from("orders")
      .update({ agent_id: null })
      .in("id", orderIds);

    if (updateErr) throw updateErr;

    // For postponed orders, set original_agent_id if not already set
    const postponedIds = stuckOrders
      .filter((o: any) => o.confirmation_status === "postponed")
      .map((o: any) => o.id);

    if (postponedIds.length > 0) {
      // We need to set original_agent_id for each — batch update per agent
      for (const agentId of inactiveAgentIds) {
        const agentPostponed = stuckOrders
          .filter((o: any) => o.confirmation_status === "postponed" && o.agent_id === agentId)
          .map((o: any) => o.id);
        if (agentPostponed.length > 0) {
          await supabase
            .from("orders")
            .update({ original_agent_id: agentId })
            .in("id", agentPostponed)
            .is("original_agent_id", null);
        }
      }
    }

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
