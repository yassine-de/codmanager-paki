// Sync WhatsApp message templates with Meta Cloud API.
// Modes:
//   - submit: Create/submit a template to Meta for approval (POST /{waba_id}/message_templates)
//   - refresh: Pull template statuses from Meta and update local rows
//   - delete: Delete a template on Meta (DELETE /{waba_id}/message_templates?name=...)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Convert {{var}} placeholders to Meta-style numbered {{1}} {{2}} ...
function normalizeBody(body: string): { text: string; vars: string[] } {
  const vars: string[] = [];
  const text = body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name) => {
    let idx = vars.indexOf(name);
    if (idx === -1) {
      vars.push(name);
      idx = vars.length - 1;
    }
    return `{{${idx + 1}}}`;
  });
  return { text, vars };
}

function buildExample(vars: string[]) {
  if (!vars.length) return undefined;
  return { body_text: [vars.map((v) => `sample_${v}`)] };
}

function buildComponents(t: any) {
  const components: any[] = [];
  // Header
  if (t.header_type && t.header_type !== "NONE") {
    if (t.header_type === "TEXT" && t.header_text) {
      const { text, vars } = normalizeBody(t.header_text);
      const header: any = { type: "HEADER", format: "TEXT", text };
      if (vars.length) {
        header.example = { header_text: vars.map((v) => `sample_${v}`) };
      }
      components.push(header);
    } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(t.header_type)) {
      const header: any = { type: "HEADER", format: t.header_type };
      if (t.header_media_url) {
        header.example = { header_handle: [t.header_media_url] };
      }
      components.push(header);
    }
  }
  // Body
  const { text: bodyText, vars: bodyVars } = normalizeBody(t.body || "");
  const body: any = { type: "BODY", text: bodyText };
  const ex = buildExample(bodyVars);
  if (ex) body.example = ex;
  components.push(body);
  // Footer
  if (t.footer) components.push({ type: "FOOTER", text: t.footer });
  // Buttons
  if (Array.isArray(t.buttons) && t.buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: t.buttons.map((b: any) => {
        if (b.type === "URL") {
          return { type: "URL", text: b.text, url: b.url };
        }
        if (b.type === "PHONE_NUMBER") {
          return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone_number };
        }
        return { type: "QUICK_REPLY", text: b.text };
      }),
    });
  }
  return components;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const mode = body.mode ?? "refresh";

    const { data: s, error: sErr } = await supabase
      .from("whatsapp_settings")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();
    if (sErr || !s) return json(400, { ok: false, error: "Settings not found" });
    if (!s.access_token) return json(400, { ok: false, error: "Missing access token" });
    if (!s.waba_id) return json(400, { ok: false, error: "Missing WABA ID" });

    const base = (s.api_base_url || "https://graph.facebook.com/v21.0").replace(/\/$/, "");

    if (mode === "submit") {
      const id = body.template_id as string;
      const { data: t, error: tErr } = await supabase
        .from("whatsapp_templates")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (tErr || !t) return json(404, { ok: false, error: "Template not found" });

      const metaName = (t.meta_template_name || t.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .slice(0, 60);

      const payload = {
        name: metaName,
        language: t.language || "en",
        category: t.category || "UTILITY",
        components: buildComponents(t),
      };

      const r = await fetch(`${base}/${s.waba_id}/message_templates`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${s.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) {
        const reason = data?.error?.error_user_msg || data?.error?.message || JSON.stringify(data);
        await supabase
          .from("whatsapp_templates")
          .update({
            sync_status: "REJECTED",
            rejection_reason: reason,
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", id);
        return json(400, { ok: false, error: reason });
      }
      await supabase
        .from("whatsapp_templates")
        .update({
          sync_status: (data.status || "PENDING").toUpperCase(),
          meta_template_id: data.id ? String(data.id) : null,
          meta_template_name: metaName,
          rejection_reason: null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", id);
      return json(200, { ok: true, meta: data });
    }

    if (mode === "refresh") {
      const r = await fetch(
        `${base}/${s.waba_id}/message_templates?limit=200&fields=name,language,status,category,id,rejected_reason`,
        { headers: { Authorization: `Bearer ${s.access_token}` } },
      );
      const data = await r.json();
      if (!r.ok) return json(400, { ok: false, error: data?.error?.message || "Meta error" });
      const items = data?.data ?? [];
      let updated = 0;
      for (const it of items) {
        const { data: rows } = await supabase
          .from("whatsapp_templates")
          .select("id")
          .eq("meta_template_name", it.name)
          .eq("language", it.language);
        if (rows && rows.length) {
          await supabase
            .from("whatsapp_templates")
            .update({
              sync_status: String(it.status || "PENDING").toUpperCase(),
              meta_template_id: it.id ? String(it.id) : null,
              rejection_reason: it.rejected_reason || null,
              last_synced_at: new Date().toISOString(),
            })
            .eq("id", rows[0].id);
          updated++;
        }
      }
      return json(200, { ok: true, updated, total: items.length });
    }

    if (mode === "delete") {
      const id = body.template_id as string;
      const { data: t } = await supabase
        .from("whatsapp_templates")
        .select("meta_template_name")
        .eq("id", id)
        .maybeSingle();
      if (t?.meta_template_name) {
        const url = new URL(`${base}/${s.waba_id}/message_templates`);
        url.searchParams.set("name", t.meta_template_name);
        await fetch(url.toString(), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${s.access_token}` },
        });
      }
      await supabase.from("whatsapp_templates").delete().eq("id", id);
      return json(200, { ok: true });
    }

    return json(400, { ok: false, error: "Unknown mode" });
  } catch (e) {
    console.error("[wa-templates-sync] error", e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : "Unknown" });
  }
});
