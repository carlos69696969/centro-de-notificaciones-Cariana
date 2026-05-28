const pool = require("../db/pool");
const { getTemplate } = require("./templateService");
const { getCustomerByShopifyId } = require("./customerService");
const { sendToCustomerTokens, sendToEmailTokens } = require("./notificationService");
const { toAbsoluteStorefrontUrl } = require("./deepLinkService");

const DEFAULT_ABANDONED_CART_SETTINGS = {
  stage1DelayMinutes: 60,
  stage2DelayMinutes: 24 * 60,
  stage3DelayMinutes: 3 * 24 * 60
};

let ensureSettingsTablePromise = null;

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

function toSafeMinutes(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  if (normalized < 0) {
    return fallback;
  }
  return Math.min(normalized, 90 * 24 * 60);
}

function normalizeAbandonedCartSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    stage1DelayMinutes: toSafeMinutes(source.stage1DelayMinutes, DEFAULT_ABANDONED_CART_SETTINGS.stage1DelayMinutes),
    stage2DelayMinutes: toSafeMinutes(source.stage2DelayMinutes, DEFAULT_ABANDONED_CART_SETTINGS.stage2DelayMinutes),
    stage3DelayMinutes: toSafeMinutes(source.stage3DelayMinutes, DEFAULT_ABANDONED_CART_SETTINGS.stage3DelayMinutes)
  };
}

async function ensureAbandonedCartSettingsTable() {
  if (!ensureSettingsTablePromise) {
    ensureSettingsTablePromise = pool.query(
      `
      CREATE TABLE IF NOT EXISTS abandoned_cart_settings (
        shop_domain TEXT PRIMARY KEY,
        stage1_delay_minutes INTEGER NOT NULL DEFAULT 60,
        stage2_delay_minutes INTEGER NOT NULL DEFAULT 1440,
        stage3_delay_minutes INTEGER NOT NULL DEFAULT 4320,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
      `
    );
  }
  await ensureSettingsTablePromise;
}

const abandonedStageLabel = {
  "1h_sent": "Carrito pendiente",
  "24h_sent": "Recordatorio de carrito",
  "3d_sent": "Ultimo recordatorio"
};

const abandonedStageTemplateFallback = {
  "1h_sent": "Olvidaste articulos en tu carrito. Finaliza tu compra ahora.",
  "24h_sent": "Completa tu pedido y aprovecha nuestras promociones.",
  "3d_sent": "Aun tienes productos en tu carrito."
};

function buildAbandonedCartCopy({ stage, payload, fallbackMessage }) {
  const productName = extractCheckoutProductName(payload || {});
  const stageLabel = abandonedStageLabel[stage] || "Carrito pendiente";
  const title = `${stageLabel} - Carrito`;
  const parts = [];

  if (productName) {
    parts.push(`${productName}.`);
  }
  parts.push(`${stageLabel}.`);

  const detail = truncateText(fallbackMessage, 70);
  if (detail) {
    parts.push(`${detail}.`);
  }

  parts.push("Toca para ver el detalle.");

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

function buildCartEventPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const cart = source.cart && typeof source.cart === "object" ? source.cart : {};
  const items = Array.isArray(cart.items) ? cart.items : [];
  return {
    source: String(source.source || "storefront_add_to_cart"),
    token: String(source.cartToken || cart.token || cart.cart_token || "").trim(),
    item_count: Number(cart.item_count || items.length || 0),
    total_price: Number(cart.total_price || 0),
    currency: String(cart.currency || "").trim(),
    email: String(source.email || cart.email || cart.customer_email || "").trim().toLowerCase(),
    items: items.slice(0, 20).map((item) => ({
      id: Number(item.id || item.variant_id || 0) || 0,
      quantity: Number(item.quantity || 0) || 0,
      title: String(item.title || item.product_title || item.name || "").trim()
    }))
  };
}

