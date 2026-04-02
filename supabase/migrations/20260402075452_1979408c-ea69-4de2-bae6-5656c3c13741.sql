
CREATE SEQUENCE IF NOT EXISTS public.order_system_id_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE public.orders ADD COLUMN system_id integer UNIQUE DEFAULT nextval('public.order_system_id_seq');
