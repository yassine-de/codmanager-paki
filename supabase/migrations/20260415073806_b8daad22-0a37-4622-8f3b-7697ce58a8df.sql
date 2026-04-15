
-- Fix Seller Three: display_id ST-03 → SH-03 (matches their order prefix)
UPDATE profiles SET display_id = 'SH-03' WHERE user_id = '340e396d-c1e7-41b1-9214-bdc40236caa4' AND display_id = 'ST-03';
