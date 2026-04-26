// @ts-nocheck
// Manual Inbox actions: confirm / to_agent / cancel / resend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

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
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
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
      // IMPORTANT: WhatsApp can only confirm orders, never cancel them.
      // We only flag the conversation so a human agent can decide.
      // Do NOT change confirmation_status, agent_id, or confirmation_channel.
      updates = {
        whatsapp_status: "canceled",
        whatsapp_note: "Customer requested cancellation via WhatsApp Inbox",
      };
      convStatus = "canceled";
    } else if (action === "resend") {
      const templateLookup = conversation_id
        ? await admin
            .from("whatsapp_messages")
            .select("payload")
            .eq("conversation_id", conversation_id)
            .eq("direction", "out")
            .eq("message_type", "template")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : await admin
            .from("whatsapp_messages")
            .select("payload")
            .eq("order_id", order_id)
            .eq("direction", "out")
            .eq("message_type", "template")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

      let templateId = templateLookup.data?.payload?._template_id ?? null;
      if (!templateId) {
        const templateName = templateLookup.data?.payload?.template?.name ?? templateLookup.data?.payload?._template_name ?? null;
        if (templateName) {
          const { data: byMeta } = await admin
            .from("whatsapp_templates")
            .select("id")
            .eq("meta_template_name", templateName)
            .limit(1)
            .maybeSingle();
          if (byMeta?.id) {
            templateId = byMeta.id;
          } else {
            const { data: byName } = await admin
              .from("whatsapp_templates")
              .select("id")
              .eq("name", templateName)
              .limit(1)
              .maybeSingle();
            templateId = byName?.id ?? null;
          }
        }
      }

      // Re-trigger send via the send function path.
      // If this conversation previously used a template, resend the same template
      // so Meta-approved buttons remain attached.
      const sendResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          templateId
            ? { mode: "template", template_id: templateId, conversation_id: conversation_id ?? undefined, order_id }
            : { order_id, conversation_id: conversation_id ?? undefined },
        ),
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