async function recordAbandonedCartActivity({
  shopDomain,
  cartToken,
  shopifyCustomerId,
  email,
  payload
}) {
  const normalizedShopDomain = String(shopDomain || "").trim();
  if (!normalizedShopDomain) {
    return { tracked: false, reason: "missing_shop_domain" };
  }

  const cartEvent = buildCartEventPayload({
    ...(payload && typeof payload === "object" ? payload : {}),
    cartToken,
    email
  });
  const normalizedToken = String(cartToken || cartEvent.token || "").trim();
  const normalizedCustomerId = Number(shopifyCustomerId || 0);
  const syntheticCheckoutId = normalizedToken
    ? `cart:${normalizedToken}`
    : normalizedCustomerId > 0
      ? `cart:customer:${normalizedCustomerId}`
      : "";

  if (!syntheticCheckoutId) {
    return { tracked: false, reason: "missing_cart_identity" };
  }

  const effectiveEmail = String(email || cartEvent.email || "").trim().toLowerCase() || null;

  await pool.query(
    `
    INSERT INTO checkout_events
      (shop_domain, checkout_id, cart_token, shopify_customer_id, email, completed_at, abandoned_stage, payload, created_at)
    VALUES
      ($1,$2,$3,$4,$5,NULL,NULL,$6::jsonb,NOW())
    ON CONFLICT (shop_domain, checkout_id)
    DO UPDATE SET
      cart_token = COALESCE(EXCLUDED.cart_token, checkout_events.cart_token),
      shopify_customer_id = COALESCE(EXCLUDED.shopify_customer_id, checkout_events.shopify_customer_id),
      email = COALESCE(EXCLUDED.email, checkout_events.email),
      completed_at = NULL,
      abandoned_stage = NULL,
      payload = EXCLUDED.payload,
      created_at = NOW()
    `,
    [
      normalizedShopDomain,
      syntheticCheckoutId,
      normalizedToken || null,
      normalizedCustomerId > 0 ? normalizedCustomerId : null,
      effectiveEmail,
      JSON.stringify(cartEvent)
    ]
  );

  return {
    tracked: true,
    checkoutId: syntheticCheckoutId
  };
}

async function getAbandonedCartSettings(shopDomain) {
  await ensureAbandonedCartSettingsTable();
  const normalizedShopDomain = String(shopDomain || "").trim();
  if (!normalizedShopDomain) {
    return { ...DEFAULT_ABANDONED_CART_SETTINGS };
  }

  const result = await pool.query(
    `
    SELECT stage1_delay_minutes, stage2_delay_minutes, stage3_delay_minutes
    FROM abandoned_cart_settings
    WHERE shop_domain = $1
    `,
    [normalizedShopDomain]
  );

  if (!result.rows.length) {
    return { ...DEFAULT_ABANDONED_CART_SETTINGS };
  }

  return normalizeAbandonedCartSettings({
    stage1DelayMinutes: result.rows[0].stage1_delay_minutes,
    stage2DelayMinutes: result.rows[0].stage2_delay_minutes,
    stage3DelayMinutes: result.rows[0].stage3_delay_minutes
  });
}

async function saveAbandonedCartSettings(shopDomain, settings) {
  await ensureAbandonedCartSettingsTable();
  const normalizedShopDomain = String(shopDomain || "").trim();
  if (!normalizedShopDomain) {
    throw new Error("shopDomain is required");
  }

  const normalized = normalizeAbandonedCartSettings(settings);

  await pool.query(
    `
    INSERT INTO abandoned_cart_settings
      (shop_domain, stage1_delay_minutes, stage2_delay_minutes, stage3_delay_minutes, updated_at)
    VALUES
      ($1,$2,$3,$4,NOW())
    ON CONFLICT (shop_domain)
    DO UPDATE SET
      stage1_delay_minutes = EXCLUDED.stage1_delay_minutes,
      stage2_delay_minutes = EXCLUDED.stage2_delay_minutes,
      stage3_delay_minutes = EXCLUDED.stage3_delay_minutes,
      updated_at = NOW()
    `,
    [
      normalizedShopDomain,
      normalized.stage1DelayMinutes,
      normalized.stage2DelayMinutes,
      normalized.stage3DelayMinutes
    ]
  );

  return normalized;
}

