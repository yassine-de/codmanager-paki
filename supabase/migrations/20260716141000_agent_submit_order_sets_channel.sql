CREATE OR REPLACE FUNCTION public.agent_submit_order(
  p_order_id uuid,
  p_confirmation_status text,
  p_agent_id uuid,
  p_assigned_at timestamptz,
  p_last_activity_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_customer_city text,
  p_customer_address text,
  p_product_name text,
  p_quantity integer,
  p_price numeric,
  p_total_amount numeric,
  p_is_manual_price boolean,
  p_note text,
  p_attempt_count integer,
  p_original_agent_id uuid DEFAULT NULL,
  p_last_attempt_at timestamptz DEFAULT NULL,
  p_attempts_today integer DEFAULT NULL,
  p_last_attempt_date date DEFAULT NULL,
  p_postpone_date timestamptz DEFAULT NULL,
  p_postpone_note text DEFAULT NULL,
  p_confirmed_at timestamptz DEFAULT NULL,
  p_delivery_status text DEFAULT NULL,
  p_cancel_reason text DEFAULT NULL,
  p_confirmation_channel text DEFAULT NULL
)
RETURNS SETOF public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.orders
  SET confirmation_status = p_confirmation_status,
      confirmation_channel = COALESCE(p_confirmation_channel, confirmation_channel),
      agent_id = p_agent_id,
      assigned_at = p_assigned_at,
      last_activity_at = p_last_activity_at,
      customer_name = p_customer_name,
      customer_phone = p_customer_phone,
      customer_city = p_customer_city,
      customer_address = p_customer_address,
      product_name = p_product_name,
      quantity = p_quantity,
      price = p_price,
      total_amount = p_total_amount,
      is_manual_price = p_is_manual_price,
      note = p_note,
      attempt_count = p_attempt_count,
      original_agent_id = COALESCE(p_original_agent_id, original_agent_id),
      last_attempt_at = COALESCE(p_last_attempt_at, last_attempt_at),
      attempts_today = COALESCE(p_attempts_today, attempts_today),
      last_attempt_date = COALESCE(p_last_attempt_date, last_attempt_date),
      postpone_date = COALESCE(p_postpone_date, postpone_date),
      postpone_note = COALESCE(p_postpone_note, postpone_note),
      confirmed_at = COALESCE(p_confirmed_at, confirmed_at),
      delivery_status = COALESCE(p_delivery_status, delivery_status),
      cancel_reason = COALESCE(p_cancel_reason, cancel_reason),
      updated_at = now()
  WHERE id = p_order_id
    AND (agent_id = auth.uid() OR public.is_staff(auth.uid()))
  RETURNING *;
END;
$$;

UPDATE public.orders o
SET confirmation_channel = 'agent',
    updated_at = now()
WHERE o.order_id = 'AB-8'
  AND o.confirmation_status = 'confirmed'
  AND EXISTS (
    SELECT 1
    FROM public.order_history oh
    WHERE oh.order_id = o.order_id
      AND oh.field_changed = 'confirmation_status'
      AND oh.new_value = 'confirmed'
      AND oh.changed_by_role = 'agent'
  );

NOTIFY pgrst, 'reload schema';
