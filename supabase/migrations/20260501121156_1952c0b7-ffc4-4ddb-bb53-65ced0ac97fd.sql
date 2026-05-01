UPDATE public.products
SET ai_context = REPLACE(REPLACE(ai_context, 'striking blue dial', 'striking black dial'), 'blue dial', 'black dial'),
    updated_at = now()
WHERE id = '5368602b-9285-43d7-947b-b8ee935b90b9';