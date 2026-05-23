const pool = require("../db/pool");
const { getTemplate } = require("./templateService");
const { getCustomerByShopifyId } = require("./customerService");
const { sendToCustomerTokens } = require("./notificationService");
const { toAbsoluteStorefrontUrl } = require("./deepLinkService");

function pickFirstString(candidates) {
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function truncateText(value, max = 90) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function extractCheckoutProductName(payload) {
  const lines = []
    .concat(Array.isArray(payload?.line_items) ? payload.line_items : [])
    .concat(Array.isArray(payload?.lineItems) ? payload.lineItems : [])
    .concat(Array.isArray(payload?.items) ? payload.items : []);

  const firstName = lines
    .map((item) =>
      pickFirstString([
        item?.name,
        item?.title,
        item?.product_name,
        item?.productName,
        item?.sku
      ])
    )
    .find(Boolean);

  return truncateText(firstName);
}

const abandonedStageLabel = {
  "1h_sent": "Carrito pendiente",
  "24h_sent": "Recordatorio de carrito",
  "3d_sent": "Ultimo recordatorio"
};

function buildAbandonedCartCopy({ stage, payload, fallbackMessage }) {
  const productName = extractCheckoutProductName(payload || {});
  const stageLabel = abandonedStageLabel[stage] || "Carrito pendiente";
  const title = `Actualizacion de tu carrito | ${stageLabel}`;
  const parts = [`Estado: ${stageLabel}.`];

  if (productName) {
    parts.push(`Producto: ${productName}.`);
  }

  const detail = truncateText(fallbackMessage, 80);
  if (detail && !productName) {
    parts.push(`Detalle: ${detail}.`);
  }

  parts.push("Toca para finalizar tu compra.");

  return {
    title,
    message: parts.join(" "),
    productName,
    stageLabel
  };
}

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
    SELECT id, shop_domain, checkout_id, shopify_customer_id, created_at, abandoned_stage, payload
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

    const copy = buildAbandonedCartCopy({
      stage: nextStage,
      payload: row.payload || {},
      fallbackMessage: template.message
    });

    await sendToCustomerTokens({
      shopDomain: row.shop_domain,
      customerId: customer.id,
      type: "abandoned_cart",
      title: copy.title,
      message: copy.message,
      deepLink: template.deep_link
        ? toAbsoluteStorefrontUrl(row.shop_domain, template.deep_link)
        : toAbsoluteStorefrontUrl(row.shop_domain, "/cart"),
      data: {
        checkoutId: row.checkout_id,
        stage: nextStage,
        statusLabel: copy.stageLabel,
        productName: copy.productName || "",
        deepLinkType: "cart"
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
