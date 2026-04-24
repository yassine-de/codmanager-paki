import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all sellers
    const { data: sellers } = await supabase
      .from("profiles")
      .select("user_id, name")
      .in("user_id", (await supabase.from("user_roles").select("user_id").eq("role", "seller")).data?.map(r => r.user_id) || []);

    // Get all agents
    const { data: agents } = await supabase
      .from("profiles")
      .select("user_id, name")
      .in("user_id", (await supabase.from("user_roles").select("user_id").eq("role", "agent")).data?.map(r => r.user_id) || []);

    if (!sellers?.length || !agents?.length) {
      return new Response(JSON.stringify({ error: "No sellers or agents found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cities = ["Casablanca", "Rabat", "Marrakech", "Fès", "Tanger", "Agadir", "Meknès", "Oujda", "Kénitra", "Tétouan"];
    const confirmationStatuses = ["new", "confirmed", "no_answer", "postponed", "cancelled", "wrong_number", "double"];
    const deliveryStatuses = ["pending", "shipped", "in_transit", "with_courier", "delivered", "returned", "cancelled", "no_answer", "postponed"];
    const productNames = [
      "Crème Anti-Rides Premium", "Sérum Vitamine C", "Huile d'Argan Bio",
      "Masque Charbon Actif", "Crème Solaire SPF50"
    ];

    const results: string[] = [];

    // 1. Create 5 test products (as sourcing_requests with status 'completed')
    // Products don't have a dedicated table, they come from orders. We'll use them in orders.

    // 2. Create 3 sourcing requests per seller
    for (const seller of sellers) {
      const sourcingRequests = [
        { product_name: "Nouveau Sérum Collagène", product_url: "https://example.com/serum-collagene", quantity: 100, seller_id: seller.user_id, destination_country: "Morocco", shipping_method: "air", status: "waiting_quote", notes: "Urgent - besoin avant fin du mois" },
        { product_name: "Pack Vitamines Cheveux", product_url: "https://example.com/vitamines", quantity: 200, seller_id: seller.user_id, destination_country: "Morocco", shipping_method: "sea", status: "quoted", unit_price: 25, total_price: 5000, shipping_cost: 500, notes: "En attente de validation" },
        { product_name: "Crème Hydratante Aloe", product_url: "https://example.com/creme-aloe", quantity: 150, seller_id: seller.user_id, destination_country: "Morocco", shipping_method: "air", status: "validated", unit_price: 18, total_price: 2700, shipping_cost: 300, seller_validated: true },
      ];

      const { error: srcErr } = await supabase.from("sourcing_requests").insert(sourcingRequests);
      if (srcErr) results.push(`Sourcing error for ${seller.name}: ${srcErr.message}`);
      else results.push(`3 sourcing requests for ${seller.name}`);
    }

    // 3. Create 30 orders per seller
    for (const seller of sellers) {
      const orders = [];
      for (let i = 0; i < 30; i++) {
        // Generate order_id using the function
        const { data: orderId, error: idErr } = await supabase.rpc("generate_order_id", { p_seller_id: seller.user_id });
        if (idErr) {
          results.push(`Order ID error: ${idErr.message}`);
          continue;
        }

        const confStatus = confirmationStatuses[Math.floor(Math.random() * confirmationStatuses.length)];
        const isConfirmed = confStatus === "confirmed";
        const delStatus = isConfirmed ? deliveryStatuses[Math.floor(Math.random() * deliveryStatuses.length)] : "pending";
        const agent = agents[Math.floor(Math.random() * agents.length)];
        const product = productNames[Math.floor(Math.random() * productNames.length)];
        const city = cities[Math.floor(Math.random() * cities.length)];
        const price = Math.floor(Math.random() * 400) + 100;
        const quantity = Math.floor(Math.random() * 3) + 1;
        const shippingCost = Math.floor(Math.random() * 30) + 20;
        const daysAgo = Math.floor(Math.random() * 30);
        const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();

        orders.push({
          order_id: orderId,
          seller_id: seller.user_id,
          agent_id: isConfirmed ? agent.user_id : null,
          customer_name: `Client ${i + 1} ${seller.name.split(" ")[0]}`,
          customer_phone: `06${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`,
          customer_city: city,
          customer_address: `${Math.floor(Math.random() * 200) + 1} Rue ${city}`,
          product_name: product,
          product_url: `https://example.com/products/${product.toLowerCase().replace(/\s/g, "-")}`,
          video_url: i % 3 === 0 ? `https://example.com/video/${i}` : "",
          store_url: `https://store.example.com/${seller.name.toLowerCase().replace(/\s/g, "-")}`,
          price,
          quantity,
          shipping_cost: shippingCost,
          total_amount: price * quantity + shippingCost,
          confirmation_status: confStatus,
          delivery_status: delStatus,
          offers: i % 4 === 0 ? "2x1 Promo" : "",
          last_price: i % 5 === 0 ? Math.floor(price * 0.8) : null,
          note: i % 3 === 0 ? "Client régulier" : "",
          attempt_count: confStatus === "no_answer" ? Math.floor(Math.random() * 5) + 1 : confStatus === "confirmed" ? 1 : 0,
          fragile: i % 6 === 0,
          created_at: createdAt,
          confirmed_at: isConfirmed ? new Date(new Date(createdAt).getTime() + 3600000).toISOString() : null,
          delivered_at: delStatus === "delivered" ? new Date(new Date(createdAt).getTime() + 3 * 86400000).toISOString() : null,
          postpone_date: confStatus === "postponed" ? new Date(Date.now() + 2 * 86400000).toISOString() : null,
        });
      }

      const { error: ordErr } = await supabase.from("orders").insert(orders);
      if (ordErr) results.push(`Orders error for ${seller.name}: ${ordErr.message}`);
      else results.push(`30 orders for ${seller.name}`);
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
