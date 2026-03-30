import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Phone number helpers ──

/** Returns true if phone contains any letter */
function hasLetters(phone: string): boolean {
  return /[a-zA-Z]/.test(phone);
}

/** Strip spaces, dashes, dots, parentheses */
function cleanPhone(raw: string): string {
  return raw.replace(/[\s\-\.\(\)]/g, "");
}

/**
 * Normalize phone to +92XXXXXXXXXX format.
 * Returns { valid: true, phone } or { valid: false, reason }.
 */
function normalizePhone(raw: string): { valid: true; phone: string } | { valid: false; reason: string } {
  if (!raw || !raw.trim()) {
    return { valid: false, reason: "Phone number is empty" };
  }

  // Check for letters first
  if (hasLetters(raw)) {
    return { valid: false, reason: `Phone "${raw}" contains letters` };
  }

  let phone = cleanPhone(raw);

  // Convert 0092... → +92...
  if (phone.startsWith("0092")) {
    phone = "+92" + phone.slice(4);
  }
  // Convert 92... (without +) → +92...
  else if (phone.startsWith("92") && !phone.startsWith("+")) {
    phone = "+" + phone;
  }
  // No country code — prepend +92
  else if (phone.startsWith("0")) {
    phone = "+92" + phone.slice(1);
  }
  // Already has +92
  else if (phone.startsWith("+92")) {
    // keep as-is
  }
  // Just digits without any prefix (e.g. 3001234567)
  else if (/^\d+$/.test(phone)) {
    phone = "+92" + phone;
  }

  // Validate length: +92 + 10 digits = 13 chars
  const digitsOnly = phone.replace(/\D/g, "");
  if (digitsOnly.length < 11 || digitsOnly.length > 13) {
    return { valid: false, reason: `Phone "${raw}" has invalid length (${digitsOnly.length} digits after formatting to "${phone}")` };
  }

  return { valid: true, phone };
}

// ── Google Sheets helpers ──

function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function getAccessToken(serviceAccountKey: string): Promise<string> {
  const sa = JSON.parse(serviceAccountKey);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const claimSet = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signInput = `${header}.${claimSet}`;
  const pemContent = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signInput)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${signInput}.${signature}`;
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenResp.json();
  if (!tokenResp.ok) throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

async function fetchSheetRows(
  accessToken: string, spreadsheetId: string, sheetName: string, startRow: number
): Promise<string[][]> {
  const range = encodeURIComponent(`'${sheetName}'!A${startRow}:J`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Sheets API error [${resp.status}]: ${body}`);
  }
  const data = await resp.json();
  return data.values || [];
}

