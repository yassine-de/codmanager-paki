---
name: WhatsApp Settings
description: WhatsApp Cloud API settings page persists Phone Number ID, WABA ID, Access Token, Webhook URL/Verify Token in whatsapp_settings table; Test connection runs Configuration + Token Validation + Phone Number Verification checks.
type: feature
---

WhatsApp Settings page (`/whatsapp/settings`, `src/pages/whatsapp/WhatsappSettings.tsx`):

- All settings persist in the `whatsapp_settings` table (singleton row). Values survive refresh — no need to re-enter.
- Fields: `phone_number_id`, `waba_id`, `access_token` (stored encrypted in DB column), `webhook_secret`.
- Webhook Callback URL is read-only and built from `VITE_SUPABASE_PROJECT_ID`.
- "Test connection" calls `whatsapp-test` edge function (mode: "connection") which returns a structured `checks` array:
  1. Configuration — verifies phone_number_id, access_token, api_base_url present.
  2. Token Validation — calls Meta Graph API with token; detects OAuthException.
  3. Phone Number Verification — displays `display_phone_number` from Meta response (e.g., 📞 +212 753-710182).
- Result panel shows pass/fail per check with duration in ms. Uses semantic tokens (text-primary for OK, text-destructive for fail).
- Edge function prioritizes DB-stored `access_token` over `WHATSAPP_META_ACCESS_TOKEN` env secret.
- "Test connection" auto-saves the form before invoking the function so fresh values are read from DB.
