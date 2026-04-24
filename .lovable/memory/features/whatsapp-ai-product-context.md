---
name: whatsapp-ai-product-context
description: WhatsApp AI uses Firecrawl-scraped store page content (cached 7 days in products.ai_context) to answer customer questions about the product
type: feature
---
The WhatsApp AI assistant (`whatsapp-webhook` → `aiContinueReply`) is grounded with real product info scraped from the seller's store URL via Firecrawl. This lets the AI answer questions about features, materials, sizes, colors, usage, etc. without hallucinating.

Architecture (hybrid: cached + scrape on demand):
- Columns on `products`: `ai_context` (text, scraped markdown + title/description header) and `ai_context_scraped_at` (timestamptz).
- Edge function `product-context-fetch` (POST `{ product_id, force? }`):
  - Reads `products.product_url`. Fails 400 if missing/non-http.
  - Cache hit if `ai_context` exists and `now - ai_context_scraped_at < 7d` and `force !== true` → returns cached.
  - Otherwise calls Firecrawl v2 `POST https://api.firecrawl.dev/v2/scrape` with `{ url, formats:["markdown"], onlyMainContent:true }` using `FIRECRAWL_API_KEY`.
  - Saves `ai_context = "Title: …\nDescription: …\nSource: <url>\n\n<markdown truncated to 8000 chars>"` and updates `ai_context_scraped_at`.
- `whatsapp-webhook` (`aiContinueReply`):
  - Selects `id, name, image_url, price, product_url, ai_context, ai_context_scraped_at` for the matched product.
  - If `product_url` exists and context is missing or older than 7 days, lazily invokes `product-context-fetch` (non-blocking on failure).
  - Injects `productContext` block into the system prompt right after `orderCtx`, instructing the model to stay accurate and not invent facts beyond the scraped text.
- UI: `ProductDetail.tsx` shows an admin-only "AI Product Context" card with the cached text, last-updated timestamp, store link, and a "Refresh / Scrape Store Page" button that calls `product-context-fetch` with `force: true`.

Secret: `FIRECRAWL_API_KEY` (added via Lovable secret store).
