---
name: whatsapp-ai-product-image
description: WhatsApp AI auto-reply can send the product image via OpenAI tool-calling when the customer asks for a photo
type: feature
---
When a customer asks for a product photo (any language: "tswira", "صورة", "photo", "picture", etc.), the AI in `whatsapp-webhook` (`aiContinueReply`) sends the real product image as a WhatsApp `image` message — never as a text URL.

Implementation:
- Lookup `products.image_url` by matching `order.product_name` (case-insensitive).
- If a valid http(s) image URL exists, expose an OpenAI function tool `send_product_image` (no params) and add a system rule instructing the AI to call it on photo requests; otherwise instruct the AI to apologize.
- When the model returns a `tool_calls` for `send_product_image`, send the image via Meta `/{phone_number_id}/messages` (`type: image`, `image.link = product.image_url`, caption = product name) using helper `sendWhatsappImage`. Outbound message stored with `message_type: "image"` and payload flag `_ai_tool: "send_product_image"`.
- If the model returned no text alongside the tool call, a short follow-up text is generated via a second OpenAI call so the conversation keeps flowing.
