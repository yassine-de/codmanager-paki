// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0?no-check";
import { parseSheetOrderItems } from "../_shared/sheet-order-items.ts";

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

// ── Number parsing helpers ──

/**
 * Safely parses a number from a sheet cell.
 * Handles thousand separators ("8,372.00" → 8372), spaces, and currency-like input.
 * Returns NaN if the value cannot be parsed as a number.
 */
function parseSheetNumber(raw: string | undefined | null): number {
  if (raw === undefined || raw === null) return NaN;
  const s = String(raw).trim();
  if (!s) return NaN;
  // Remove commas (thousand separators) and any spaces
  const cleaned = s.replace(/,/g, "").replace(/\s/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : NaN;
}

/** Convert a spreadsheet column letter (A, B, ..., Z, AA) to a 0-based index. */
function colLetterToIndex(letter: string): number {
  const up = letter.toUpperCase().trim();
  let idx = 0;
  for (let i = 0; i < up.length; i++) {
    idx = idx * 26 + (up.charCodeAt(i) - 64);
  }
  return idx - 1;
}

const DEFAULT_MAPPING: Record<string, string> = {
  order_id: "A", customer_name: "B", phone: "C", address: "D", city: "E",
  product_name: "F", sku: "G", quantity: "H", price: "I", total: "J",
};

function getCell(row: string[], mapping: Record<string, string>, key: string): string {
  const letter = mapping[key] || DEFAULT_MAPPING[key];
  if (!letter) return "";
  const idx = colLetterToIndex(letter);
  return row[idx] ?? "";
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
  // Read up to column Z so non-default mappings still work
  const range = encodeURIComponent(`'${sheetName}'!A${startRow}:Z`);
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
    const maxRowsPerSheet = Math.max(
      1,
      Math.min(Number(Deno.env.get("SHEETS_IMPORT_BATCH_SIZE") || "500"), 1000),
    );
    const maxConsecutiveEmptyRows = Math.max(
      1,
      Math.min(Number(Deno.env.get("SHEETS_IMPORT_MAX_EMPTY_ROWS") || "25"), 500),
    );

    const { data: sheets, error: sheetsError } = await supabase
      .from("integration_sheets").select("*").eq("active", true);

    if (sheetsError) throw sheetsError;
    if (!sheets || sheets.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active sheets" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: allProducts, error: productsError } = await supabase
      .from("products")
      .select("id, sku, seller_id, name, price, weight, weight_kg, product_url, video_url, active, whatsapp_confirmation_enabled");
    if (productsError) throw productsError;

    const { data: allVariants, error: variantsError } = await supabase
      .from("product_variants")
      .select("id, product_id, sku, name, price, weight_kg, active");
    if (variantsError) throw variantsError;

    const productById = new Map((allProducts || []).map((product) => [product.id, product]));
    const variantsByProduct = new Map<string, any[]>();
    for (const variant of allVariants || []) {
      const variants = variantsByProduct.get(variant.product_id) || [];
      variants.push(variant);
      variantsByProduct.set(variant.product_id, variants);
    }

    const skuMap = new Map<string, { product: any; variant: any | null; requiresVariantSku: boolean }>();
    for (const product of allProducts || []) {
      const activeVariants = (variantsByProduct.get(product.id) || []).filter((variant) => variant.active);
      skuMap.set(product.sku.toLowerCase(), {
        product,
        variant: activeVariants.length === 1 ? activeVariants[0] : null,
        requiresVariantSku: activeVariants.length > 1,
      });
    }
    for (const variant of allVariants || []) {
      const product = productById.get(variant.product_id);
      if (product) {
        skuMap.set(variant.sku.toLowerCase(), { product, variant, requiresVariantSku: false });
      }
    }

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

      if (rows.length > maxRowsPerSheet) {
        rows = rows.slice(0, maxRowsPerSheet);
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
      let consecutiveEmptyRows = 0;
      let stoppedAtEmptyGap = false;
      let stoppedAtInsertFailure = false;
      let insertFailureRowIndex = -1;
      let lastNonEmptyRowIndex = -1;

      // Resolve per-sheet column mapping (falls back to defaults)
      const mapping: Record<string, string> = {
        ...DEFAULT_MAPPING,
        ...((sheet as any).column_mapping || {}),
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 3 || row.every((cell) => !String(cell || "").trim())) {
          skipped++;
          consecutiveEmptyRows++;
          if (consecutiveEmptyRows >= maxConsecutiveEmptyRows) {
            stoppedAtEmptyGap = true;
            rows = rows.slice(0, i + 1);
            break;
          }
          continue;
        }

        consecutiveEmptyRows = 0;
        lastNonEmptyRowIndex = i;

        const orderId = getCell(row, mapping, "order_id");
        const customerName = getCell(row, mapping, "customer_name");
        const phone = getCell(row, mapping, "phone");
        const address = getCell(row, mapping, "address");
        const city = getCell(row, mapping, "city");
        const productName = getCell(row, mapping, "product_name");
        const sku = getCell(row, mapping, "sku");
        const qtyStr = getCell(row, mapping, "quantity");
        const priceStr = getCell(row, mapping, "price");
        const totalStr = getCell(row, mapping, "total");

        if (!sku || !customerName || !phone) { skipped++; continue; }

        const rawOrderData = {
          order_id: orderId || "",
          customer_name: customerName || "",
          phone: phone || "",
          address: address || "",
          city: city || "",
          product_name: productName || "",
          sku: sku || "",
          quantity: qtyStr || "",
          unit_price: priceStr || "",
          total_amount: totalStr || "",
        };

        let rawItems;
        try {
          rawItems = parseSheetOrderItems({
            productName,
            sku,
            quantity: qtyStr,
            price: priceStr,
          });
        } catch (itemParseError) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: rawOrderData as any,
            error_message: itemParseError instanceof Error ? itemParseError.message : "Invalid multi-item columns",
          });
          errorsCount++;
          continue;
        }

        // ── Phone validation & formatting ──
        const phoneResult = normalizePhone(phone);
        const parsedTotal = parseSheetNumber(totalStr);

        if (!phoneResult.valid) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: rawOrderData as any,
            error_message: phoneResult.reason,
          });
          errorsCount++;
          continue;
        }

        const normalizedPhone = phoneResult.phone;
        const resolvedItems: any[] = [];
        let itemValidationError = "";

        for (const rawItem of rawItems) {
          const catalogItem = skuMap.get(rawItem.sku.toLowerCase());
          if (!catalogItem) {
            itemValidationError = `SKU "${rawItem.sku}" not found in system`;
            break;
          }

          const { product, variant, requiresVariantSku } = catalogItem;
          if (product.seller_id !== sheet.seller_id) {
            itemValidationError = `SKU "${rawItem.sku}" does not belong to this seller`;
            break;
          }
          if (!product.active) {
            itemValidationError = `Product "${product.name}" (SKU: ${rawItem.sku}) is inactive — missing product link or video link`;
            break;
          }
          if (variant && !variant.active) {
            itemValidationError = `Variant SKU "${rawItem.sku}" is inactive`;
            break;
          }
          if (requiresVariantSku) {
            itemValidationError = `SKU "${rawItem.sku}" has multiple variants. Use the exact variant SKU in the sheet`;
            break;
          }

          const parsedQty = parseSheetNumber(rawItem.quantity);
          const parsedPrice = parseSheetNumber(rawItem.price);
          const quantity = isFinite(parsedQty) && parsedQty > 0 ? Math.floor(parsedQty) : 1;
          const catalogPrice = Number(variant?.price) || Number(product.price) || 0;
          const unitPrice = isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : catalogPrice;

          if (unitPrice > 0 && unitPrice < 50) {
            itemValidationError = `Price "${rawItem.price}" for SKU "${rawItem.sku}" parsed as ${unitPrice} PKR and is suspiciously low (< 50)`;
            break;
          }
          if (catalogPrice > 100 && unitPrice > 0 && unitPrice < catalogPrice * 0.1) {
            itemValidationError = `Price ${unitPrice} PKR for SKU "${rawItem.sku}" is far below product price ${catalogPrice} PKR`;
            break;
          }

          const weightKg = Number(variant?.weight_kg) || Number(product.weight_kg) || Number.parseFloat(product.weight || "0") || 0;
          resolvedItems.push({
            product,
            variant,
            sku: variant?.sku || product.sku,
            quantity,
            unitPrice,
            totalPrice: quantity * unitPrice,
            weightKg,
          });
        }

        if (itemValidationError) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: { ...rawOrderData, items: rawItems } as any,
            error_message: itemValidationError,
          });
          errorsCount++;
          continue;
        }

        const mainItem = resolvedItems[0];
        const totalQuantity = resolvedItems.reduce((sum, item) => sum + item.quantity, 0);
        const computedTotal = resolvedItems.reduce((sum, item) => sum + item.totalPrice, 0);
        const totalAmount = isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : computedTotal;
        const totalWeight = resolvedItems.reduce((sum, item) => sum + (item.weightKg * item.quantity), 0);

        // Duplicate check
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

        const { data: existing } = await supabase
          .from("orders").select("id")
          .eq("customer_phone", normalizedPhone)
          .eq("product_name", mainItem.product.name)
          .eq("seller_id", sheet.seller_id)
          .gte("created_at", startOfDay)
          .lt("created_at", endOfDay)
          .limit(1);

        if (existing && existing.length > 0) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: { ...rawOrderData, items: rawItems } as any,
            error_message: `Duplicate: same phone "${normalizedPhone}" + product "${mainItem.product.name}" already exists today`,
          });
          errorsCount++;
          continue;
        }

        const { data: generatedId } = await supabase.rpc("generate_order_id", {
          p_seller_id: sheet.seller_id,
        });
        const orderIdToInsert = generatedId || rawOrderData.order_id;
        const routeToWhatsapp = !!mainItem.product.whatsapp_confirmation_enabled;

        const { error: insertError } = await supabase.rpc("create_sheet_order_with_items", {
          p_order: {
            order_id: orderIdToInsert,
            seller_id: sheet.seller_id,
            customer_name: customerName,
            customer_phone: normalizedPhone,
            customer_address: address,
            customer_city: city,
            product_name: mainItem.product.name,
            product_url: mainItem.product.product_url || "",
            video_url: mainItem.product.video_url || "",
            quantity: totalQuantity,
            price: mainItem.unitPrice,
            total_amount: totalAmount,
            weight: totalWeight,
            source_sheet_id: sheet.id,
            confirmation_status: routeToWhatsapp ? "new_wts" : "new",
            confirmation_channel: routeToWhatsapp ? "whatsapp" : "agent",
            whatsapp_status: routeToWhatsapp ? "pending" : "",
          },
          p_items: resolvedItems.map((item, itemIndex) => ({
            product_id: item.product.id,
            product_variant_id: item.variant?.id || null,
            sku: item.sku,
            product_name: item.product.name,
            variant_name: item.variant?.name || null,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            weight_kg: item.weightKg || null,
            metadata: {
              source: "google_sheet",
              source_sheet_id: sheet.id,
              sheet_item_index: itemIndex,
              sheet_item_count: resolvedItems.length,
            },
          })),
        });

        if (insertError) {
          await supabase.from("integration_errors").insert({
            sheet_id: sheet.id,
            order_data: { ...rawOrderData, items: rawItems } as any,
            error_message: `Insert failed: ${insertError.message}`,
          });
          errorsCount++;
          // A system/database failure is retryable. Stop here and keep the
          // cursor before this row so the next sync cannot silently skip it.
          stoppedAtInsertFailure = true;
          insertFailureRowIndex = i;
          break;
        } else {
          imported++;
          if (routeToWhatsapp) {
            try {
              const runnerResponse = await fetch(`${supabaseUrl}/functions/v1/whatsapp-automation-runner`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${serviceRoleKey}`,
                },
                body: JSON.stringify({ trigger_type: "new_order", order_id: orderIdToInsert }),
              });
              if (!runnerResponse.ok) {
                const runnerBody = await runnerResponse.text();
                console.error(`WhatsApp automation start failed for order ${orderIdToInsert}:`, runnerBody);
              }
            } catch (automationError) {
              console.error(`WhatsApp automation start failed for order ${orderIdToInsert}:`, automationError);
            }
          }
        }
      }

      const newLastRow = stoppedAtInsertFailure
        ? Math.max(sheet.last_imported_row, startRow + insertFailureRowIndex - 1)
        : stoppedAtEmptyGap
          ? (lastNonEmptyRowIndex >= 0 ? startRow + lastNonEmptyRowIndex : sheet.last_imported_row)
          : startRow + rows.length - 1;
      await supabase.from("integration_sheets")
        .update({
          last_imported_row: newLastRow,
          last_check: new Date().toISOString(),
          orders_count: sheet.orders_count + imported,
          errors_count: sheet.errors_count + errorsCount,
        })
        .eq("id", sheet.id);

      results[sheet.id] = { imported, errors: errorsCount, skipped, stoppedAtEmptyGap, stoppedAtInsertFailure };
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
