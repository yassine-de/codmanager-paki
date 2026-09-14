-- Tezly's WhatsApp Business Account was disabled by Meta and has since been
-- reconnected under a new number — a fresh number means a fresh set of
-- conversations going forward, but the old ones (tied to the disabled
-- number) are still valuable history. One-time cutover: every conversation
-- that exists right now (before the new number's traffic starts) is the old
-- batch; anything created from here on is the new one.
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;

UPDATE public.whatsapp_conversations SET is_legacy = true WHERE is_legacy = false;
