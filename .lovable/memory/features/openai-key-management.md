---
name: OpenAI API Key Management
description: UI-based persistent OpenAI API key storage in app_settings, used by whatsapp-ai and openai-test edge functions
type: feature
---
The OpenAI API key for the WhatsApp AI engine is managed via the UI on `/whatsapp/ai` (Connection tab).

- Stored in `app_settings` table under `key = 'openai_api_key'` (admin-only via RLS).
- Edge function `openai-key-save` handles save/get/delete (admin-gated, validates `sk-` prefix).
- Edge functions `whatsapp-ai` and `openai-test` read the key from `app_settings` first, falling back to `OPENAI_API_KEY` env var.
- Key is persisted — entered once, remembered across sessions.
- UI shows masked key (`sk-...XXXX`) when configured, with Remove button to clear.