async function runAbandonedCartSweep() {
  const rows = await pool.query(
    `
    SELECT id, shop_domain, checkout_id, shopify_customer_id, email, created_at, abandoned_stage, payload
    FROM checkout_events
    WHERE completed_at IS NULL
      AND (
        abandoned_stage IS NULL
        OR abandoned_stage IN ('1h_sent', '24h_sent')
      )
    `
  );
  const settingsCache = new Map();

  for (const row of rows.rows) {
    if (!settingsCache.has(row.shop_domain)) {
      const settings = await getAbandonedCartSettings(row.shop_domain);
      settingsCache.set(row.shop_domain, settings);
    }
    const settings = settingsCache.get(row.shop_domain);
    const stage1Ms = settings.stage1DelayMinutes * 60 * 1000;
    const stage2Ms = settings.stage2DelayMinutes * 60 * 1000;
    const stage3Ms = settings.stage3DelayMinutes * 60 * 1000;
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    let nextStage = null;
    if (!row.abandoned_stage && stage1Ms > 0 && ageMs >= stage1Ms) {
      nextStage = "1h_sent";
    } else if (row.abandoned_stage === "1h_sent" && stage2Ms > 0 && ageMs >= stage2Ms) {
      nextStage = "24h_sent";
    } else if (row.abandoned_stage === "24h_sent" && stage3Ms > 0 && ageMs >= stage3Ms) {
      nextStage = "3d_sent";
    }

    if (!nextStage) {
      continue;
    }

    const customer = row.shopify_customer_id
      ? await getCustomerByShopifyId(row.shop_domain, row.shopify_customer_id)
      : null;

    const codeMap = {
      "1h_sent": "abandoned_cart_1h",
      "24h_sent": "abandoned_cart_24h",
      "3d_sent": "abandoned_cart_3d"
    };
    const template = await getTemplate(row.shop_domain, codeMap[nextStage]);

    const copy = buildAbandonedCartCopy({
      stage: nextStage,
      payload: row.payload || {},
      fallbackMessage: template?.message || abandonedStageTemplateFallback[nextStage] || ""
    });

    const deepLink = template?.deep_link
      ? toAbsoluteStorefrontUrl(row.shop_domain, template.deep_link)
      : toAbsoluteStorefrontUrl(row.shop_domain, "/cart");

    const payloadData = {
      checkoutId: row.checkout_id,
      stage: nextStage,
      statusLabel: copy.stageLabel,
      productName: copy.productName || "",
      deepLinkType: "cart"
    };

    let delivery = { sent: 0, failed: 0, total: 0 };
    if (customer) {
      delivery = await sendToCustomerTokens({
        shopDomain: row.shop_domain,
        customerId: customer.id,
        type: "abandoned_cart",
        title: copy.title,
        message: copy.message,
        deepLink,
        data: payloadData
      });
    }

    if (delivery.total < 1) {
      const checkoutEmail = String(row.email || row.payload?.email || "").trim();
      if (checkoutEmail) {
        delivery = await sendToEmailTokens({
          shopDomain: row.shop_domain,
          email: checkoutEmail,
          type: "abandoned_cart",
          title: copy.title,
          message: copy.message,
          deepLink,
          data: payloadData
        });
      }
    }

    if (delivery.total < 1) {
      continue;
    }

    await pool.query(
      `UPDATE checkout_events SET abandoned_stage = $2 WHERE id = $1`,
      [row.id, nextStage]
    );
  }
}

module.exports = {
  DEFAULT_ABANDONED_CART_SETTINGS,
  getAbandonedCartSettings,
  recordAbandonedCartActivity,
  saveAbandonedCartSettings,
  upsertCheckoutEvent,
  runAbandonedCartSweep
};
