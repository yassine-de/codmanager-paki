// @ts-nocheck
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: userData.user.id });
    if (!isAdmin) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageId = new URL(req.url).searchParams.get("messageId")?.trim();
    if (!messageId) {
      return new Response(JSON.stringify({ ok: false, error: "messageId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: message } = await admin
      .from("whatsapp_messages")
      .select("id, message_type, payload")
      .eq("id", messageId)
      .maybeSingle();

    if (!message || message.message_type !== "audio") {
      return new Response(JSON.stringify({ ok: false, error: "Audio message not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const audio = message.payload?.audio;
    const mediaId = audio?.id;
    const directUrl = audio?.link || audio?.url;
    const mimeType = audio?.mime_type || "audio/ogg";

    if (!mediaId && !directUrl) {
      return new Response(JSON.stringify({ ok: false, error: "Audio source missing" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await admin
      .from("whatsapp_settings")
      .select("api_base_url, access_token")
      .eq("singleton", true)
      .maybeSingle();

    const accessToken = settings?.access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
    if (!accessToken) {
      return new Response(JSON.stringify({ ok: false, error: "WhatsApp access token missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let downloadUrl = directUrl;
    if (mediaId) {
      const metaUrl = `${(settings?.api_base_url || "https://graph.facebook.com/v21.0").replace(/\/$/, "")}/${mediaId}`;
      const metaResp = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const metaJson = await metaResp.json();
      if (!metaResp.ok || !metaJson?.url) {
        return new Response(JSON.stringify({ ok: false, error: "Failed to resolve media URL", details: metaJson }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      downloadUrl = metaJson.url;
    }

    const mediaResp = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mediaResp.ok) {
      const details = await mediaResp.text();
      return new Response(JSON.stringify({ ok: false, error: "Failed to download audio", details }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const buffer = await mediaResp.arrayBuffer();
    return new Response(buffer, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=300",
        "x-media-type": mimeType,
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error?.message || "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});