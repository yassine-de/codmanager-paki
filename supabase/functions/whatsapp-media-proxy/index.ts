// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const unavailableAudioResponse = (error = "Audio unavailable", details: unknown = null) =>
  new Response(JSON.stringify({ ok: false, expired: true, error, details }), {
    status: 200,
    headers: jsonHeaders,
  });

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

    if (!message) {
      return unavailableAudioResponse("Message not found");
    }

    // Resolve media payload by message type (audio | image | video | document | sticker)
    const mt = message.message_type;
    const payloadMedia =
      message.payload?.[mt] ||
      message.payload?.audio ||
      message.payload?.image ||
      message.payload?.video ||
      message.payload?.document ||
      message.payload?.sticker ||
      null;

    if (!payloadMedia) {
      return unavailableAudioResponse("Media source missing");
    }

    const mediaId = payloadMedia.id;
    const directUrl = payloadMedia.link || payloadMedia.url;
    const defaultMime =
      mt === "image" ? "image/jpeg" :
      mt === "video" ? "video/mp4" :
      mt === "document" ? "application/octet-stream" :
      mt === "sticker" ? "image/webp" :
      "audio/ogg";
    const mimeType = payloadMedia.mime_type || defaultMime;

    if (!mediaId && !directUrl) {
      return unavailableAudioResponse("Media source missing");
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
      const metaJson = await metaResp.json().catch(() => ({}));
      if (!metaResp.ok || !metaJson?.url) {
        // Meta retains media ~30 days. Return 200 with expired flag so the platform
        // doesn't surface a runtime error overlay; the client checks `expired` to show fallback UI.
        const errCode = metaJson?.error?.code;
        const errSubcode = metaJson?.error?.error_subcode;
        const isExpired = errCode === 100 || errSubcode === 33 || metaResp.status === 404;
        return new Response(
          JSON.stringify({
            ok: false,
            expired: isExpired,
            error: isExpired ? "Audio no longer available (expired on WhatsApp servers)" : "Failed to resolve media URL",
            details: metaJson,
          }),
          {
            status: 200,
            headers: jsonHeaders,
          },
        );
      }
      downloadUrl = metaJson.url;
    }

    const mediaResp = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mediaResp.ok) {
      const details = await mediaResp.text();
      const isExpired = mediaResp.status === 404 || mediaResp.status === 410;
      return new Response(
        JSON.stringify({
          ok: false,
          expired: isExpired,
          error: isExpired ? "Audio no longer available" : "Failed to download audio",
          details,
        }),
        {
          status: 200,
          headers: jsonHeaders,
        },
      );
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
      status: 200,
      headers: jsonHeaders,
    });
  }
});