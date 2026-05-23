const pool = require("../db/pool");
const { upsertCustomerFromShopify, getCustomerByShopifyId } = require("./customerService");
const { getTemplate } = require("./templateService");
const { sendToCustomerTokens } = require("./notificationService");
const { buildOrderDeepLink } = require("./deepLinkService");

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function hasDeliveredSignal(payload) {
  const deliveredValues = new Set(["delivered", "delivered_to_customer"]);
  const candidates = [];

  candidates.push(normalizeStatus(payload.fulfillment_status));
  candidates.push(normalizeStatus(payload.display_fulfillment_status));

  if (Array.isArray(payload.fulfillments)) {
    for (const fulfillment of payload.fulfillments) {
      candidates.push(normalizeStatus(fulfillment.shipment_status));
      candidates.push(normalizeStatus(fulfillment.status));
    }
  }

  return candidates.some((status) => deliveredValues.has(status));
}

function hasLocalDeliverySignal(payload) {
  if (!Array.isArray(payload.shipping_lines)) {
    return false;
  }

  return payload.shipping_lines.some((line) => {
    const code = normalizeStatus(line?.code);
    const title = normalizeStatus(line?.title);
    return code.includes("local_delivery") || title.includes("local_delivery");
  });
}

function resolveTemplateCodeFromOrder(topic, payload, existingMap) {
  if (topic === "orders/cancelled") {
    return "order_cancelled";
  }
  if (topic === "orders/create") {
    return "order_confirmed";
  }
  if (topic === "orders/fulfilled") {
    if (hasDeliveredSignal(payload)) {
      return "order_delivered";
    }
    return "order_shipped";
  }
  if (topic === "orders/updated") {
    if (payload.cancelled_at) {
      return "order_cancelled";
    }
    if (hasDeliveredSignal(payload)) {
      return "order_delivered";
    }
    if (payload.fulfillment_status === "fulfilled") {
      return "order_in_transit";
    }

    // Local delivery can stay with null fulfillment_status when merchant marks
    // "ready for delivery". In that case, the second update after "preparing"
    // should move to "in transit".
    if (hasLocalDeliverySignal(payload) && existingMap?.last_status === "order_preparing") {
      return "order_in_transit";
    }

    return "order_preparing";
  }
  return null;
}

