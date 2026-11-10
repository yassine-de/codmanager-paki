-- Campaign engine: set-based audience, race-free claiming and bulk result logging so a
-- campaign can run on the server at WhatsApp's full throughput (80 msg/s) without
-- depending on any browser tab, and so the audience is no longer capped at 1000 orders
-- (PostgREST max-rows silently truncated the old `.limit(5000)` query to 1000).

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS runner_lock_until timestamptz;

ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS processing_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- The webhook mirrors every delivered/read/failed status onto the recipient by
-- meta_message_id and every inbound reply by conversation_id; neither had an index.
CREATE INDEX IF NOT EXISTS idx_wts_camp_recip_meta_msg
  ON public.whatsapp_campaign_recipients (meta_message_id) WHERE meta_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wts_camp_recip_conversation
  ON public.whatsapp_campaign_recipients (conversation_id) WHERE conversation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Audience
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.campaign_filter_list(p_filters jsonb, p_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_filters -> p_key) = 'array'
    THEN ARRAY(SELECT jsonb_array_elements_text(p_filters -> p_key))
    ELSE ARRAY[]::text[]
  END;
$$;

-- Date filters: "YYYY-MM-DD" means the whole day in Pakistan time (+05:00); anything else
-- is parsed as a timestamp (campaigns created before this change stored full ISO strings).
CREATE OR REPLACE FUNCTION public.campaign_filter_ts(p_value text, p_end boolean)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_value = '' THEN NULL
    WHEN p_value ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (p_value || CASE WHEN p_end THEN 'T23:59:59.999+05:00' ELSE 'T00:00:00+05:00' END)::timestamptz
    ELSE p_value::timestamptz
  END;
$$;

