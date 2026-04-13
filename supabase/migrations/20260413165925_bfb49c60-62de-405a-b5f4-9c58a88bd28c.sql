
DO $$
DECLARE
  r RECORD;
  v_did text;
BEGIN
  FOR r IN
    SELECT p.user_id, p.name
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role = 'seller' AND (p.display_id IS NULL OR p.display_id = '')
    ORDER BY p.created_at
  LOOP
    v_did := public.generate_seller_display_id(r.name);
    UPDATE public.profiles SET display_id = v_did WHERE user_id = r.user_id;
  END LOOP;
END;
$$;
