const pool = require("../db/pool");

async function upsertCustomerFromShopify(shopDomain, customerPayload = {}) {
  const shopifyCustomerId = Number(customerPayload.id);
  if (!shopifyCustomerId) {
    return null;
  }

  const result = await pool.query(
    `
    INSERT INTO customers
      (shop_domain, shopify_customer_id, email, first_name, last_name, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,NOW())
    ON CONFLICT (shop_domain, shopify_customer_id)
    DO UPDATE SET
      email = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      updated_at = NOW()
    RETURNING id, shopify_customer_id
    `,
    [
      shopDomain,
      shopifyCustomerId,
      customerPayload.email || null,
      customerPayload.first_name || null,
      customerPayload.last_name || null
    ]
  );

  return result.rows[0];
}

async function getCustomerByShopifyId(shopDomain, shopifyCustomerId) {
  const result = await pool.query(
    `
    SELECT id, shopify_customer_id
    FROM customers
    WHERE shop_domain = $1 AND shopify_customer_id = $2
    `,
    [shopDomain, Number(shopifyCustomerId)]
  );
  return result.rows[0] || null;
}

async function getCustomerByEmail(shopDomain, email) {
  if (!email) {
    return null;
  }

  const result = await pool.query(
    `
    SELECT id, shopify_customer_id
    FROM customers
    WHERE shop_domain = $1
      AND LOWER(email) = LOWER($2)
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [shopDomain, String(email).trim()]
  );
  return result.rows[0] || null;
}

module.exports = {
  upsertCustomerFromShopify,
  getCustomerByShopifyId,
  getCustomerByEmail
};
