
-- Create a global sequence for seller display IDs
CREATE SEQUENCE IF NOT EXISTS seller_display_id_seq START WITH 1;

-- Recreate the function with new logic: 2-char initials + global sequence
CREATE OR REPLACE FUNCTION public.generate_seller_display_id(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parts text[];
  v_initials text;
  v_counter integer;
BEGIN
  v_parts := string_to_array(trim(p_name), ' ');
  
  IF array_length(v_parts, 1) >= 2 THEN
    -- First letter of first name + first letter of last name
    v_initials := upper(left(v_parts[1], 1) || left(v_parts[array_length(v_parts, 1)], 1));
  ELSE
    -- Single name: first two letters
    v_initials := upper(left(v_parts[1], 2));
  END IF;
  
  -- Use global sequence
  v_counter := nextval('seller_display_id_seq');
  
  RETURN v_initials || '-' || LPAD(v_counter::text, 2, '0');
END;
$$;

-- Add unique constraint on display_id (drop if exists first)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_id_unique;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_display_id_unique UNIQUE (display_id);

-- Backfill: clear all existing display_ids, then regenerate in creation order
-- First reset the sequence
SELECT setval('seller_display_id_seq', 1, false);

-- Clear existing display_ids for sellers
UPDATE public.profiles SET display_id = NULL
WHERE user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'seller');

-- Backfill in order of creation
DO $$
DECLARE
  r RECORD;
  v_did text;
BEGIN
  FOR r IN
    SELECT p.user_id, p.name
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role = 'seller'
    ORDER BY p.created_at ASC
  LOOP
    v_did := public.generate_seller_display_id(r.name);
    UPDATE public.profiles SET display_id = v_did WHERE user_id = r.user_id;
  END LOOP;
END;
$$;