function normalizeOrderNumber(value) {
  return String(value || "").replace(/^#/, "").trim();
}

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

function extractProductNames(payload) {
  const lineItems = []
    .concat(Array.isArray(payload?.line_items) ? payload.line_items : [])
    .concat(Array.isArray(payload?.lineItems) ? payload.lineItems : [])
    .concat(Array.isArray(payload?.items) ? payload.items : []);

  const fromLines = lineItems
    .map((item) =>
      pickFirstString([
        item?.name,
        item?.title,
        item?.product_name,
        item?.productName,
        item?.sku
      ])
    )
    .filter(Boolean);

  const firstDirect = pickFirstString([
    payload?.product_name,
    payload?.productName,
    payload?.item_name,
    payload?.itemName
  ]);

  const combined = []
    .concat(firstDirect ? [firstDirect] : [])
    .concat(fromLines)
    .map((name) => truncateText(name, 42))
    .filter(Boolean);

  return Array.from(new Set(combined)).slice(0, 4);
}

function formatProductsInline(productNames = []) {
  const clean = (Array.isArray(productNames) ? productNames : []).filter(Boolean).slice(0, 4);
  if (!clean.length) {
    return "";
  }
  return clean.join(", ");
}

const orderStatusLabels = {
  order_confirmed: "Confirmado",
  order_preparing: "En preparacion",
  order_shipped: "Enviado",
  order_in_transit: "En transito",
  order_delivered: "Entregado",
  order_cancelled: "Cancelado",
  refund_processed: "Reembolso procesado"
};

function buildOrderNotificationCopy({ templateCode, orderNumber, payload, fallbackTitle, fallbackMessage }) {
  const normalizedOrder = normalizeOrderNumber(orderNumber);
  const statusLabel = orderStatusLabels[templateCode] || pickFirstString([fallbackTitle, "Actualizacion"]);
  const productNames = extractProductNames(payload);
  const productsInline = formatProductsInline(productNames);
  const title = normalizedOrder ? `${statusLabel} - Pedido #${normalizedOrder}` : `${statusLabel} - Pedido`;
  const parts = [];
  if (normalizedOrder) {
    parts.push(`Pedido #${normalizedOrder} ${statusLabel}.`);
  } else {
    parts.push(`${statusLabel}.`);
  }

  if (productsInline) {
    parts.push(`${productsInline}.`);
  }

  const detail = truncateText(fallbackMessage, 70);
  if (detail && !productsInline) {
    parts.push(`${detail}.`);
  }

  parts.push("Toca para ver el detalle.");

  return {
    title,
    message: parts.join(" "),
    statusLabel,
    productNames,
    productsInline
  };
}

function buildRefundNotificationCopy({ orderNumber, fallbackTitle, fallbackMessage }) {
  const normalizedOrder = normalizeOrderNumber(orderNumber);
  const title = normalizedOrder
    ? `Reembolso procesado - Pedido #${normalizedOrder}`
    : "Reembolso procesado - Pedido";
  const detail = truncateText(fallbackMessage, 90);
  const parts = normalizedOrder
    ? [`Pedido #${normalizedOrder} Reembolso procesado.`]
    : ["Reembolso procesado."];

  if (detail) {
    parts.push(`${detail}.`);
  }
  parts.push("Toca para ver el detalle.");

  return {
    title,
    message: parts.join(" "),
    statusLabel: fallbackTitle || "Reembolso procesado",
    productNames: [],
    productsInline: ""
  };
}

async function processOrderWebhook({ topic, shopDomain, payload, webhookId }) {
  const eventResult = await pool.query(
    `
    INSERT INTO notification_events (webhook_id, shop_domain, topic, payload, status)
    VALUES ($1,$2,$3,$4::jsonb,'pending')
    ON CONFLICT (webhook_id) DO NOTHING
    RETURNING id
    `,
    [webhookId, shopDomain, topic, JSON.stringify(payload)]
  );

  if (eventResult.rowCount === 0) {
    return { duplicated: true };
  }

  const eventId = eventResult.rows[0].id;
  const mappedOrder = await pool.query(
    `
    SELECT shopify_customer_id, order_number, last_status
    FROM order_customer_map
    WHERE shop_domain = $1 AND order_id = $2
    `,
    [shopDomain, payload.id]
  );

  const existingMap = mappedOrder.rowCount > 0 ? mappedOrder.rows[0] : null;
  const templateCode = resolveTemplateCodeFromOrder(topic, payload, existingMap);
  if (!templateCode) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true };
  }

  if (existingMap && existingMap.last_status === templateCode) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Duplicate status event', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Duplicate status event" };
  }

  let customer = null;
  const customerIdFromPayload = payload.customer?.id || null;
  const customerIdFromMap = existingMap?.shopify_customer_id || null;
  const mappedCustomerId = customerIdFromPayload || customerIdFromMap;

  if (payload.customer?.id) {
    customer = await upsertCustomerFromShopify(shopDomain, payload.customer);
  } else if (mappedCustomerId) {
    customer = await getCustomerByShopifyId(shopDomain, mappedCustomerId);
  }

  if (!customer) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Order has no customer', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Order has no customer" };
  }

  await pool.query(
    `
    INSERT INTO order_customer_map
      (shop_domain, order_id, shopify_customer_id, order_number, last_status, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,NOW())
    ON CONFLICT (shop_domain, order_id)
    DO UPDATE SET
      shopify_customer_id = EXCLUDED.shopify_customer_id,
      order_number = EXCLUDED.order_number,
      last_status = EXCLUDED.last_status,
      updated_at = NOW()
    `,
    [
      shopDomain,
      payload.id,
      mappedCustomerId || customer.shopify_customer_id,
      payload.order_number || existingMap?.order_number || null,
      templateCode
    ]
  );

  const template = await getTemplate(shopDomain, templateCode);
  if (!template) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Template not found', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Template not found" };
  }

  const copy = buildOrderNotificationCopy({
    templateCode,
    orderNumber: payload.order_number,
    payload,
    fallbackTitle: template.title,
    fallbackMessage: template.message
  });

  const data = {
    orderId: payload.id,
    orderNumber: payload.order_number,
    status: templateCode,
    statusLabel: copy.statusLabel,
    productName: copy.productsInline || "",
    productNames: copy.productNames || [],
    deepLinkType: "order",
    customerEmail: payload.customer?.email || ""
  };

  const sendResult = await sendToCustomerTokens({
    shopDomain,
    customerId: customer.id,
    type: "order_event",
    title: copy.title,
    message: copy.message,
    deepLink: buildOrderDeepLink({
      shopDomain,
      orderNumber: payload.order_number,
      deepLink: template.deep_link
    }),
    data,
    eventId
  });

  await pool.query(
    `
    UPDATE notification_events
    SET status = $2, processed_at = NOW(), error_message = $3
    WHERE id = $1
    `,
    [eventId, sendResult.total > 0 ? "processed" : "skipped", sendResult.total > 0 ? null : "No active tokens"]
  );

  return sendResult;
}

