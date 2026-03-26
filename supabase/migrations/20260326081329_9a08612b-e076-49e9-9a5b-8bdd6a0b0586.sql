
-- Add product_weight to sourcing_requests
ALTER TABLE sourcing_requests ADD COLUMN product_weight text DEFAULT NULL;

-- Add rate for more than 3kg to seller_rates
ALTER TABLE seller_rates ADD COLUMN rate_3kg_plus numeric NOT NULL DEFAULT 6;

-- Update default rates for existing rows
UPDATE seller_rates SET rate_3kg_plus = 6 WHERE rate_3kg_plus = 6;

-- Set sensible defaults for rate columns
ALTER TABLE seller_rates ALTER COLUMN rate_1kg SET DEFAULT 3;
ALTER TABLE seller_rates ALTER COLUMN rate_2kg SET DEFAULT 4;
ALTER TABLE seller_rates ALTER COLUMN rate_3kg SET DEFAULT 5;
