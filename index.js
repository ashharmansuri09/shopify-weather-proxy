require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const app = express();
const OWM_KEY = process.env.OPENWEATHER_API_KEY;
const SHOPIFY_SECRET = process.env.SHOPIFY_API_SECRET;

// ---- Shopify signature verify ----
function verifyProxy(query) {
  const { signature, ...rest } = query;
  if (!signature || !SHOPIFY_SECRET) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
    .join("");
  const digest = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(message)
    .digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- Chhota cache (10 min). Vercel pe kabhi kabhi reset hoga, koi dikkat nahi ----
const cache = new Map();
const TTL = 10 * 60 * 1000;

app.get("/", (req, res) => res.send("Weather proxy running"));

// Shopify yahan bhejega: /proxy/current?city=Bhopal
app.get("/proxy/current", async (req, res) => {
  if (!verifyProxy(req.query)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const city = String(req.query.city || "Bhopal").trim().slice(0, 60);
  const key = city.toLowerCase();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < TTL) return res.json(hit.data);

  try {
    const url =
      `https://api.openweathermap.org/data/2.5/weather` +
      `?q=${encodeURIComponent(city)}&units=metric&appid=${OWM_KEY}`;
    const r = await fetch(url);
    const d = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: d.message || "City not found" });
    }

    const data = {
      city: d.name,
      country: d.sys.country,
      temp: Math.round(d.main.temp),
      feels_like: Math.round(d.main.feels_like),
      humidity: d.main.humidity,
      description: d.weather[0].description,
      icon: `https://openweathermap.org/img/wn/${d.weather[0].icon}@2x.png`,
    };

    cache.set(key, { time: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// Local pe chalega, Vercel pe nahi (wahan app export hota hai)
if (require.main === module) {
  app.listen(process.env.PORT || 3000, () => console.log("Running"));
}

module.exports = app;