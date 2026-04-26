---
name: automation-button-actions
description: Per-button action mapping in WhatsApp Automation Builder for from_template trigger — admin must pick a status action and AI-takeover toggle for every button.
type: feature
---

When an automation uses the `from_template` trigger AND the picked template has buttons,
the Automation Builder requires the admin to configure **every** button:

- **Order status (required)**: dropdown per button
  - `no_change` — only flag the conversation/order via `whatsapp_note` (no status change)
  - or any of: `new`, `confirmed`, `no_answer`, `postponed`, `cancelled`, `new_wts`
- **AI takeover (toggle)**: when ON, sets `whatsapp_conversations.ai_enabled=true` after the click,
  letting the AI continue the conversation. When OFF, ai_enabled is left untouched.

Stored in `whatsapp_automations.trigger_config.button_actions` as an array indexed
by button position (mirrors `template_buttons`):
```json
{ "button_actions": [
  { "status": "confirmed", "ai_takeover": false },
  { "status": "no_change", "ai_takeover": true }
] }
```

Validation in `WhatsappAutomationBuilder.tsx` blocks Save-as-Live when any button
is missing a status choice.

Applied by `whatsapp-automation-runner.startNewRunsFromTemplate` BEFORE `executeFlow`
via `applyButtonAction()`:
- Updates `orders.confirmation_status` (+ `confirmation_channel='whatsapp'`,
  `confirmed_at` for confirmed, `cancel_reason` for cancelled).
- Always writes `whatsapp_note = 'Customer clicked "<button>" on WhatsApp'` and
  refreshes `whatsapp_last_reply_at`.
- Inserts an `order_history` row (`action_type='whatsapp_button'`) when status changes.
- The order is re-fetched so downstream nodes see the new state.

Hardcoded webhook button handlers (`whatsapp-webhook.applyOutcome`,
`whatsapp-action`) only handle the legacy confirm path — they no longer change
status on cancel; the per-automation mapping above is now the source of truth
for button-driven status changes.
