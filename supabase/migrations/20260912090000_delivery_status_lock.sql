-- Lets a manual delivery_status correction (see AB-2734: courier tracking
-- carried two contradictory events, "Delivered" then "Re-Attempt Advice" 1.5
-- minutes apart, and the automated sync kept re-applying the courier's
-- current side of that contradiction) survive future carrier-status-sync
-- runs instead of being silently overwritten on the next poll.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_status_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.orders.delivery_status_locked IS
  'When true, carrier-status-sync and mnp-carrier-status-sync skip updating this order''s delivery_status (shipment tracking fields still sync for reference). Set manually after verifying the real status with the courier when their tracking data is stale or self-contradictory.';
