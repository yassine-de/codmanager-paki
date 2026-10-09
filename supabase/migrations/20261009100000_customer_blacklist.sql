-- Customer blacklist (global, across all sellers, keyed by normalize_phone_key).
-- Auto-blacklisting is computed live in get_customer_blacklist_status (>= 2 returned
-- orders and 0 delivered), so it never goes stale and needs no cron. Rows here are
-- manual decisions only: 'blacklisted' = added by hand, 'cleared' = manual override
-- that keeps a customer off the auto list.
CREATE TABLE IF NOT EXISTS public.customer_blacklist (
  phone_key text PRIMARY KEY,
  phone_display text,
  status text NOT NULL CHECK (status IN ('blacklisted', 'cleared')),
  reason text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_blacklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read customer blacklist" ON public.customer_blacklist;
CREATE POLICY "Staff read customer blacklist"
  ON public.customer_blacklist FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR NOT public.has_role(auth.uid(), 'seller'));
-- No write policies: all writes go through set_customer_blacklist().

CREATE OR REPLACE FUNCTION public.get_customer_blacklist_status(p_phones text[])
RETURNS TABLE (
  input_phone text,
  phone_key text,
  is_blacklisted boolean,
  source text,
  returned_count integer,
  delivered_count integer,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  -- Sellers must not see other sellers' customers' return history.
  IF auth.uid() IS NULL OR (public.has_role(auth.uid(), 'seller') AND NOT public.is_admin(auth.uid())) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH inp AS (
    SELECT DISTINCT p AS input_phone, public.normalize_phone_key(p) AS phone_key
    FROM unnest(p_phones) AS p
    WHERE p IS NOT NULL AND coalesce(public.normalize_phone_key(p), '') <> ''
  ),
  stats AS (
    SELECT
      o.customer_phone_normalized AS phone_key,
      count(*) FILTER (WHERE o.delivery_status IN ('return', 'returned', 'ready_for_return', 'return_received'))::int AS returned_count,
      count(*) FILTER (WHERE o.delivery_status IN ('delivered', 'paid'))::int AS delivered_count
    FROM public.orders o
    WHERE o.customer_phone_normalized IN (SELECT i.phone_key FROM inp i)
    GROUP BY o.customer_phone_normalized
  )
  SELECT
    i.input_phone,
    i.phone_key,
    CASE
      WHEN b.status = 'blacklisted' THEN true
      WHEN b.status = 'cleared' THEN false
      ELSE coalesce(s.returned_count, 0) >= 2 AND coalesce(s.delivered_count, 0) = 0
    END,
    CASE
      WHEN b.status = 'blacklisted' THEN 'manual'
      WHEN b.status = 'cleared' THEN 'cleared'
      WHEN coalesce(s.returned_count, 0) >= 2 AND coalesce(s.delivered_count, 0) = 0 THEN 'auto'
      ELSE NULL
    END,
    coalesce(s.returned_count, 0),
    coalesce(s.delivered_count, 0),
    b.reason
  FROM inp i
  LEFT JOIN stats s ON s.phone_key = i.phone_key
  LEFT JOIN public.customer_blacklist b ON b.phone_key = i.phone_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_customer_blacklist(p_phone text, p_blacklisted boolean, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := public.normalize_phone_key(p_phone);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF coalesce(v_key, '') = '' THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  IF p_blacklisted THEN
    IF NOT (
      public.is_admin(v_uid)
      OR public.has_role(v_uid, 'general_manager')
      OR public.has_role(v_uid, 'agent')
      OR public.has_role(v_uid, 'follow_up')
      OR public.has_role(v_uid, 'whatsapp_manager')
    ) THEN
      RAISE EXCEPTION 'Not allowed to blacklist customers';
    END IF;
  ELSE
    IF NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'general_manager')) THEN
      RAISE EXCEPTION 'Only admins can remove a customer from the blacklist';
    END IF;
  END IF;

  INSERT INTO public.customer_blacklist (phone_key, phone_display, status, reason, updated_by, updated_at)
  VALUES (
    v_key,
    p_phone,
    CASE WHEN p_blacklisted THEN 'blacklisted' ELSE 'cleared' END,
    nullif(trim(coalesce(p_reason, '')), ''),
    v_uid,
    now()
  )
  ON CONFLICT (phone_key) DO UPDATE SET
    phone_display = EXCLUDED.phone_display,
    status = EXCLUDED.status,
    reason = EXCLUDED.reason,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_blacklist_status(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_customer_blacklist(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_blacklist_status(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_blacklist(text, boolean, text) TO authenticated;
