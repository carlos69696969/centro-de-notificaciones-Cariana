const crypto = require("crypto");
require("dotenv").config();

async function run() {
  const secret = process.env.SHOPIFY_API_SECRET;
  const shopDomain = process.env.TEST_SHOP_DOMAIN || "centro-de-notificaciones-ok0wd8y8.myshopify.com";
  const topic = process.env.TEST_TOPIC || "orders/create";
  const endpoint = process.env.TEST_WEBHOOK_URL || "http://localhost:3000/webhooks/shopify";

  if (!secret) {
    throw new Error("Missing SHOPIFY_API_SECRET in environment");
  }

  const payload = {
    id: 1000001,
    order_number: 2001,
    fulfillment_status: null,
    cancelled_at: null,
    customer: {
      id: 555001122,
      email: "cliente@example.com",
      first_name: "Ana",
      last_name: "Cliente"
    }
  };

  const raw = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", secret).update(raw).digest("base64");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shopDomain,
      "x-shopify-webhook-id": `test-${Date.now()}`
    },
    body: raw
  });

  const text = await response.text();
  console.log("Status:", response.status);
  console.log("Body:", text);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