CREATE OR REPLACE FUNCTION public.campaign_matching_orders(p_filters jsonb)
RETURNS TABLE (
  order_id text,
  customer_phone text,
  phone_key text,
  customer_name text,
  customer_city text,
  product_name text,
  total_amount numeric,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH f AS (
    SELECT
      public.campaign_filter_list(p_filters, 'seller_ids') AS sellers,
      public.campaign_filter_list(p_filters, 'cities') AS cities,
      public.campaign_filter_list(p_filters, 'confirmation_status') AS conf,
      public.campaign_filter_list(p_filters, 'delivery_status') AS deliv,
      public.campaign_filter_list(p_filters, 'product_names') AS products,
      public.campaign_filter_ts(p_filters ->> 'date_from', false) AS d_from,
      public.campaign_filter_ts(p_filters ->> 'date_to', true) AS d_to
  )
  SELECT o.order_id, o.customer_phone, o.customer_phone_normalized, o.customer_name,
         o.customer_city, o.product_name, o.total_amount, o.created_at
  FROM public.orders o, f
  WHERE (cardinality(f.sellers) = 0 OR o.seller_id::text = ANY (f.sellers))
    AND (cardinality(f.cities) = 0 OR o.customer_city = ANY (f.cities))
    AND (cardinality(f.conf) = 0 OR o.confirmation_status = ANY (f.conf))
    -- 'none' = orders that have no delivery status yet (never shipped)
    AND (cardinality(f.deliv) = 0 OR coalesce(o.delivery_status, 'none') = ANY (f.deliv))
    AND (cardinality(f.products) = 0 OR o.product_name = ANY (f.products))
    AND (f.d_from IS NULL OR o.created_at >= f.d_from)
    AND (f.d_to IS NULL OR o.created_at <= f.d_to);
$$;

-- One recipient per (phone, product), newest order wins. Numbers that cannot be a real
-- phone (empty, too short, or corrupted/too long) are excluded up front instead of
-- burning a send that Meta will reject.
CREATE OR REPLACE FUNCTION public.campaign_audience_counts(p_filters jsonb)
RETURNS TABLE (total_orders integer, invalid_phones integer, recipients integer, duplicates integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH m AS (SELECT * FROM public.campaign_matching_orders(p_filters)),
  v AS (SELECT * FROM m WHERE length(coalesce(phone_key, '')) BETWEEN 10 AND 15),
  d AS (
    SELECT DISTINCT ON (phone_key, lower(trim(coalesce(product_name, ''))))
           phone_key
    FROM v
    ORDER BY phone_key, lower(trim(coalesce(product_name, ''))), created_at DESC
  )
  SELECT
    (SELECT count(*) FROM m)::int,
    ((SELECT count(*) FROM m) - (SELECT count(*) FROM v))::int,
    (SELECT count(*) FROM d)::int,
    ((SELECT count(*) FROM v) - (SELECT count(*) FROM d))::int;
$$;

CREATE OR REPLACE FUNCTION public.campaign_prepare_recipients(p_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filters jsonb;
  v_count integer;
BEGIN
  SELECT filters INTO v_filters FROM public.whatsapp_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found';
  END IF;

  DELETE FROM public.whatsapp_campaign_recipients WHERE campaign_id = p_campaign_id;

  INSERT INTO public.whatsapp_campaign_recipients
    (campaign_id, order_id, customer_phone, customer_name, variables, status)
  SELECT p_campaign_id, d.order_id, trim(d.customer_phone), d.customer_name,
         jsonb_build_object(
           'customer_name', d.customer_name,
           'order_id', d.order_id,
           'product_name', d.product_name,
           'price', d.total_amount,
           'city', d.customer_city
         ),
         'pending'
  FROM (
    SELECT DISTINCT ON (m.phone_key, lower(trim(coalesce(m.product_name, ''))))
           m.order_id, m.customer_phone, m.customer_name, m.product_name, m.total_amount, m.customer_city
    FROM public.campaign_matching_orders(v_filters) m
    WHERE length(coalesce(m.phone_key, '')) BETWEEN 10 AND 15
    ORDER BY m.phone_key, lower(trim(coalesce(m.product_name, ''))), m.created_at DESC
  ) d;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.whatsapp_campaigns
     SET total_recipients = v_count, sent_count = 0, delivered_count = 0, read_count = 0,
         replied_count = 0, failed_count = 0, last_error = NULL
   WHERE id = p_campaign_id;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------
-- Atomically claims up to p_limit pending recipients. SKIP LOCKED makes concurrent runners
-- (chain + cron backup) safe: no recipient is ever claimed twice.
CREATE OR REPLACE FUNCTION public.campaign_claim_recipients(p_campaign_id uuid, p_limit integer)
RETURNS SETOF public.whatsapp_campaign_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A worker died mid-send. Whether Meta got the message is unknown, so never resend
  -- (a duplicate marketing message is worse than a missed one): mark it failed instead.
  UPDATE public.whatsapp_campaign_recipients
     SET status = 'failed', failed_at = now(), processing_at = NULL,
         error_message = 'Interrupted while sending: outcome unknown, not resent to avoid a duplicate message'
   WHERE campaign_id = p_campaign_id
     AND status = 'processing'
     AND processing_at < now() - interval '5 minutes';

  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.whatsapp_campaign_recipients
    WHERE campaign_id = p_campaign_id AND status = 'pending'
    LIMIT greatest(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whatsapp_campaign_recipients r
     SET status = 'processing', processing_at = now()
    FROM picked
   WHERE r.id = picked.id
  RETURNING r.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_campaign_counters(p_campaign_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.whatsapp_campaigns c
     SET sent_count = s.sent, delivered_count = s.delivered, read_count = s.read_n,
         replied_count = s.replied, failed_count = s.failed
    FROM (
      SELECT
        count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read', 'replied'))::int AS sent,
        count(*) FILTER (WHERE status IN ('delivered', 'read', 'replied'))::int AS delivered,
        count(*) FILTER (WHERE status IN ('read', 'replied'))::int AS read_n,
        count(*) FILTER (WHERE status = 'replied')::int AS replied,
        count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM public.whatsapp_campaign_recipients
      WHERE campaign_id = p_campaign_id
    ) s
   WHERE c.id = p_campaign_id
     AND (c.sent_count, c.delivered_count, c.read_count, c.replied_count, c.failed_count)
         IS DISTINCT FROM (s.sent, s.delivered, s.read_n, s.replied, s.failed);
$$;

-- p_results: [{id, outcome: sent|failed|retry|requeue, to_phone, meta_message_id, error,
--              message_id, body, payload}]. One call per send tick, whatever its size.
--   sent    -> recipient sent + message and conversation logged
--   failed  -> recipient failed + failed message logged
--   retry   -> back to pending (attempts + 1), nothing logged
--   requeue -> back to pending untouched (campaign was paused mid-tick)
-- p_log = false skips the conversation/message log (dry runs).
CREATE OR REPLACE FUNCTION public.campaign_record_results(
  p_campaign_id uuid,
  p_results jsonb,
  p_log boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  DROP TABLE IF EXISTS _camp_res;
  DROP TABLE IF EXISTS _camp_conv;

  CREATE TEMP TABLE _camp_res ON COMMIT DROP AS
  SELECT x.id, x.outcome, x.to_phone, x.meta_message_id, x.error, x.message_id, x.body, x.payload,
         r.customer_name, r.order_id AS r_order_id
  FROM jsonb_to_recordset(p_results) AS x(
    id uuid, outcome text, to_phone text, meta_message_id text, error text,
    message_id uuid, body text, payload jsonb
  )
  JOIN public.whatsapp_campaign_recipients r ON r.id = x.id AND r.campaign_id = p_campaign_id;

  CREATE TEMP TABLE _camp_conv (customer_phone text, id uuid) ON COMMIT DROP;

  IF p_log THEN
    -- Conversations for phones that have none yet.
    INSERT INTO public.whatsapp_conversations (customer_phone, customer_name, order_id, status, last_message_at)
    SELECT DISTINCT ON (t.to_phone)
           t.to_phone, t.customer_name,
           CASE WHEN t.r_order_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations c2 WHERE c2.order_id = t.r_order_id)
                THEN t.r_order_id END,
           CASE WHEN t.outcome = 'sent' THEN 'awaiting_reply' ELSE 'pending' END,
           v_now
    FROM _camp_res t
    WHERE t.outcome IN ('sent', 'failed')
      AND coalesce(t.to_phone, '') <> ''
      AND NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations c WHERE c.customer_phone = t.to_phone)
    ORDER BY t.to_phone, (t.outcome = 'sent') DESC
    ON CONFLICT DO NOTHING;

    -- The conversation each phone resolves to (latest one), as the inbox expects.
    INSERT INTO _camp_conv
    SELECT DISTINCT ON (c.customer_phone) c.customer_phone, c.id
    FROM public.whatsapp_conversations c
    WHERE c.customer_phone IN (SELECT t.to_phone FROM _camp_res t WHERE t.outcome IN ('sent', 'failed'))
    ORDER BY c.customer_phone, c.created_at DESC;

    UPDATE public.whatsapp_conversations c
       SET last_message_at = v_now,
           updated_at = v_now,
           status = CASE WHEN c.status = 'pending' AND p.any_ok THEN 'awaiting_reply' ELSE c.status END,
           order_id = CASE
             WHEN c.order_id IS NULL AND p.cand_order IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations c3 WHERE c3.order_id = p.cand_order)
             THEN p.cand_order ELSE c.order_id END
      FROM _camp_conv cc
      JOIN (
        SELECT t.to_phone,
               bool_or(t.outcome = 'sent') AS any_ok,
               (array_agg(t.r_order_id ORDER BY t.id))[1] AS cand_order
        FROM _camp_res t
        WHERE t.outcome IN ('sent', 'failed')
        GROUP BY t.to_phone
      ) p ON p.to_phone = cc.customer_phone
     WHERE c.id = cc.id;

    INSERT INTO public.whatsapp_messages
      (id, conversation_id, order_id, direction, message_type, body, payload, meta_message_id, status, error_message)
    SELECT t.message_id, cc.id, t.r_order_id, 'out', 'template', t.body,
           coalesce(t.payload, '{}'::jsonb), t.meta_message_id,
           CASE WHEN t.outcome = 'sent' THEN 'sent' ELSE 'failed' END,
           CASE WHEN t.outcome = 'failed' THEN t.error END
    FROM _camp_res t
    JOIN _camp_conv cc ON cc.customer_phone = t.to_phone
    WHERE t.outcome IN ('sent', 'failed') AND t.message_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.whatsapp_campaign_recipients r
     SET status = CASE t.outcome WHEN 'sent' THEN 'sent' WHEN 'failed' THEN 'failed' ELSE 'pending' END,
         sent_at = CASE WHEN t.outcome = 'sent' THEN v_now ELSE r.sent_at END,
         failed_at = CASE WHEN t.outcome = 'failed' THEN v_now ELSE r.failed_at END,
         meta_message_id = CASE WHEN t.outcome = 'sent' THEN t.meta_message_id ELSE r.meta_message_id END,
         message_id = CASE WHEN t.outcome IN ('sent', 'failed') THEN m.id ELSE r.message_id END,
         conversation_id = CASE WHEN t.outcome IN ('sent', 'failed') THEN cc.id ELSE r.conversation_id END,
         error_message = CASE WHEN t.outcome IN ('failed', 'retry') THEN t.error ELSE NULL END,
         attempts = r.attempts + CASE WHEN t.outcome = 'retry' THEN 1 ELSE 0 END,
         processing_at = NULL
    FROM _camp_res t
    LEFT JOIN _camp_conv cc ON cc.customer_phone = t.to_phone
    LEFT JOIN public.whatsapp_messages m ON m.id = t.message_id
   WHERE r.id = t.id;

  PERFORM public.refresh_campaign_counters(p_campaign_id);
END;
$$;

-- Server-side only: the edge function calls these with the service role.
REVOKE ALL ON FUNCTION public.campaign_matching_orders(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.campaign_audience_counts(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.campaign_prepare_recipients(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.campaign_claim_recipients(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.campaign_record_results(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_campaign_counters(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_matching_orders(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.campaign_audience_counts(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.campaign_prepare_recipients(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.campaign_claim_recipients(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.campaign_record_results(uuid, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_counters(uuid) TO service_role;
