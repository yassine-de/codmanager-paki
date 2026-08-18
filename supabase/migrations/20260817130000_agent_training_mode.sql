-- Confirmation-agent "training mode": when enabled for an agent, they can
-- only claim no_answer (retry) orders — never new/duplicate/postponed —
-- until an admin turns it back off. Fully additive: no existing agent has
-- a row here yet, so nothing changes for anyone until an admin explicitly
-- flips a specific agent's toggle on.
CREATE TABLE IF NOT EXISTS public.agent_settings (
  agent_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  training_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manage agent_settings"
ON public.agent_settings FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "agent read own agent_settings"
ON public.agent_settings FOR SELECT TO authenticated
USING (agent_id = auth.uid());

-- claim_next_order: add a training-mode guard to the new/duplicate/postponed
-- branches only. The no_answer branch is completely untouched below — zero
-- risk to the retry-claiming path any agent (including training-mode ones)
-- already relies on. Everything else in the function body is identical to
-- the version already live.
CREATE OR REPLACE FUNCTION public.claim_next_order(p_agent_id uuid, p_order_type text DEFAULT 'new'::text, p_product_names text[] DEFAULT NULL::text[])
 RETURNS SETOF orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.release_expired_order_locks();

  IF p_order_type = 'new' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM public.orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
        AND NOT EXISTS (
          SELECT 1 FROM public.agent_settings ags
          WHERE ags.agent_id = p_agent_id AND ags.training_mode = true
        )
      ORDER BY o.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE public.orders o2
      SET agent_id = p_agent_id,
          assigned_at = now(),
          last_activity_at = now(),
          updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*
    ), logged AS (
      INSERT INTO public.order_history (
        order_id, changed_by, changed_by_role, field_changed,
        old_value, new_value, action_type
      )
      SELECT order_id, p_agent_id, 'agent', 'agent_lock',
             NULL, p_agent_id::text, 'order_claimed'
      FROM claimed
      RETURNING 1
    )
    SELECT claimed.* FROM claimed;

  ELSIF p_order_type = 'no_answer' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM public.orders o
      WHERE o.confirmation_status = 'no_answer'
        AND o.agent_id IS NULL
        AND o.attempt_count < 12
        AND (o.last_attempt_at IS NULL OR o.last_attempt_at <= now() - interval '30 minutes')
        AND (
          o.last_attempt_date IS DISTINCT FROM CURRENT_DATE
          OR o.attempts_today < 4
        )
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.last_attempt_at ASC NULLS FIRST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE public.orders o2
      SET agent_id = p_agent_id,
          assigned_at = now(),
          last_activity_at = now(),
          updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*
    ), logged AS (
      INSERT INTO public.order_history (
        order_id, changed_by, changed_by_role, field_changed,
        old_value, new_value, action_type
      )
      SELECT order_id, p_agent_id, 'agent', 'agent_lock',
             NULL, p_agent_id::text, 'order_claimed'
      FROM claimed
      RETURNING 1
    )
    SELECT claimed.* FROM claimed;

  ELSIF p_order_type = 'postponed' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM public.orders o
      WHERE o.confirmation_status = 'postponed'
        AND o.agent_id IS NULL
        AND o.postpone_date <= now()
        AND o.original_agent_id = p_agent_id
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
        AND NOT EXISTS (
          SELECT 1 FROM public.agent_settings ags
          WHERE ags.agent_id = p_agent_id AND ags.training_mode = true
        )
      ORDER BY o.postpone_date ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE public.orders o2
      SET agent_id = p_agent_id,
          assigned_at = now(),
          last_activity_at = now(),
          updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*
    ), logged AS (
      INSERT INTO public.order_history (
        order_id, changed_by, changed_by_role, field_changed,
        old_value, new_value, action_type
      )
      SELECT order_id, p_agent_id, 'agent', 'agent_lock',
             NULL, p_agent_id::text, 'order_claimed'
      FROM claimed
      RETURNING 1
    )
    SELECT claimed.* FROM claimed;

    IF NOT FOUND THEN
      RETURN QUERY
      WITH picked AS (
        SELECT o.id
        FROM public.orders o
        WHERE o.confirmation_status = 'postponed'
          AND o.agent_id IS NULL
          AND o.postpone_date <= now()
          AND o.original_agent_id IS DISTINCT FROM p_agent_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.user_presence up
            WHERE up.user_id = o.original_agent_id
              AND up.is_active = true
              AND up.last_seen > now() - interval '10 minutes'
          )
          AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
          AND NOT EXISTS (
            SELECT 1 FROM public.agent_settings ags
            WHERE ags.agent_id = p_agent_id AND ags.training_mode = true
          )
        ORDER BY o.postpone_date ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE public.orders o2
        SET agent_id = p_agent_id,
            assigned_at = now(),
            last_activity_at = now(),
            updated_at = now()
        FROM picked
        WHERE o2.id = picked.id
        RETURNING o2.*
      ), logged AS (
        INSERT INTO public.order_history (
          order_id, changed_by, changed_by_role, field_changed,
          old_value, new_value, action_type
        )
        SELECT order_id, p_agent_id, 'agent', 'agent_lock',
               NULL, p_agent_id::text, 'order_claimed'
        FROM claimed
        RETURNING 1
      )
      SELECT claimed.* FROM claimed;
    END IF;

  ELSIF p_order_type = 'duplicate' THEN
    RETURN QUERY
    WITH first_dup AS (
      SELECT public.normalize_phone_key(o.customer_phone) AS phone_key, o.product_name
      FROM public.orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      GROUP BY public.normalize_phone_key(o.customer_phone), o.product_name
      HAVING COUNT(*) > 1
      LIMIT 1
    ), picked AS (
      SELECT o.id
      FROM public.orders o
      INNER JOIN first_dup fd
        ON public.normalize_phone_key(o.customer_phone) = fd.phone_key
       AND o.product_name = fd.product_name
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.agent_settings ags
          WHERE ags.agent_id = p_agent_id AND ags.training_mode = true
        )
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE public.orders o2
      SET agent_id = p_agent_id,
          assigned_at = now(),
          last_activity_at = now(),
          updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*
    ), logged AS (
      INSERT INTO public.order_history (
        order_id, changed_by, changed_by_role, field_changed,
        old_value, new_value, action_type
      )
      SELECT order_id, p_agent_id, 'agent', 'agent_lock',
             NULL, p_agent_id::text, 'order_claimed'
      FROM claimed
      RETURNING 1
    )
    SELECT claimed.* FROM claimed;
  END IF;
END;
$function$;
