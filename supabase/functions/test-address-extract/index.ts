// Temporary diagnostic — extract address using same prompt as whatsapp-webhook
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return new Response("no key", { status: 500, headers: corsHeaders });

  const extractPrompt = `You are an address-extraction assistant for a courier in Pakistan. Pakistan has BIG cities (Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad, Multan, Peshawar, etc.) AND many SMALL towns / villages / tehsils (Batagram, Layyah, Tank, Wari, Shahdad Kot, Dera Ismail Khan, etc.). Address quality expectations are different for each.

A "deliverable" address requires:
1) A city OR town OR tehsil OR village name (anywhere in Pakistan), AND
2) AT LEAST ONE locator that helps the rider find the spot. Any ONE of these is enough:
   - a house / flat / plot / shop / office number, OR
   - a specific street / lane / road / gali name or number (e.g. "Ajmera Road", "Street 4", "Main Bazaar Road"), OR
   - a neighborhood / area / colony / block / sector / phase / mohalla / town name (e.g. "Gulshan-e-Iqbal Block 7", "DHA Phase 5", "Saddar", "G-9/4", "Johar Town"), OR
   - a recognizable named landmark with proximity wording (e.g. "near Allahdin Hotel", "near Adalat Stop", "Fuara Chowk", "near UBL Bank Zarobi", "opposite XYZ Masjid"). Small-town landmarks like a chowk, a named stop, a small bank branch, or a small hotel ARE enough — the rider knows the town and can ask locally.

Only REJECT when the address gives the rider NOTHING to go on:
- Just a city name with no other detail (e.g. "Lahore" alone).
- Single vague words: "home", "here", "same", "send it".
- Obvious fake / test / placeholder values: "test", "fake", "dummy", "sample", "abc", "xyz", "n/a", "asdf", random keyboard mashing.
- A standalone giant institution with no street/area context AND no proximity wording (e.g. just "CM Secretariat" with nothing else).

In big metro cities (Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad, Multan, Peshawar, Hyderabad, Quetta, Gujranwala, Sialkot) prefer at least an area/block/sector/town in addition to the locator when possible — but if the customer gave a clear shop/street + landmark + city, accept it.

In small towns / villages / tehsils, a road / chowk / named landmark + the town name IS enough. Do NOT demand a formal block/sector/phase that does not exist there.

Return JSON ONLY in this exact schema:
{ "complete": boolean, "full_address": string, "city": string }

Rules:
- "complete" = true if the address has a city/town + at least one usable locator from the list above. When in doubt for SMALL towns, lean toward true. When in doubt for BIG metros with no area at all, lean toward false.
- "full_address" must be a single line containing all the detail parts the customer provided (house/flat, street, block/sector/phase, area, landmark) — DO NOT include the city.
- "city" must be the city/town/village name in English/Latin script (e.g. "Karachi", "Lahore", "Peshawar", "Batagram", "Layyah").
- For obvious fake/test/placeholder values or single vague words, return complete=false.
- DO NOT invent details. Only use what the customer explicitly said anywhere in the conversation (history + latest message).`;

  const tests = [
    "ajmera road near adalt stop batagram road batagram\nplz deliver",
    "ajmera road near adalt stop batagram road batagram",
    "Fuara chok\nDera Ismail Khan",
    "Near Allahdin Hotel\nLayyah",
    "Wari dir upper",
    "Lahore", // should reject
    "test", // should reject
    "home", // should reject
    "Shop no 6 near sheritolln hotel johar town lahore",
    "House 12, Street 5, DHA Phase 5, Karachi",
  ];

  const results: any[] = [];
  for (const customerText of tests) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: extractPrompt },
          { role: "assistant", content: "Please share your full delivery address." },
          { role: "user", content: customerText },
        ],
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
    });
    const j = await r.json();
    results.push({ input: customerText, output: j.choices?.[0]?.message?.content });
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
