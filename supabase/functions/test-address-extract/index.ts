// Temporary diagnostic — extract address using same prompt as whatsapp-webhook
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return new Response("no key", { status: 500, headers: corsHeaders });

  const extractPrompt = `You are a STRICT address-extraction assistant for a courier in Pakistan. Your job is to REJECT any address that a courier rider could not realistically deliver to without calling the customer back.

A "deliverable" address requires ALL of the following:
1) A city (a real Pakistan city), AND
2) A specific area / neighborhood / town / colony / block / sector / phase (e.g. "Gulshan-e-Iqbal Block 7", "DHA Phase 5", "Saddar", "G-9/4"), AND
3) At least ONE precise locator INSIDE that area:
   - a house / flat / plot / shop / office number, OR
   - a specific street / lane / road / gali name or number, OR
   - a very specific named landmark that uniquely identifies a small spot WITHIN the area (e.g. "near XYZ Masjid, Street 4" — NOT just a huge government building or a whole institution name).

A government building, big institution, big plaza, university, or any large landmark BY ITSELF is NOT enough — the courier still wouldn't know which gate/block/street. In that case set complete=false and the agent will ask for more detail.

Return JSON ONLY in this exact schema:
{ "complete": boolean, "full_address": string, "city": string }

Rules:
- "complete" = true ONLY if ALL three requirements above (city + specific area + precise locator inside that area) are clearly present in what the CUSTOMER explicitly said. When in doubt, return false.
- "full_address" must be a single line containing all the detail parts the customer provided (house/flat, street, block/sector/phase, area, landmark) — DO NOT include the city.
- "city" must be the city name in English/Latin script (e.g. "Karachi", "Lahore", "Peshawar").
- REJECT obvious fake / test / placeholder values such as "test address", "fake", "dummy", "sample", "abc", "xyz", "n/a", "asdf", random keyboard mashing, or a single word. For these, return complete=false.
- REJECT vague answers like just "my home", "same as before", "here", "send it", a city name only, or a single landmark with no street/house/block.
- If the address is missing, vague, fake, or not detailed enough, return { "complete": false, "full_address": "", "city": "" }.
- DO NOT invent details. Only use what the customer explicitly said.`;

  const tests = [
    "ajmera road near adalt stop batagram road batagram\nplz deliver",
    "ajmera road near adalt stop batagram road batagram",
    "Fuara chok\nDera Ismail Khan",
    "Near Allahdin Hotel\nLayyah",
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
