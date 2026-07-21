DO $$
DECLARE
  v_match_count integer;
  v_deleted_count integer;
BEGIN
  SELECT count(*)
  INTO v_match_count
  FROM public.products
  WHERE (id = '60e875c6-0842-4a1d-95c2-a6eaa1fc4002'::uuid AND name = 'G7 Watch')
     OR (id = '6c74c39a-aec3-4d4d-af22-0e71551711c5'::uuid AND name = 'Telescope')
     OR (id = '9ca2e9f5-011f-4c4b-99bb-0b824cf2eb88'::uuid AND name = 'Cable Type C')
     OR (id = '5368602b-9285-43d7-947b-b8ee935b90b9'::uuid AND name = 'Men’s Watch')
     OR (id = '28611ba4-b0d3-4de3-9a5a-02ae1fc6eb6e'::uuid AND name = 'Portable Waterproof Metal & Gold Detector');

  IF v_match_count <> 5 THEN
    RAISE EXCEPTION 'Expected 5 exact legacy products, found %; no products were deleted', v_match_count;
  END IF;

  DELETE FROM public.products
  WHERE (id = '60e875c6-0842-4a1d-95c2-a6eaa1fc4002'::uuid AND name = 'G7 Watch')
     OR (id = '6c74c39a-aec3-4d4d-af22-0e71551711c5'::uuid AND name = 'Telescope')
     OR (id = '9ca2e9f5-011f-4c4b-99bb-0b824cf2eb88'::uuid AND name = 'Cable Type C')
     OR (id = '5368602b-9285-43d7-947b-b8ee935b90b9'::uuid AND name = 'Men’s Watch')
     OR (id = '28611ba4-b0d3-4de3-9a5a-02ae1fc6eb6e'::uuid AND name = 'Portable Waterproof Metal & Gold Detector');

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  IF v_deleted_count <> 5 THEN
    RAISE EXCEPTION 'Expected to delete 5 legacy products, deleted %', v_deleted_count;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
