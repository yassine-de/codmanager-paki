---
name: WhatsApp AI Sweeper + last_reply_at semantics
description: Background sweeper retries unanswered AI replies. last_reply_at = AI/agent OUTBOUND only; last_message_at = any activity. Sweeper filters on last_message_at.
type: feature
---

## Sweeper (`sweepUnansweredConversations` in `whatsapp-webhook`)
Cron-invoked (`?sweep=1`). Picks AI-enabled convs whose **last activity** is older than `minSilenceSec` (default 90s) and last 24h, where the very last message is inbound and no outbound followed.

## CRITICAL FIELD SEMANTICS
- `whatsapp_conversations.last_message_at` → bumped on **any** message (inbound OR outbound).
- `whatsapp_conversations.last_reply_at` → bumped **ONLY** when the AI/agent sends an outbound reply. Never on inbound.

The inbound-message handler (line ~622) MUST NOT touch `last_reply_at`. The sweeper filter MUST use `last_message_at` (not `last_reply_at`).

## Historical bug (fixed)
Inbound handler used to bump both `last_reply_at` AND `last_message_at`. Sweeper filtered on `last_reply_at <= now-90s`. Result: every customer message reset the "fresh reply" clock, so convs where the customer sent the final message right after a button-confirmed order (e.g. AB-299: customer sent address 30s after clicking confirm) never appeared in the sweep, and the AI never got a second chance to reply or extract the address.

Fix: stop bumping `last_reply_at` on inbound; sweeper now filters on `last_message_at`.
