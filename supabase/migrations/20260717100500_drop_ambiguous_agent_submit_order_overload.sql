DROP FUNCTION IF EXISTS public.agent_submit_order(
  uuid,
  text,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  integer,
  numeric,
  numeric,
  boolean,
  text,
  integer,
  uuid,
  timestamptz,
  integer,
  date,
  timestamptz,
  text,
  timestamptz,
  text,
  text
);

NOTIFY pgrst, 'reload schema';
