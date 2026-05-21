const pool = require("../db/pool");
const { getTemplate } = require("./templateService");
const { getCustomerByShopifyId } = require("./customerService");
const { sendToCustomerTokens } = require("./notificationService");

async function upsertCheckoutEvent({ shopDomain, payload }) {
  const checkoutId = payload.id ? String(payload.id) : null;
  if (!checkoutId) {
    return;
  }

  await pool.query(
    `
    INSERT INTO checkout_events
      (shop_domain, checkout_id, cart_token, shopify_customer_id, email, completed_at, payload)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7::jsonb)
    ON CONFLICT (shop_domain, checkout_id)
    DO UPDATE SET
      cart_token = EXCLUDED.cart_token,
      shopify_customer_id = EXCLUDED.shopify_customer_id,
      email = EXCLUDED.email,
      completed_at = EXCLUDED.completed_at,
      payload = EXCLUDED.payload
    `,
    [
      shopDomain,
      checkoutId,
      payload.cart_token || null,
      payload.customer?.id || null,
      payload.email || null,
      payload.completed_at || null,
      JSON.stringify(payload)
    ]
  );
}

async function runAbandonedCartSweep() {
  const rows = await pool.query(
    `
    SELECT id, shop_domain, checkout_id, shopify_customer_id, created_at, abandoned_stage
    FROM checkout_events
    WHERE completed_at IS NULL
      AND (
        abandoned_stage IS NULL
        OR abandoned_stage IN ('1h_sent', '24h_sent')
      )
    `
  );

  for (const row of rows.rows) {
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    let nextStage = null;
    if (!row.abandoned_stage && ageMs >= 60 * 60 * 1000) {
      nextStage = "1h_sent";
    } else if (row.abandoned_stage === "1h_sent" && ageMs >= 24 * 60 * 60 * 1000) {
      nextStage = "24h_sent";
    } else if (row.abandoned_stage === "24h_sent" && ageMs >= 3 * 24 * 60 * 60 * 1000) {
      nextStage = "3d_sent";
    }

    if (!nextStage || !row.shopify_customer_id) {
      continue;
    }

    const customer = await getCustomerByShopifyId(row.shop_domain, row.shopify_customer_id);
    if (!customer) {
      continue;
    }

    const codeMap = {
      "1h_sent": "abandoned_cart_1h",
      "24h_sent": "abandoned_cart_24h",
      "3d_sent": "abandoned_cart_3d"
    };
    const template = await getTemplate(row.shop_domain, codeMap[nextStage]);
    if (!template) {
      continue;
    }

    await sendToCustomerTokens({
      shopDomain: row.shop_domain,
      customerId: customer.id,
      type: "abandoned_cart",
      title: template.title,
      message: template.message,
      deepLink: template.deep_link || `/checkout/${row.checkout_id}`,
      data: {
        checkoutId: row.checkout_id,
        stage: nextStage
      }
    });

    await pool.query(
      `UPDATE checkout_events SET abandoned_stage = $2 WHERE id = $1`,
      [row.id, nextStage]
    );
  }
}

module.exports = {
  upsertCheckoutEvent,
  runAbandonedCartSweep
};