async function sendManualOrderStatus({ shopDomain, shopifyCustomerId, orderId, orderNumber, status }) {
  const map = {
    confirmed: "order_confirmed",
    preparing: "order_preparing",
    shipped: "order_shipped",
    in_transit: "order_in_transit",
    delivered: "order_delivered",
    cancelled: "order_cancelled"
  };
  const templateCode = map[status];
  if (!templateCode) {
    throw new Error("Unsupported order status");
  }

  const customer = await getCustomerByShopifyId(shopDomain, shopifyCustomerId);
  if (!customer) {
    throw new Error("Customer not found");
  }

  const template = await getTemplate(shopDomain, templateCode);
  if (!template) {
    throw new Error(`Template not found for ${templateCode}`);
  }

  const copy = buildOrderNotificationCopy({
    templateCode,
    orderNumber,
    payload: {},
    fallbackTitle: template.title,
    fallbackMessage: template.message
  });

  return sendToCustomerTokens({
    shopDomain,
    customerId: customer.id,
    type: "order_manual",
    title: copy.title,
    message: copy.message,
    deepLink: buildOrderDeepLink({
      shopDomain,
      orderNumber,
      deepLink: template.deep_link
    }),
    data: {
      orderId,
      orderNumber,
      status: templateCode,
      statusLabel: copy.statusLabel,
      productName: copy.productsInline || "",
      productNames: copy.productNames || [],
      deepLinkType: "order"
    }
  });
}

async function processRefundWebhook({ shopDomain, payload, webhookId }) {
  const eventResult = await pool.query(
    `
    INSERT INTO notification_events (webhook_id, shop_domain, topic, payload, status)
    VALUES ($1,$2,'refunds/create',$3::jsonb,'pending')
    ON CONFLICT (webhook_id) DO NOTHING
    RETURNING id
    `,
    [webhookId, shopDomain, JSON.stringify(payload)]
  );

  if (eventResult.rowCount === 0) {
    return { duplicated: true };
  }

  const eventId = eventResult.rows[0].id;
  const mapResult = await pool.query(
    `
    SELECT shopify_customer_id, order_number
    FROM order_customer_map
    WHERE shop_domain = $1 AND order_id = $2
    `,
    [shopDomain, payload.order_id]
  );

  if (mapResult.rowCount === 0) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Order mapping not found', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true };
  }

  const mapped = mapResult.rows[0];
  const customer = await getCustomerByShopifyId(shopDomain, mapped.shopify_customer_id);
  if (!customer) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Customer not found', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true };
  }

  const template = await getTemplate(shopDomain, "refund_processed");
  if (!template) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Template not found', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true };
  }

  const copy = buildRefundNotificationCopy({
    orderNumber: mapped.order_number,
    fallbackTitle: template.title,
    fallbackMessage: template.message
  });

  const sendResult = await sendToCustomerTokens({
    shopDomain,
    customerId: customer.id,
    type: "refund_event",
    title: copy.title,
    message: copy.message,
    deepLink: buildOrderDeepLink({
      shopDomain,
      orderNumber: mapped.order_number,
      deepLink: template.deep_link
    }),
    data: {
      orderId: payload.order_id,
      orderNumber: mapped.order_number || "",
      refundId: payload.id || "",
      statusLabel: copy.statusLabel,
      productName: "",
      productNames: [],
      deepLinkType: "order"
    },
    eventId
  });

  await pool.query(
    `
    UPDATE notification_events
    SET status = $2, processed_at = NOW(), error_message = $3
    WHERE id = $1
    `,
    [eventId, sendResult.total > 0 ? "processed" : "skipped", sendResult.total > 0 ? null : "No active tokens"]
  );

  return sendResult;
}

module.exports = {
  processOrderWebhook,
  sendManualOrderStatus,
  processRefundWebhook
};