// ── Main handler ──

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");

    if (!googleKey) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_SERVICE_ACCOUNT_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const accessToken = await getAccessToken(googleKey);

    const { data: sheets, error: sheetsError } = await supabase
      .from("integration_sheets").select("*").eq("active", true);

    if (sheetsError) throw sheetsError;
    if (!sheets || sheets.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active sheets" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: allProducts } = await supabase
      .from("products")
      .select("sku, seller_id, name, price, weight, product_url, video_url, active");

    const skuMap = new Map<string, typeof allProducts extends (infer T)[] ? T : never>();
    allProducts?.forEach((p) => skuMap.set(p.sku.toLowerCase(), p));

    const results: Record<string, { imported: number; errors: number; skipped: number }> = {};

    for (const sheet of sheets) {
      const spreadsheetId = extractSpreadsheetId(sheet.sheet_url);
      if (!spreadsheetId) {
        console.error(`Invalid URL for sheet ${sheet.id}: ${sheet.sheet_url}`);
        continue;
      }

      const sheetName = sheet.sheet_name || "Sheet1";
      const startRow = (sheet.last_imported_row || 1) + 1;

      let rows: string[][];
      try {
        rows = await fetchSheetRows(accessToken, spreadsheetId, sheetName, startRow);
      } catch (err) {
        console.error(`Error fetching sheet ${sheet.id}:`, err);
        continue;
      }

      if (rows.length === 0) {
        await supabase.from("integration_sheets")
          .update({ last_check: new Date().toISOString() })
          .eq("id", sheet.id);
        results[sheet.id] = { imported: 0, errors: 0, skipped: 0 };
        continue;
      }

      let imported = 0;
      let errorsCount = 0;
      let skipped = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 7) { skipped++; continue; }

        const [orderId, customerName, phone, address, city, productName, sku, qtyStr, priceStr, totalStr] = row;

        if (!sku || !customerName || !phone) { skipped++; continue; }

        // ── Phone validation & formatting ──
        const phoneResult = normalizePhone(phone);

        const orderData = {
          order_id: orderId || "",
          customer_name: customerName || "",
          phone: phone || "",
          address: address || "",
          city: city || "",
          product_name: productName || "",
          sku: sku || "",
          quantity: parseInt(qtyStr) || 1,
          unit_price: parseFloat(priceStr) || 0,
          total_amount: parseFloat(totalStr) || 0,
        };

        if (!phoneResult.valid) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: orderData as any,
            error_message: phoneResult.reason,
          });
          errorsCount++;
          continue;
        }

        const normalizedPhone = phoneResult.phone;

        // Check SKU exists and belongs to this seller
        const product = skuMap.get(sku.toLowerCase());
        if (!product || product.seller_id !== sheet.seller_id) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: orderData as any,
            error_message: product
              ? `SKU "${sku}" does not belong to this seller`
              : `SKU "${sku}" not found in system`,
          });
          errorsCount++;
          continue;
        }

        // Check product is active (has product_url and video_url)
        if (!product.active) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: orderData as any,
            error_message: `Product "${product.name}" (SKU: ${sku}) is inactive — missing product link or video link`,
          });
          errorsCount++;
          continue;
        }

        // Duplicate check
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

        const { data: existing } = await supabase
          .from("orders").select("id")
          .eq("customer_phone", normalizedPhone)
          .eq("product_name", product.name)
          .eq("seller_id", sheet.seller_id)
          .gte("created_at", startOfDay)
          .lt("created_at", endOfDay)
          .limit(1);

        if (existing && existing.length > 0) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: orderData as any,
            error_message: `Duplicate: same phone "${normalizedPhone}" + product "${product.name}" already exists today`,
          });
          errorsCount++;
          continue;
        }

        const { data: generatedId } = await supabase.rpc("generate_order_id", {
          p_seller_id: sheet.seller_id,
        });

        const { error: insertError } = await supabase.from("orders").insert({
          order_id: generatedId || orderData.order_id,
          seller_id: sheet.seller_id,
          customer_name: orderData.customer_name,
          customer_phone: normalizedPhone,
          customer_address: orderData.address,
          customer_city: orderData.city,
          product_name: product.name,
          product_url: product.product_url || "",
          video_url: product.video_url || "",
          quantity: orderData.quantity,
          price: orderData.unit_price || product.price,
          total_amount: orderData.total_amount || (orderData.quantity * (orderData.unit_price || product.price)),
          weight: product.weight ? parseFloat(product.weight) : 0,
          source_sheet_id: sheet.id,
          confirmation_status: "new",
        });

        if (insertError) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: orderData as any,
            error_message: `Insert failed: ${insertError.message}`,
          });
          errorsCount++;
        } else {
          imported++;
        }
      }

      const newLastRow = startRow + rows.length - 1;
      await supabase.from("integration_sheets")
        .update({
          last_imported_row: newLastRow,
          last_check: new Date().toISOString(),
          orders_count: sheet.orders_count + imported,
          errors_count: sheet.errors_count + errorsCount,
        })
        .eq("id", sheet.id);

      results[sheet.id] = { imported, errors: errorsCount, skipped };
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Import error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
