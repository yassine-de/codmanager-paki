UPDATE public.whatsapp_ai_settings
SET system_prompt = REPLACE(
  system_prompt,
  E'## 🛍️ STEP 3 — ORDER CONFIRMATION\n\nOnce address is confirmed:\n1. Summarize order in 2-3 lines: product, quantity, total price (PKR), delivery address\n2. Ask for final confirmation: "Shall we ship your order? ✅"\n3. On YES → thank the customer and confirm dispatch.',
  E'## 🛍️ STEP 3 — ORDER CONFIRMATION (FINALIZE IMMEDIATELY)\n\nOnce the address is confirmed by the customer (YES / haan / sahi / ok / ✅ / new address given):\n\n⛔ DO NOT ask "Shall we ship your order?" or any second confirmation question.\n✅ Treat the order as CONFIRMED right away and send ONE short closing message that:\n  1. Thanks the customer\n  2. Confirms the order will be shipped\n  3. Asks them to keep their phone available — the courier will call when arriving at the address\n\nExamples:\n- English: "Thank you 🙏 Your order is confirmed and will be shipped. Please keep your phone available — the courier will call you when he reaches your address 📦📞"\n- Urdu / Roman Urdu: "Shukriya 🙏 Aap ka order confirm ho gaya hai, ship kar diya jayega. Phone available rakhein — courier address par pohanch kar aap ko call karega 📦📞"\n\nNever ask a follow-up confirmation after the address is confirmed.'
),
updated_at = now()
WHERE system_prompt LIKE '%Shall we ship your order%';