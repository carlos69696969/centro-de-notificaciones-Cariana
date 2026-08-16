const pool = require("../db/pool");

async function getShopAccessToken(shopDomain) {
  const result = await pool.query(
    `
    SELECT access_token
    FROM shops
    WHERE shop_domain = $1
    LIMIT 1
    `,
    [shopDomain]
  );

  const token = result.rows[0]?.access_token;
  if (!token) {
    throw new Error(`No access token found for shop ${shopDomain}`);
  }

  return token;
}

async function shopifyGraphql(shopDomain, query, variables = {}) {
  const token = await getShopAccessToken(shopDomain);
  const response = await fetch(`https://${shopDomain}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.errors) {
    const detail = payload.errors ? JSON.stringify(payload.errors) : `status ${response.status}`;
    throw new Error(`Shopify GraphQL failed: ${detail}`);
  }

  return payload.data;
}

module.exports = {
  getShopAccessToken,
  shopifyGraphql
};
