---
name: automation-button-actions
description: Per-button action mapping (status + AI gate + AI takeover) for template buttons in WhatsApp Automation Builder — works on the from_template trigger AND on every send_template step in any automation (new_order, new_contact, etc.).
type: feature
---

Per-button mapping (status action + AI gate + AI takeover) is available in TWO places,
and the admin must configure every button before Save-as-Live succeeds:

1. **`from_template` trigger** — config stored on
   `whatsapp_automations.trigger_config.button_actions[]`
   (mirrors `trigger_config.template_buttons[]`).
2. **`send_template` step inside ANY automation** — config stored on
   `node.data.button_actions[]` (mirrors `node.data.template_buttons[]`).

### Per-button shape
```json
{
  "status": "confirmed" | "no_change" | "new" | "no_answer" | "postponed" | "cancelled" | "new_wts",
  "ai_gate": "off" | "validate",
  "ai_takeover": true | false
}
```

- `status = "no_change"` → only flag the conversation/order via `whatsapp_note`.
- `ai_gate = "validate"` → AI talks first, status only changes after AI validates
  (address for confirm, rescue attempt for cancel). Forces `ai_takeover = true`.
- `ai_takeover = true` (without gating) → flips
  `whatsapp_conversations.ai_enabled = true` after the click; mapping is applied
  immediately.

### Validation
`WhatsappAutomationBuilder.tsx` blocks Save-as-Live when any button on a
`from_template` trigger OR any `send_template` step is missing a `status` choice.

### Application
Both paths funnel through `applyButtonAction()` in
`supabase/functions/whatsapp-automation-runner/index.ts`:
- `from_template` runs go through `startNewRunsFromTemplate` BEFORE `executeFlow`.
- In-flow `send_template` clicks go through `resumeRun` BEFORE jumping to the
  next node; the order is re-fetched so downstream steps see the new state.

The function:
- For gated buttons: stashes intent into `whatsapp_conversations.pending_button_intent`,
  sets `ai_enabled = true`, flags the order with a `whatsapp_note`, but does
  NOT change `confirmation_status`.
- For non-gated buttons with a mapped status: updates `orders.confirmation_status`
  (+ `confirmation_channel='whatsapp'`, `confirmed_at` for confirmed,
  `cancel_reason` for cancelled), writes `whatsapp_note`, and inserts an
  `order_history` row (`action_type='whatsapp_button'`).
- For `no_change`: only writes the `whatsapp_note` flag.

Hardcoded webhook button handlers (`whatsapp-webhook.applyOutcome`,
`whatsapp-action`) only handle the legacy confirm path — they no longer change
status on cancel; the per-button mapping above is the source of truth.
