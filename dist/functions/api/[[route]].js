export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. FETCH USER PROFILE DATA
    if (path.startsWith("/api/user/") && method === "GET") {
      const cardUid = path.split("/").pop();
      
      let user = await env.DB.prepare("SELECT * FROM users WHERE card_uid = ?").bind(cardUid).first();
      if (!user) {
        // Create a free account baseline if the card key is new
        await env.DB.prepare("INSERT INTO users (card_uid, balance, debt, interest_rate) VALUES (?, 1000.0, 500.0, 0.05)").bind(cardUid).run();
        user = await env.DB.prepare("SELECT * FROM users WHERE card_uid = ?").bind(cardUid).first();
      }

      const holdings = await env.DB.prepare(
        "SELECT us.symbol, s.name, us.shares, s.current_price FROM user_stocks us JOIN stocks s ON us.symbol = s.symbol WHERE us.card_uid = ?"
      ).bind(cardUid).all();

      return new Response(JSON.stringify({ user, holdings: holdings.results }), { headers: corsHeaders });
    }

    // 2. UPDATE USER INTEREST RATE (Dynamic Preference)
    if (path === "/api/update-interest" && method === "POST") {
      const { card_uid, interest_rate } = await request.json();
      await env.DB.prepare("UPDATE users SET interest_rate = ? WHERE card_uid = ?")
        .bind(parseFloat(interest_rate), card_uid)
        .run();
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // 3. MANUAL OVERRIDE / DEBT FORGIVENESS PORTAL
    if (path === "/api/override-debt" && method === "POST") {
      const { card_uid, target_debt } = await request.json();
      // Instantly rewrite the database field target value without interacting with the physical key
      await env.DB.prepare("UPDATE users SET debt = ? WHERE card_uid = ?")
        .bind(parseFloat(target_debt), card_uid)
        .run();
      return new Response(JSON.stringify({ success: true, message: "Account balancing modification applied." }), { headers: corsHeaders });
    }

    // 4. MARKET FEED OVERVIEW
    if (path === "/api/stocks" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM stocks ORDER BY symbol ASC").all();
      return new Response(JSON.stringify(results), { headers: corsHeaders });
    }

    // 5. SIMULATE DAY CYCLING (Interest Accrual + Stock Market Shift)
    if (path === "/api/simulate-day" && method === "POST") {
      // Accrue compound interest on current unpaid debt balances using each account's set rate
      await env.DB.prepare(`
        UPDATE users 
        SET debt = debt + (debt * (interest_rate / 365.0))
        WHERE debt > 0
      `).run();

      // Execute simulated random walk adjustments across the equity assets table
      const { results: stocks } = await env.DB.prepare("SELECT * FROM stocks").all();
      for (const stock of stocks) {
        const changePercent = (Math.random() - 0.48) * 2; 
        let newPrice = stock.current_price * (1 + (changePercent * stock.volatility));
        if (newPrice < 0.01) newPrice = 0.01;

        await env.DB.prepare("UPDATE stocks SET current_price = ? WHERE symbol = ?")
          .bind(newPrice, stock.symbol)
          .run();
      }

      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Route not matching backend parameters." }), { status: 404, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}