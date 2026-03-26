import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SheetRow {
  order_id: string;
  customer_name: string;
  phone: string;
  address: string;
  city: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
}

// Parse the Google Sheet URL to extract the spreadsheet ID
function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Get access token from service account JSON key
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

  // Import the private key
  const pemContent = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signInput)
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
  if (!tokenResp.ok) {
    throw new Error(`Google auth failed: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// Fetch rows from the sheet starting at a specific row
async function fetchSheetRows(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  startRow: number
): Promise<string[][]> {
  // Fetch from startRow onwards (A{startRow}:J to get 10 columns)
  const range = encodeURIComponent(`${sheetName}!A${startRow}:J`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Sheets API error [${resp.status}]: ${body}`);
  }

  const data = await resp.json();
  return data.values || [];
}

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

    // Get access token
    const accessToken = await getAccessToken(googleKey);

    // Fetch all active sheets
    const { data: sheets, error: sheetsError } = await supabase
      .from("integration_sheets")
      .select("*")
      .eq("active", true);

    if (sheetsError) throw sheetsError;
    if (!sheets || sheets.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active sheets" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all existing SKUs with their seller mapping
    const { data: allProducts } = await supabase
      .from("products")
      .select("sku, seller_id, name, price, weight, product_url, video_url");

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
      const startRow = (sheet.last_imported_row || 1) + 1; // +1 to skip header or last imported

      let rows: string[][];
      try {
        rows = await fetchSheetRows(accessToken, spreadsheetId, sheetName, startRow);
      } catch (err) {
        console.error(`Error fetching sheet ${sheet.id}:`, err);
        continue;
      }

      if (rows.length === 0) {
        // Update last_check even if no new rows
        await supabase
          .from("integration_sheets")
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
        // Expected: Order ID, Customer Name, Phone Number, Address, City, Product Name, SKU, Quantity, Unit Price, Total Amount
        if (!row || row.length < 7) {
          skipped++;
          continue;
        }

        const [orderId, customerName, phone, address, city, productName, sku, qtyStr, priceStr, totalStr] = row;

        // Skip empty rows
        if (!sku || !customerName || !phone) {
          skipped++;
          continue;
        }

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

        // Check SKU exists and belongs to this seller
        const product = skuMap.get(sku.toLowerCase());
        if (!product || product.seller_id !== sheet.seller_id) {
          // Log error: SKU not found
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

        // Duplicate check: same phone + same product_name + same day
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

        const { data: existing } = await supabase
          .from("orders")
          .select("id")
          .eq("customer_phone", phone)
          .eq("product_name", product.name)
          .eq("seller_id", sheet.seller_id)
          .gte("created_at", startOfDay)
          .lt("created_at", endOfDay)
          .limit(1);

        if (existing && existing.length > 0) {
          // Log as duplicate error
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: orderData as any,
            error_message: `Duplicate: same phone "${phone}" + product "${product.name}" already exists today`,
          });
          errorsCount++;
          continue;
        }

        // Generate order ID
        const { data: generatedId } = await supabase.rpc("generate_order_id", {
          p_seller_id: sheet.seller_id,
        });

        // Insert order
        const { error: insertError } = await supabase.from("orders").insert({
          order_id: generatedId || orderData.order_id,
          seller_id: sheet.seller_id,
          customer_name: orderData.customer_name,
          customer_phone: orderData.phone,
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

      // Update sheet: last_imported_row, orders_count, errors_count, last_check
      const newLastRow = startRow + rows.length - 1;
      await supabase
        .from("integration_sheets")
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
