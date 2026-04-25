---
name: whatsapp-campaigns
description: WhatsApp Campaigns & Broadcasts — bulk template sending with audience filters, scheduling, throttling, and delivery analytics.
type: feature
---

WhatsApp Campaigns let admins broadcast approved templates to filtered customer audiences.

**Tables:**
- `whatsapp_campaigns` — name, template_id, filters jsonb (seller_ids, cities, product_names, confirmation_status, delivery_status, date_from/to), send_mode (immediate/scheduled), scheduled_at, throttle_per_minute, counters (sent/delivered/read/replied/failed).
- `whatsapp_campaign_recipients` — one row per customer (deduped by phone), tracks status pending → sent → delivered → read / replied / failed, linked to whatsapp_messages and conversation.

**Edge function `campaign-runner`:**
- `start` — builds recipients from filters (orders table, latest per phone), processes throttled batches of 60, self-chains for the rest.
- `process_scheduled` — cron entry every minute, picks scheduled campaigns whose time arrived.
- `preview` — counts recipients without persisting (used in wizard).
- `cancel` — marks campaign cancelled.

**Webhook integration (`whatsapp-webhook`):**
- Status updates (delivered/read/failed) mirror onto matching `whatsapp_campaign_recipients` via `meta_message_id` and refresh campaign counters.
- Inbound messages mark the most recent campaign recipient on that conversation as `replied`.

**UI (`/whatsapp/campaigns`):**
- 4-step wizard: Basics (name + template) → Audience (multi-select filters with live recipient count preview) → Schedule (immediate/scheduled + throttle) → Review.
- Real-time list with progress bars and metrics (sent, delivered, read, replied, failed).
- Details dialog shows per-recipient status table.

**Cron:** `whatsapp-campaign-scheduler` runs every minute calling `campaign-runner` with `process_scheduled`.
