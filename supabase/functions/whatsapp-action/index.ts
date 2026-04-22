// Manual Inbox actions: confirm / to_agent / cancel / resend.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;
    const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: userId });
    if (!isAdmin) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { conversation_id, order_id, action } = await req.json();
    if (!order_id || !action) throw new Error("order_id and action required");

    const { data: order } = await admin.from("orders").select("*").eq("order_id", order_id).maybeSingle();
    if (!order) throw new Error("Order not found");

    const { data: settings } = await admin.from("whatsapp_settings").select("*").eq("singleton", true).maybeSingle();

    let convStatus: string | null = null;
    let updates: Record<string, any> = {};

    if (action === "confirm") {
      updates = {
        confirmation_status: "confirmed",
        confirmation_channel: "whatsapp",
        confirmed_at: new Date().toISOString(),
        whatsapp_status: "confirmed",
      };
      if (settings?.auto_book_shipping) {
        updates.delivery_status = "booked";
        updates.shipping_status = "Booked";
      }
      convStatus = "confirmed";
    } else if (action === "to_agent") {
      updates = {
        confirmation_status: "new",
        confirmation_channel: "agent",
        agent_id: null,
        whatsapp_status: "more_info",
      };
      convStatus = "more_info";
    } else if (action === "cancel") {
      updates = {
        confirmation_status: "new",
        confirmation_channel: "agent",
        agent_id: null,
        whatsapp_status: "canceled",
        whatsapp_note: "Canceled via WhatsApp Inbox",
        note: `${order.note ? order.note + "\n" : ""}Canceled in WhatsApp`,
      };
      convStatus = "canceled";
    } else if (action === "resend") {
      // Re-trigger send via the send function path
      const sendResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ order_id }),
      });
      const sendJson = await sendResp.json();
      return new Response(JSON.stringify(sendJson), {
        status: sendResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      throw new Error("Invalid action");
    }

    await admin.from("orders").update(updates).eq("order_id", order_id);
    if (conversation_id && convStatus) {
      await admin.from("whatsapp_conversations").update({ status: convStatus }).eq("id", conversation_id);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
