-- Create order_follow_ups table
CREATE TABLE public.order_follow_ups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  follow_up_status TEXT NOT NULL DEFAULT 'pending',
  updated_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.order_follow_ups ENABLE ROW LEVEL SECURITY;

-- RLS: Admins full access
CREATE POLICY "Admins full access order_follow_ups"
ON public.order_follow_ups
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- RLS: Agents can view all follow ups
CREATE POLICY "Agents can view order_follow_ups"
ON public.order_follow_ups
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'agent'));

-- RLS: Agents can insert follow ups
CREATE POLICY "Agents can insert order_follow_ups"
ON public.order_follow_ups
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'agent') AND auth.uid() = updated_by);

-- RLS: Agents can update follow ups
CREATE POLICY "Agents can update order_follow_ups"
ON public.order_follow_ups
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'agent'))
WITH CHECK (public.has_role(auth.uid(), 'agent') AND auth.uid() = updated_by);

-- Trigger for updated_at
CREATE TRIGGER update_order_follow_ups_updated_at
BEFORE UPDATE ON public.order_follow_ups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookup by order_id
CREATE INDEX idx_order_follow_ups_order_id ON public.order_follow_ups(order_id);
CREATE INDEX idx_order_follow_ups_status ON public.order_follow_ups(follow_up_status);

-- RPC: Get follow ups data with computed shipped_at from order_history
CREATE OR REPLACE FUNCTION public.get_follow_ups_data()
RETURNS TABLE (
  order_id TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_city TEXT,
  delivery_status TEXT,
  shipping_status TEXT,
  orio_order_id INTEGER,
  orio_consignment_no TEXT,
  shipped_at TIMESTAMP WITH TIME ZONE,
  days_since_shipped INTEGER,
  follow_up_status TEXT,
  follow_up_updated_at TIMESTAMP WITH TIME ZONE,
  follow_up_updated_by UUID,
  order_updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins and agents can access
  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'agent')) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH shipped_events AS (
    SELECT DISTINCT ON (oh.order_id)
      oh.order_id,
      oh.created_at AS shipped_at
    FROM public.order_history oh
    WHERE oh.field_changed = 'delivery_status'
      AND oh.new_value = 'shipped'
    ORDER BY oh.order_id, oh.created_at ASC
  )
  SELECT
    o.order_id,
    o.customer_name,
    o.customer_phone,
    o.customer_city,
    o.delivery_status,
    o.shipping_status,
    o.orio_order_id,
    o.orio_consignment_no,
    COALESCE(se.shipped_at, o.orio_synced_at) AS shipped_at,
    CASE
      WHEN COALESCE(se.shipped_at, o.orio_synced_at) IS NULL THEN NULL
      ELSE EXTRACT(DAY FROM (now() - COALESCE(se.shipped_at, o.orio_synced_at)))::INTEGER
    END AS days_since_shipped,
    COALESCE(fu.follow_up_status, 'pending') AS follow_up_status,
    fu.updated_at AS follow_up_updated_at,
    fu.updated_by AS follow_up_updated_by,
    o.updated_at AS order_updated_at
  FROM public.orders o
  LEFT JOIN shipped_events se ON se.order_id = o.order_id
  LEFT JOIN public.order_follow_ups fu ON fu.order_id = o.order_id
  WHERE o.orio_order_id IS NOT NULL
  ORDER BY o.updated_at DESC;
END;
$$;