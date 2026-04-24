// Test connection / send a free-form text test message via Meta Cloud API.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();

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
    const { data: claimsData } = await supabase.auth.getClaims(token);
    if (!claimsData?.claims) throw new Error("Unauthorized");
    const userId = claimsData.claims.sub;
    const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: userId });
    if (!isAdmin) throw new Error("Forbidden");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: s } = await admin.from("whatsapp_settings").select("*").eq("singleton", true).maybeSingle();
    if (!s) throw new Error("Settings missing");

    const accessToken = (s as any).access_token || Deno.env.get("WHATSAPP_META_ACCESS_TOKEN");
    const { mode, phone } = await req.json();

    if (mode === "connection") {
      const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

      // Step 1: Configuration
      const hasPhoneId = !!s.phone_number_id?.trim();
      const hasToken = !!accessToken;
      const hasApiBase = !!s.api_base_url?.trim();
      const configOk = hasPhoneId && hasToken && hasApiBase;
      checks.push({
        name: "Configuration",
        ok: configOk,
        detail: configOk
          ? "Phone Number ID, Access Token & API base set"
          : `Missing: ${[!hasPhoneId && "Phone Number ID", !hasToken && "Access Token", !hasApiBase && "API base"].filter(Boolean).join(", ")}`,
      });

      if (!configOk) {
        return new Response(JSON.stringify({ ok: false, checks, duration_ms: Date.now() - startedAt }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Step 2 & 3: Call Meta — validates token + phone number id together
      const r = await fetch(`${s.api_base_url}/${s.phone_number_id}?fields=display_phone_number,verified_name,id`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const j = await r.json();

      if (!r.ok) {
        const errMsg = j?.error?.message || "Request failed";
        const isAuth = j?.error?.type === "OAuthException" || /token/i.test(errMsg);
        checks.push({
          name: "Token Validation",
          ok: !isAuth,
          detail: isAuth ? errMsg : "Token accepted",
        });
        checks.push({
          name: "Phone Number Verification",
          ok: false,
          detail: isAuth ? "Skipped" : errMsg,
        });
        return new Response(JSON.stringify({ ok: false, checks, response: j, duration_ms: Date.now() - startedAt }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      checks.push({ name: "Token Validation", ok: true, detail: "Access token is valid" });
      checks.push({
        name: "Phone Number Verification",
        ok: true,
        detail: j?.display_phone_number ? `📞 ${j.display_phone_number}` : `ID ${j?.id ?? s.phone_number_id}`,
      });

      return new Response(JSON.stringify({ ok: true, checks, response: j, duration_ms: Date.now() - startedAt }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "webhook") {
      const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
      const projectRef = Deno.env.get("SUPABASE_URL")?.replace("https://", "").split(".")[0];
      const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/whatsapp-webhook`;

      // 1. Verify token configured
      const hasSecret = !!s.webhook_secret?.trim();
      checks.push({
        name: "Verify Token",
        ok: hasSecret,
        detail: hasSecret ? "Verify token is set" : "Missing — enter a verify token and Save",
      });
      if (!hasSecret) {
        return new Response(JSON.stringify({ ok: false, checks, duration_ms: Date.now() - startedAt }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2. Webhook reachability — Meta-style GET handshake
      const challenge = `lov_${Date.now()}`;
      const url = `${webhookUrl}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(s.webhook_secret)}&hub.challenge=${challenge}`;
      try {
        const r = await fetch(url);
        const text = await r.text();
        const reachable = r.status === 200 || r.status === 401 || r.status === 403;
        checks.push({
          name: "Webhook Reachability",
          ok: reachable,
          detail: reachable ? `Endpoint responded (${r.status})` : `Unreachable (status ${r.status})`,
        });

        // 3. Verify token handshake
        const handshakeOk = r.status === 200 && text.trim() === challenge;
        checks.push({
          name: "Verify Token Handshake",
          ok: handshakeOk,
          detail: handshakeOk
            ? "Meta-style verification succeeded"
            : r.status === 200
            ? `Unexpected response body: ${text.slice(0, 80)}`
            : `Token rejected (status ${r.status})`,
        });

        const allOk = checks.every((c) => c.ok);
        return new Response(JSON.stringify({ ok: allOk, checks, duration_ms: Date.now() - startedAt }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        checks.push({ name: "Webhook Reachability", ok: false, detail: (e as Error).message });
        return new Response(JSON.stringify({ ok: false, checks, duration_ms: Date.now() - startedAt }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (mode === "message") {
      if (!accessToken) throw new Error("Access token missing. Add it in WhatsApp Settings.");
      if (!phone) throw new Error("phone required");
      const to = String(phone).replace(/[^\d]/g, "");
      const r = await fetch(`${s.api_base_url}/${s.phone_number_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: "Test message from CRM ✅" },
        }),
      });
      const j = await r.json();
      return new Response(JSON.stringify({ ok: r.ok, response: j }), {
        status: r.ok ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Invalid mode");
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
