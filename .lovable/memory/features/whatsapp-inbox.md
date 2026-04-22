---
name: WhatsApp Inbox
description: Real-time WhatsApp inbox UI mimicking Respond.io / WhatsApp Web — conversation list with avatars, chat bubbles, 24h window enforcement, Send Template modal, internal notes, realtime via Supabase channels.
type: feature
---

WhatsApp Inbox (`/whatsapp/inbox`, `src/pages/whatsapp/WhatsappInbox.tsx`):

- **Layout**: 3-col left panel (Inbox header, search, All/Unread filter, conversation list) + main chat panel (header with avatar/badges/quick actions, messages with day separators, 24h banner, Reply/Note tabs).
- **Realtime**: Supabase channel subscribes to `whatsapp_conversations` and `whatsapp_messages` (`postgres_changes` event `*`). Both tables have `REPLICA IDENTITY FULL` and are in the `supabase_realtime` publication.
- **Read state**: Opening a conversation updates `last_message_at` so the unread emerald dot clears.
- **24h window**: If `differenceInHours(now, last_reply_at) >= 24` OR no inbound reply yet, free-form text is blocked. Reply textarea is disabled and replaced by a Template button. Banner appears above input.
- **Send Template**: `src/components/whatsapp/SendTemplateModal.tsx` lists active templates and calls `whatsapp-send` with `mode: "template"`. Uses `meta_template_name` if set (Meta-approved template), otherwise falls back to plain text.
- **Free text**: Inside 24h window, Reply uses `whatsapp-send` with `mode: "text"` (no longer direct insert) so the message is actually delivered through Meta API.
- **Internal notes**: `mode: "note"` stored as `direction: "in"`, `message_type: "note"`, `status: "internal"`. Displayed centered with amber styling. Never sent to customer.
- **Order actions**: Confirm / Send to Agent / Cancel call `whatsapp-action` edge function. Hidden if conversation has no linked `order_id`.
- **Status badges**: pending → "open" (emerald), awaiting_reply/sent → "awaiting reply" (amber), confirmed (emerald), canceled (rose), more_info → "sent to agent" (violet), manual_review_needed → "needs review" (sky).
- **WhatsApp brand colors**: Outbound bubbles use `bg-emerald-600 text-white`; this is intentional brand-matching — emerald hardcoded colors here are NOT a design-system violation.
