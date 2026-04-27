---
name: whatsapp-ai-product-image
description: WhatsApp AI auto-reply sends product image via OpenAI tool-calling, falling back to a Firecrawl-scraped image when no manual image_url exists
type: feature
---
When a customer asks for a product photo (any language: "tswira", "صورة", "photo", "picture", etc.), the AI in `whatsapp-webhook` (`aiContinueReply`) sends the real product image as a WhatsApp `image` message — never as a text URL.

Image source priority (effective URL):
1. `products.image_url` (manual upload by admin/seller)
2. `products.scraped_image_url` (auto-extracted from store page via Firecrawl)

Auto-scrape behavior:
- If neither image is available AND the product has a valid `product_url`, `aiContinueReply` invokes `product-context-fetch` with `force=true` to refresh and extract an image even if `ai_context` is still fresh (image-only backfill).
- `product-context-fetch` reads Firecrawl `metadata.ogImage` / `og:image` / `twitterImage` / `image` (string or array). Fallback: first `![](url)` markdown image. Saves to `products.scraped_image_url` (column added in migration).
- 7-day cache for `ai_context`; image is refreshed alongside it (or via the force path above).

Tool-calling:
- Lookup `products` by case-insensitive name match against `order.product_name`.
- If an effective image URL exists, expose OpenAI function tool `send_product_image` (no params) and add a system rule instructing the AI to call it on photo requests; otherwise instruct the AI to apologize.
- When the model returns a `tool_calls` for `send_product_image`, send the image via Meta `/{phone_number_id}/messages` (`type: image`, `image.link = effectiveImageUrl`, caption = product name) using helper `sendWhatsappImage`. Outbound message stored with `message_type: "image"` and payload flag `_ai_tool: "send_product_image"`.
- If the model returned no text alongside the tool call, a short follow-up text is generated via a second OpenAI call so the conversation keeps flowing.

MIME compatibility (CRITICAL):
- WhatsApp Cloud API only accepts `image/jpeg` and `image/png`. WebP / AVIF / GIF are rejected with `Unsupported Image mime type image/webp` and the message is logged as `failed`.
- `sendWhatsappImage` (and the manual `whatsapp-send` image branch) check the URL extension. If it is not `.jpg/.jpeg/.png`, the URL is rewritten to `https://wsrv.nl/?url=<encoded>&output=jpg&q=85` — a free public image proxy that re-encodes any source to `Content-Type: image/jpeg`. Meta's media-fetch then accepts it.
- The original source URL is preserved in `payload._src_url` for debugging.
