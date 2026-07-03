const pool = require("../db/pool");
const { upsertCustomerFromShopify, getCustomerByShopifyId, getCustomerByEmail } = require("./customerService");
const { getTemplate } = require("./templateService");
const { sendToCustomerTokens } = require("./notificationService");
const { buildOrderDeepLink, buildReturnDeepLink } = require("./deepLinkService");
const { closeAbandonedCartsFromOrder } = require("./abandonedCartService");
const {
  getReturnNotificationSettings,
  saveReturnNotificationSettings
} = require("./returnSettingsService");
const env = require("../config/env");

const LOCAL_DELIVERY_READY_TOPIC = "fulfillment_orders/line_items_prepared_for_local_delivery";
const DEFAULT_DELIVERY_HOURS = "8:00 a.m. a 8:00 p.m.";
const DEFAULT_RETURNS_PORTAL_BASE_URL = "https://gestion-devoluciones-pro.onrender.com";
const NOTIFICATION_TIME_ZONE = "America/Mexico_City";

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function parseLegacyNumericId(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  if (/^\d+$/.test(text)) {
    return text;
  }
  const match = text.match(/(\d+)(?!.*\d)/);
  return match ? match[1] : null;
}

function formatNotificationSentAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-MX", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: NOTIFICATION_TIME_ZONE
  })
    .format(date)
    .replace(".", "")
    .replace(",", "")
    .replace(/\bp\.?\s*m\.?/i, "pm.")
    .replace(/\ba\.?\s*m\.?/i, "am.")
    .toLowerCase();
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
  if (topic === LOCAL_DELIVERY_READY_TOPIC) {
    return "order_in_transit";
  }
  return null;
}

const orderStatusRank = {
  order_confirmed: 10,
  order_preparing: 20,
  order_in_transit: 30,
  order_shipped: 30,
  order_delivered: 40,
  order_cancelled: 50
};

function isStaleOrderTransition(previousStatus, nextStatus) {
  const previousRank = orderStatusRank[previousStatus] || 0;
  const nextRank = orderStatusRank[nextStatus] || 0;
  if (!previousRank || !nextRank) {
    return false;
  }
  return nextRank < previousRank;
}

function normalizeOrderNumber(value) {
  return String(value || "").replace(/^#/, "").trim();
}

function extractOrderContext(topic, payload) {
  const orderIdCandidates = [];
  const orderNumberCandidates = [];
  const orderStatusUrlCandidates = [];
  const orderTokenCandidates = [];
  const customerIdCandidates = [];

  if (topic.startsWith("orders/")) {
    orderIdCandidates.push(payload?.id);
    orderNumberCandidates.push(payload?.order_number, payload?.name);
    orderStatusUrlCandidates.push(payload?.order_status_url, payload?.orderStatusUrl);
    orderTokenCandidates.push(payload?.token, payload?.order_token, payload?.orderToken);
    customerIdCandidates.push(payload?.customer?.id);
  }

  if (topic === LOCAL_DELIVERY_READY_TOPIC) {
    orderIdCandidates.push(payload?.order_id);
    orderIdCandidates.push(payload?.fulfillment_order?.order_id);
    orderIdCandidates.push(payload?.fulfillmentOrder?.order_id);
    orderNumberCandidates.push(
      payload?.order_number,
      payload?.order_name,
      payload?.order?.order_number,
      payload?.order?.name
    );
    orderStatusUrlCandidates.push(
      payload?.order_status_url,
      payload?.orderStatusUrl,
      payload?.order?.order_status_url,
      payload?.order?.orderStatusUrl
    );
    orderTokenCandidates.push(
      payload?.token,
      payload?.order_token,
      payload?.orderToken,
      payload?.order?.token,
      payload?.order?.order_token,
      payload?.order?.orderToken
    );
  }

  const orderId = orderIdCandidates.map(parseLegacyNumericId).find(Boolean) || null;
  const orderNumberRaw = orderNumberCandidates.map((value) => String(value || "").trim()).find(Boolean) || "";
  const orderStatusUrl = orderStatusUrlCandidates.map((value) => String(value || "").trim()).find(Boolean) || "";
  const orderToken = orderTokenCandidates.map((value) => String(value || "").trim()).find(Boolean) || "";
  const orderNumber = normalizeOrderNumber(orderNumberRaw);
  const customerId = customerIdCandidates.map(parseLegacyNumericId).find(Boolean) || null;

  return { orderId, orderNumber, orderStatusUrl, orderToken, customerId };
}

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
  if (result.rowCount === 0) {
    return null;
  }
  const token = String(result.rows[0].access_token || "").trim();
  return token || null;
}

async function fetchShopifyOrderById(shopDomain, orderId) {
  const token = await getShopAccessToken(shopDomain);
  if (!token || !orderId) {
    return null;
  }

  const apiVersion = "2026-04";
  const fields = [
    "id",
    "name",
    "order_number",
    "order_status_url",
    "token",
    "customer",
    "line_items",
    "shipping_lines",
    "fulfillment_status",
    "display_fulfillment_status",
    "fulfillments",
    "cancelled_at"
  ].join(",");

  const url = `https://${shopDomain}/admin/api/${apiVersion}/orders/${orderId}.json?status=any&fields=${fields}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": token,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data?.order || null;
}

async function fetchOrderIdFromFulfillmentOrder(shopDomain, fulfillmentOrderId) {
  const token = await getShopAccessToken(shopDomain);
  if (!token || !fulfillmentOrderId) {
    return null;
  }

  const apiVersion = "2026-04";
  const url = `https://${shopDomain}/admin/api/${apiVersion}/fulfillment_orders/${fulfillmentOrderId}.json`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": token,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return parseLegacyNumericId(data?.fulfillment_order?.order_id);
}

async function inferOrderIdFromRecentLocalDeliveryContext({ shopDomain, eventId }) {
  const eventResult = await pool.query(
    `
    SELECT created_at
    FROM notification_events
    WHERE id = $1
    LIMIT 1
    `,
    [eventId]
  );

  if (eventResult.rowCount === 0) {
    return null;
  }

  const eventCreatedAt = eventResult.rows[0].created_at;
  const candidateResult = await pool.query(
    `
    SELECT ocm.order_id
    FROM order_customer_map ocm
    JOIN notification_events ne
      ON ne.shop_domain = ocm.shop_domain
     AND ne.topic = 'orders/updated'
     AND (ne.payload->>'id') ~ '^[0-9]+$'
     AND (ne.payload->>'id')::BIGINT = ocm.order_id
    WHERE ocm.shop_domain = $1
      AND ocm.last_status = 'order_preparing'
      AND ne.created_at BETWEEN ($2::timestamptz - interval '36 hours') AND ($2::timestamptz + interval '5 minutes')
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(ne.payload->'shipping_lines', '[]'::jsonb)) AS line
        WHERE lower(COALESCE(line->>'code', '')) LIKE '%local%'
           OR lower(COALESCE(line->>'title', '')) LIKE '%local%'
      )
    ORDER BY ne.created_at DESC
    LIMIT 1
    `,
    [shopDomain, eventCreatedAt]
  );

  if (candidateResult.rowCount === 0) {
    return null;
  }

  return String(candidateResult.rows[0].order_id);
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

function capitalizeFirst(value) {
  const text = String(value || "").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function formatDeliveryDateFromPurchase(value) {
  const purchaseDate = value ? new Date(value) : new Date();
  const baseDate = Number.isNaN(purchaseDate.getTime()) ? new Date() : purchaseDate;
  const parts = new Intl.DateTimeFormat("es-MX", {
    timeZone: NOTIFICATION_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric"
  })
    .formatToParts(baseDate)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = Number(part.value);
      return acc;
    }, {});
  const deliveryDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12));
  const formattedParts = new Intl.DateTimeFormat("es-MX", {
    timeZone: NOTIFICATION_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  })
    .formatToParts(deliveryDate)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  return `${capitalizeFirst(formattedParts.weekday)} ${formattedParts.day}/${formattedParts.month}/${formattedParts.year}`;
}

function formatRescheduledDeliveryDate(value) {
  const text = String(value || "").trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!isoMatch) return text;
  const date = new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 12));
  const parts = new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return `${capitalizeFirst(parts.weekday)} ${parts.day}/${capitalizeFirst(parts.month)}/${parts.year}`;
}

function normalizeMeridiem(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\ba\s*\.?\s*m\.?(?=\s|$)/g, "a.m.")
    .replace(/\bp\s*\.?\s*m\.?(?=\s|$)/g, "p.m.");
  return text.replace(/(\d)\s+(a\.m\.|p\.m\.)/g, "$1 $2");
}

function extractDeliveryCutoffTime(value) {
  const text = normalizeMeridiem(value);
  const matches = Array.from(text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.m\.|p\.m\.)(?=\s|$)/g));
  const lastMatch = matches.at(-1);
  if (!lastMatch) return DEFAULT_DELIVERY_HOURS.split(" a ").at(-1) || "8:00 p.m.";
  const hour = lastMatch[1];
  const minutes = lastMatch[2] || "00";
  return `${hour}:${minutes} ${lastMatch[3]}`;
}

function formatBranchPickupDeadlineDate(value) {
  const directLabel = String(value || "").trim();
  if (!directLabel) return "";
  const date = new Date(directLabel);
  if (Number.isFinite(date.getTime())) {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: NOTIFICATION_TIME_ZONE,
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
  }
  const cleanLabel = directLabel
    .replace(/^(?:lun|mar|mie|mié|jue|vie|sab|sáb|dom)\.?\s+/i, "")
    .replace(/^0+(\d)/, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const spanishDateMatch = cleanLabel.match(/^(\d{1,2})\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s+(\d{4})$/);
  if (spanishDateMatch) {
    return `${Number(spanishDateMatch[1])} de ${spanishDateMatch[2].toLowerCase()} de ${spanishDateMatch[3]}`;
  }
  return cleanLabel;
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

function returnsPortalBaseUrl() {
  const configured = String(env.returnsPortalUrl || process.env.RETURNS_PORTAL_URL || "").trim();
  if (!configured) return DEFAULT_RETURNS_PORTAL_BASE_URL;
  try {
    const url = new URL(configured);
    return url.origin;
  } catch {
    return configured.replace(/\/devoluciones\/?$/i, "").replace(/\/+$/, "");
  }
}

async function fetchReturnSettingsForShop(shopDomain, { allowCachedFallback = true } = {}) {
  const shop = String(shopDomain || "").trim();
  const apiKeys = Array.from(
    new Set([
      process.env.NOTIFICATIONS_API_KEY,
      env.appInternalApiKey,
      process.env.APP_INTERNAL_API_KEY
    ].map((value) => String(value || "").trim()).filter(Boolean))
  );
  if (!shop) return null;

  const endpoint = new URL("/api/return-settings", returnsPortalBaseUrl());
  endpoint.searchParams.set("shop", shop);
  endpoint.searchParams.set("t", String(Date.now()));

  for (const apiKey of [...apiKeys, ""]) {
    try {
      const headers = {
        "Cache-Control": "no-cache, no-store, max-age=0",
        "Pragma": "no-cache",
        "x-shop-domain": shop
      };
      if (apiKey) {
        headers["x-api-key"] = apiKey;
      }
      const response = await fetch(endpoint, {
        method: "GET",
        headers
      });
      if (!response.ok) {
        console.warn("Return settings endpoint rejected order notification lookup", {
          shopDomain: shop,
          status: response.status
        });
        continue;
      }
      const payload = await response.json().catch(() => null);
      if (payload?.ok) {
        const settings = payload.settings || null;
        if (settings?.branchAddress || settings?.branchHours || settings?.pickupHours) {
          await saveReturnNotificationSettings(shop, settings).catch((error) => {
            console.warn("Failed to cache fetched return settings", {
              shopDomain: shop,
              error: String(error?.message || error || "unknown")
            });
          });
        }
        return settings;
      }
    } catch (error) {
      console.warn("Failed to fetch return settings for order notification", {
        shopDomain: shop,
        error: String(error?.message || error || "unknown")
      });
    }
  }

  if (!allowCachedFallback) {
    return null;
  }

  const cachedSettings = await getReturnNotificationSettings(shop);
  if (cachedSettings?.branchAddress || cachedSettings?.branchHours || cachedSettings?.pickupHours) {
    return cachedSettings;
  }
  return null;
}

const orderStatusLabels = {
  order_confirmed: "Confirmado",
  order_preparing: "En preparacion",
  order_shipped: "Enviado",
  order_in_transit: "En ruta",
  order_rescheduled: "Entrega reprogramada",
  order_delivered: "Entregado",
  order_not_delivered: "No entregado",
  order_cancelled: "Cancelado",
  refund_processed: "Reembolso procesado"
};

const manualStatusAliases = {
  confirmed: "order_confirmed",
  confirm: "order_confirmed",
  preparado: "order_preparing",
  preparing: "order_preparing",
  preparation: "order_preparing",
  en_preparacion: "order_preparing",
  shipped: "order_shipped",
  enviado: "order_shipped",
  in_transit: "order_in_transit",
  en_transito: "order_in_transit",
  en_ruta: "order_in_transit",
  en_route: "order_in_transit",
  enruta: "order_in_transit",
  in_route: "order_in_transit",
  route: "order_in_transit",
  en_camino: "order_in_transit",
  on_route: "order_in_transit",
  reprogramado: "order_rescheduled",
  reprogramada: "order_rescheduled",
  reintento_pendiente: "order_rescheduled",
  order_rescheduled: "order_rescheduled",
  delivery_rescheduled: "order_rescheduled",
  route_rescheduled: "order_rescheduled",
  delivered: "order_delivered",
  entregado: "order_delivered",
  no_entregado: "order_not_delivered",
  noentregado: "order_not_delivered",
  not_delivered: "order_not_delivered",
  failed_delivery: "order_not_delivered",
  entrega_fallida: "order_not_delivered",
  refund_processed: "refund_processed",
  reembolso_procesado: "refund_processed",
  cancelled: "order_cancelled",
  canceled: "order_cancelled",
  cancelado: "order_cancelled"
};

const validManualStatusCodes = new Set([
  "order_confirmed",
  "order_preparing",
  "order_shipped",
  "order_in_transit",
  "order_rescheduled",
  "order_delivered",
  "order_not_delivered",
  "refund_processed",
  "order_cancelled"
]);
const ORDER_STATUS_DEDUPE_WINDOW_MINUTES = 2;
const DEDUPED_ORDER_STATUS_CODES = new Set(["order_in_transit", "order_delivered"]);

async function hasRecentOrderRescheduleNotification({ shopDomain, orderId, orderNumber, minutes = 10 }) {
  const normalizedOrderId = parseLegacyNumericId(orderId);
  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);

  if (!shopDomain || (!normalizedOrderId && !normalizedOrderNumber)) {
    return false;
  }

  const result = await pool.query(
    `
    SELECT 1
    FROM notifications
    WHERE shop_domain = $1
      AND created_at >= NOW() - ($4::int * INTERVAL '1 minute')
      AND COALESCE(data->>'status', '') = 'order_rescheduled'
      AND (
        ($2::bigint IS NOT NULL AND NULLIF(regexp_replace(COALESCE(data->>'orderId', ''), '\\D', '', 'g'), '')::bigint = $2::bigint)
        OR ($3 <> '' AND regexp_replace(COALESCE(data->>'orderNumber', ''), '\\D', '', 'g') = $3)
      )
    LIMIT 1
    `,
    [shopDomain, normalizedOrderId || null, normalizedOrderNumber, Math.max(1, Number(minutes) || 10)]
  );

  return result.rowCount > 0;
}

async function hasRecentOrderStatusNotification({
  shopDomain,
  orderId,
  orderNumber,
  status,
  minutes = ORDER_STATUS_DEDUPE_WINDOW_MINUTES
}) {
  const normalizedOrderId = parseLegacyNumericId(orderId);
  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
  const normalizedStatus = normalizeManualStatus(status);

  if (!shopDomain || !normalizedStatus || (!normalizedOrderId && !normalizedOrderNumber)) {
    return false;
  }

  const result = await pool.query(
    `
    SELECT 1
    FROM notifications
    WHERE shop_domain = $1
      AND status = 'sent'
      AND created_at >= NOW() - ($5::int * INTERVAL '1 minute')
      AND COALESCE(data->>'status', '') = $4
      AND (
        ($2::bigint IS NOT NULL AND NULLIF(regexp_replace(COALESCE(data->>'orderId', ''), '\\D', '', 'g'), '')::bigint = $2::bigint)
        OR ($3 <> '' AND regexp_replace(COALESCE(data->>'orderNumber', ''), '\\D', '', 'g') = $3)
      )
    LIMIT 1
    `,
    [
      shopDomain,
      normalizedOrderId || null,
      normalizedOrderNumber,
      normalizedStatus,
      Math.max(1, Number(minutes) || ORDER_STATUS_DEDUPE_WINDOW_MINUTES)
    ]
  );

  return result.rowCount > 0;
}

async function withOrderStatusNotificationLock({ shopDomain, orderId, orderNumber, status }, callback) {
  const normalizedOrderId = parseLegacyNumericId(orderId);
  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
  const normalizedStatus = normalizeManualStatus(status);
  const orderReference = normalizedOrderId || normalizedOrderNumber;
  if (
    !shopDomain ||
    !orderReference ||
    !normalizedStatus ||
    !DEDUPED_ORDER_STATUS_CODES.has(normalizedStatus)
  ) {
    return callback();
  }

  const lockKey = `order-status:${shopDomain}:${orderReference}:${normalizedStatus}`;
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    return await callback();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => {});
    client.release();
  }
}

const defaultManualTemplates = {
  order_not_delivered: {
    title: "Pedido no entregado 📦❌",
    message: "Pedido #**** 🚚. Pasamos a tu domicilio, pero no tuvimos respuesta al tocar la puerta ni al intentar comunicarnos contigo. Nuestro equipo realizará un nuevo intento de entrega mañana, en un horario de 8:00 a. m. a 8:00 p. m. 😉 ¡Gracias por tu comprensión!"
  },
  order_rescheduled: {
    title: "Entrega reprogramada 🔄📦",
    message: "🚚 Pedido #****. Tu pedido no pudo ser entregado el día de hoy debido al volumen de entregas programadas para hoy. Tu pedido ha sido reprogramado para mañana, en un horario de 8:00 a.m. a 8:00 p.m.\n\nAgradecemos tu comprensión y por confiar en siempre en Cariana. ✨"
  }
};

function normalizeManualStatus(value) {
  const normalized = normalizeStatus(value);
  return manualStatusAliases[normalized] || normalized;
}

const DEFAULT_BRANCH_ADDRESS = "Sucursal principal por definir";
const DEFAULT_BRANCH_HOURS = "Lunes a Viernes de 9:00 a 18:00";

function normalizeBranchText(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

async function getCustomerByOrderReference({ shopDomain, orderId, orderNumber }) {
  const normalizedOrderId = parseLegacyNumericId(orderId);
  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);

  if (!normalizedOrderId && !normalizedOrderNumber) {
    return null;
  }

  const result = await pool.query(
    `
    SELECT c.id, c.shopify_customer_id
    FROM order_customer_map ocm
    JOIN customers c ON c.shop_domain = ocm.shop_domain AND c.shopify_customer_id = ocm.shopify_customer_id
    WHERE ocm.shop_domain = $1
      AND (
        ($2::bigint IS NOT NULL AND ocm.order_id = $2::bigint)
        OR ($3 <> '' AND COALESCE(ocm.order_number, '') = $3)
      )
    ORDER BY ocm.updated_at DESC, ocm.id DESC
    LIMIT 1
    `,
    [shopDomain, normalizedOrderId || null, normalizedOrderNumber]
  );

  return result.rows[0] || null;
}

function buildOrderNotificationCopy({ templateCode, orderNumber, payload, fallbackTitle, fallbackMessage }) {
  const normalizedOrder = normalizeOrderNumber(orderNumber);
  const customTitle = String(payload?.title || "").trim();
  const customMessage = String(payload?.message || "").trim();
  if (customTitle && customMessage) {
    return {
      title: customTitle,
      message: customMessage,
      statusLabel: orderStatusLabels[templateCode] || pickFirstString([fallbackTitle, "Actualizacion"]),
      productNames: [],
      productsInline: ""
    };
  }
  const statusLabel = orderStatusLabels[templateCode] || pickFirstString([fallbackTitle, "Actualizacion"]);
  const productNames = extractProductNames(payload);
  const productsInline = formatProductsInline(productNames);
  const title = normalizedOrder ? `${statusLabel} - Pedido #${normalizedOrder}` : `${statusLabel} - Pedido`;
  const attemptCount = Math.max(0, Number(payload?.attemptCount ?? payload?.attempt_count ?? payload?.attempt ?? 0) || 0);
  const branchAddress = normalizeBranchText(
    payload?.branchAddress ?? payload?.branch_address ?? payload?.pickupAddress ?? payload?.returnSettingsBranchAddress,
    DEFAULT_BRANCH_ADDRESS
  );
  const branchHours = normalizeBranchText(
    payload?.branchHours ?? payload?.branch_hours ?? payload?.returnSettingsBranchHours ?? payload?.pickupHours,
    DEFAULT_BRANCH_HOURS
  );
  const deliveryHours = normalizeBranchText(
    pickFirstString([
      payload?.pickupHours,
      payload?.pickup_hours,
      payload?.returnSettingsPickupHours,
      payload?.deliveryHours,
      payload?.delivery_hours
    ]),
    DEFAULT_DELIVERY_HOURS
  );
  const deliveryCutoffTime = extractDeliveryCutoffTime(deliveryHours);
  const branchPickupDeadlineLabel = formatBranchPickupDeadlineDate(
    pickFirstString([
      payload?.branchPickupDeadlineAt,
      payload?.branchPickupDeadline,
      payload?.branchPickupDeadlineLabel,
      payload?.pickupDeadlineAt,
      payload?.pickupDeadlineLabel
    ])
  );
  const rescheduledDeliveryDate = pickFirstString([
    formatRescheduledDeliveryDate(payload?.rescheduledDate ?? payload?.rescheduled_date),
    payload?.rescheduledDateLabel,
    payload?.rescheduled_date_label
  ]);
  const nextDeliveryDate =
    rescheduledDeliveryDate ||
    new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date(Date.now() + 24 * 60 * 60 * 1000));

  if (templateCode === "order_preparing") {
    const orderRef = normalizedOrder ? `#${normalizedOrder}` : "#****";
    const deliveryDate = formatDeliveryDateFromPurchase(
      payload?.created_at ?? payload?.createdAt ?? payload?.processed_at ?? payload?.processedAt
    );
    const message = `📦Tu pedido ${orderRef} está siendo preparado para ser enviado. Llegará mañana ${deliveryDate} en un horario de ${deliveryHours}. No olvides darle tu clave de entrega al repartidor para recibir tu pedido.\n\nGracias por confiar en Cariana. ✨`;

    return {
      title: "Pedido confirmado ✅",
      message,
      statusLabel,
      productNames,
      productsInline
    };
  }

  if (templateCode === "order_delivered") {
    const orderRef = normalizedOrder ? `#${normalizedOrder}` : "";
    const message = orderRef
      ? `¡Tu pedido ${orderRef} ha sido entregado con éxito! 📦✨\n\nEsperamos que te encante tu compra. Gracias por confiar en Cariana y ser parte de nuestra comunidad. 💙`
      : `¡Tu pedido ha sido entregado con éxito! 📦✨\n\nEsperamos que te encante tu compra. Gracias por confiar en Cariana y ser parte de nuestra comunidad. 💙`;

    return {
      title,
      message,
      statusLabel,
      productNames,
      productsInline
    };
  }

  if (templateCode === "order_not_delivered") {
    const orderRef = normalizedOrder ? `#${normalizedOrder}` : "#****";

    if (attemptCount >= 3) {
      const message = [
        `Pedido ${orderRef} 🚚 Realizamos el tercer y último intento de entrega de tu pedido, pero no fue posible localizarte en tu domicilio ni comunicarnos contigo.`,
        "Tu paquete ha sido resguardado en nuestra sucursal y estará disponible para su recolección durante los próximos 30 días naturales.",
        `📍 Dirección de la sucursal: ${branchAddress}`,
        `🕒 Horario de la sucursal: ${branchHours}`,
        "Para recoger tu pedido, será necesario presentar:",
        "✅ Número de pedido.",
        "✅ Clave de entrega.",
        `⚠️ Importante: Si tu pedido no es recogido antes del ${branchPickupDeadlineLabel || "plazo indicado"}, procederemos a cancelar tu pedido y realizar el reembolso correspondiente a tu método de pago original.`
      ].join("\n\n");

      return {
        title: "Tercer intento de entrega 📦❌",
        message,
        statusLabel,
        productNames,
        productsInline
      };
    }

    if (attemptCount === 2) {
      const message = orderRef
        ? `Pedido ${orderRef} 🚚. Reprogramado para el ${nextDeliveryDate}. Realizamos un segundo intento de entrega, pero no fue posible localizarte en tu domicilio ni comunicarnos contigo. Nuestro equipo realizará un último intento de entrega mañana, en un horario de ${deliveryHours}.\n\nImportante: Si durante este tercer intento tampoco logramos entregarte tu pedido, este será resguardado en nuestra sucursal para que puedas recogerlo personalmente dentro del plazo establecido.\n\n¡Gracias por tu comprensión! 😊`
        : `Pedido #**** 🚚. Reprogramado para el ${nextDeliveryDate}. Realizamos un segundo intento de entrega, pero no fue posible localizarte en tu domicilio ni comunicarnos contigo. Nuestro equipo realizará un último intento de entrega mañana, en un horario de ${deliveryHours}.\n\nImportante: Si durante este tercer intento tampoco logramos entregarte tu pedido, este será resguardado en nuestra sucursal para que puedas recogerlo personalmente dentro del plazo establecido.\n\n¡Gracias por tu comprensión! 😊`;

      return {
        title: "Segundo intento de entrega 📦⚠️",
        message,
        statusLabel,
        productNames,
        productsInline
      };
    }

    const message = orderRef
      ? `Pedido ${orderRef} 🚚. Reprogramado para el ${nextDeliveryDate}. Pasamos a tu domicilio, pero no tuvimos respuesta al tocar la puerta ni al intentar comunicarnos contigo. Nuestro equipo realizará un nuevo intento de entrega mañana, en un horario de ${deliveryHours}. 😉\n\n¡Gracias por tu comprensión!`
      : `Pedido #**** 🚚. Reprogramado para el ${nextDeliveryDate}. Pasamos a tu domicilio, pero no tuvimos respuesta al tocar la puerta ni al intentar comunicarnos contigo. Nuestro equipo realizará un nuevo intento de entrega mañana, en un horario de ${deliveryHours}. 😉\n\n¡Gracias por tu comprensión!`;

    return {
      title: "Pedido no entregado 📦❌",
      message,
      statusLabel,
      productNames,
      productsInline
    };
  }

  if (templateCode === "order_in_transit") {
    const orderRef = normalizedOrder ? `#${normalizedOrder}` : "#****";
    const message = `¡Tu pedido ${orderRef} ya está en camino! 🚚✨ Nuestro repartidor se dirige a tu ubicación. La entrega está programada para hoy antes de las ${deliveryCutoffTime}. No olvides darle tu clave de entrega al repartidor para recibir tu pedido.\n\nGracias por confiar en Cariana. 💙`;

    return {
      title,
      message,
      statusLabel,
      productNames,
      productsInline
    };
  }

  if (templateCode === "order_rescheduled") {
    const orderRef = normalizedOrder ? `#${normalizedOrder}` : "#****";
    const rescheduledDate = pickFirstString([
      payload?.rescheduledDateLabel,
      payload?.rescheduled_date_label,
      payload?.rescheduledDate,
      payload?.rescheduled_date
    ]);

    return {
      title: "Entrega reprogramada 🔄📦",
      message: `🚚 Pedido ${orderRef}. Tu pedido no pudo ser entregado el día de hoy debido al volumen de entregas programadas para hoy. Tu pedido ha sido reprogramado para mañana ${rescheduledDate} en un horario de ${deliveryHours}.\n\nAgradecemos tu comprensión y por confiar en siempre en Cariana. ✨`,
      statusLabel,
      productNames,
      productsInline
    };
  }

  const parts = [];
  if (normalizedOrder) {
    parts.push(`Pedido #${normalizedOrder}.`);
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
  const title = "Reembolso procesado";
  const orderLabel = normalizedOrder || "****";
  const parts = [
    `Pedido #${orderLabel}.`,
    "\uD83D\uDCB8 Tu reembolso ya fue procesado correctamente.",
    "Dependiendo de tu banco, el monto podr\u00E1 verse reflejado en tu cuenta dentro de 5 a 10 d\u00EDas h\u00E1biles.",
    "Gracias por confiar en Cariana. \uD83D\uDC99"
  ];

  return {
    title,
    message: parts.join(" "),
    statusLabel: fallbackTitle || "Reembolso procesado",
    productNames: [],
    productsInline: ""
  };
}

function isReturnPortalRefund(payload = {}) {
  const noteText = pickFirstString([
    payload?.note,
    payload?.reason,
    payload?.message
  ])
    .toLowerCase()
    .trim();

  if (!noteText) {
    return false;
  }

  return (
    noteText.includes("portal de devoluciones") ||
    noteText.includes("devolucion #") ||
    /devoluci[oó]n\s*#\d+/i.test(noteText)
  );
}

function isBranchPickupExpiredRefund(payload = {}) {
  const noteText = pickFirstString([
    payload?.note,
    payload?.reason,
    payload?.message
  ])
    .toLowerCase()
    .trim();

  if (!noteText) {
    return false;
  }

  return (
    noteText.includes("no recogido en sucursal") ||
    noteText.includes("pedido no recogido en sucursal") ||
    noteText.includes("reembolso por pedido no recogido en sucursal")
  );
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
  const context = extractOrderContext(topic, payload);
  let orderId = context.orderId;

  if (!orderId && topic === LOCAL_DELIVERY_READY_TOPIC) {
    const fulfillmentOrderId = parseLegacyNumericId(payload?.fulfillment_order?.id || payload?.fulfillmentOrder?.id);
    if (fulfillmentOrderId) {
      orderId = await fetchOrderIdFromFulfillmentOrder(shopDomain, fulfillmentOrderId);
    }

    // Fallback for stores where OAuth token has not been persisted yet:
    // infer the order from the latest local-delivery "preparing" event.
    if (!orderId) {
      orderId = await inferOrderIdFromRecentLocalDeliveryContext({ shopDomain, eventId });
    }
  }

  if (!orderId) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Order id not found in webhook payload', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Order id not found in webhook payload" };
  }

  const mappedOrder = await pool.query(
    `
    SELECT shopify_customer_id, order_number, last_status
    FROM order_customer_map
    WHERE shop_domain = $1 AND order_id = $2
    `,
    [shopDomain, orderId]
  );

  const existingMap = mappedOrder.rowCount > 0 ? mappedOrder.rows[0] : null;
  let effectivePayload = payload;

  if (topic === LOCAL_DELIVERY_READY_TOPIC) {
    const hydratedOrder = await fetchShopifyOrderById(shopDomain, orderId);
    if (hydratedOrder) {
      effectivePayload = hydratedOrder;
    }
  }

  if (topic.startsWith("orders/")) {
    await closeAbandonedCartsFromOrder({
      shopDomain,
      payload: effectivePayload
    });
  }

  const templateCode = resolveTemplateCodeFromOrder(topic, effectivePayload, existingMap);
  if (!templateCode) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true };
  }

  if (existingMap?.last_status && isStaleOrderTransition(existingMap.last_status, templateCode)) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Stale status transition', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Stale status transition" };
  }

  if (existingMap && existingMap.last_status === templateCode) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Duplicate status event', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Duplicate status event" };
  }

  if (
    templateCode === "order_in_transit" &&
    (await hasRecentOrderRescheduleNotification({
      shopDomain,
      orderId,
      orderNumber: effectivePayload.order_number || context.orderNumber || existingMap?.order_number || ""
    }))
  ) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Skipped in-route after recent route-time reschedule', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Skipped in-route after recent route-time reschedule" };
  }

  let customer = null;
  const customerIdFromPayload = effectivePayload.customer?.id || context.customerId || null;
  const customerIdFromMap = existingMap?.shopify_customer_id || null;
  const mappedCustomerId = customerIdFromPayload || customerIdFromMap;

  if (effectivePayload.customer?.id) {
    customer = await upsertCustomerFromShopify(shopDomain, effectivePayload.customer);
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
      orderId,
      mappedCustomerId || customer.shopify_customer_id,
      effectivePayload.order_number || context.orderNumber || existingMap?.order_number || null,
      templateCode
    ]
  );

  if (templateCode === "order_confirmed") {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Order confirmed notifications disabled', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Order confirmed notifications disabled" };
  }

  const template = await getTemplate(shopDomain, templateCode);
  if (!template) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Template not found', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Template not found" };
  }

  const returnSettings = await fetchReturnSettingsForShop(shopDomain, {
    allowCachedFallback: templateCode !== "order_preparing"
  });
  const webhookPickupHours = templateCode === "order_preparing"
    ? String(returnSettings?.pickupHours || "").trim()
    : pickFirstString([
        returnSettings?.pickupHours,
        effectivePayload.pickupHours,
        effectivePayload.pickup_hours
      ]);
  const payloadWithSettings = {
    ...effectivePayload,
    returnSettingsBranchAddress: returnSettings?.branchAddress,
    returnSettingsBranchHours: returnSettings?.branchHours,
    returnSettingsPickupHours: returnSettings?.pickupHours,
    branchAddress: returnSettings?.branchAddress ?? effectivePayload.branchAddress ?? effectivePayload.branch_address,
    branchHours: returnSettings?.branchHours ?? effectivePayload.branchHours ?? effectivePayload.branch_hours,
    pickupHours: webhookPickupHours
  };

  const copy = buildOrderNotificationCopy({
    templateCode,
    orderNumber: effectivePayload.order_number || context.orderNumber || existingMap?.order_number || "",
    payload: payloadWithSettings,
    fallbackTitle: template.title,
    fallbackMessage: template.message
  });

  const data = {
    orderId,
    orderNumber: effectivePayload.order_number || context.orderNumber || existingMap?.order_number || "",
    status: templateCode,
    statusLabel: copy.statusLabel,
    productName: copy.productsInline || "",
    productNames: copy.productNames || [],
    deepLinkType: "order",
    orderToken: effectivePayload.token || context.orderToken || "",
    orderStatusUrl: effectivePayload.order_status_url || context.orderStatusUrl || "",
    customerEmail: effectivePayload.customer?.email || ""
  };

  const effectiveOrderNumber =
    effectivePayload.order_number || context.orderNumber || existingMap?.order_number || "";
  const sendResult = await withOrderStatusNotificationLock(
    { shopDomain, orderId, orderNumber: effectiveOrderNumber, status: templateCode },
    async () => {
      const duplicated =
        DEDUPED_ORDER_STATUS_CODES.has(templateCode) &&
        (await hasRecentOrderStatusNotification({
          shopDomain,
          orderId,
          orderNumber: effectiveOrderNumber,
          status: templateCode
        }));
      if (duplicated) {
        return { sent: 0, failed: 0, total: 0, deduplicated: true, reason: "Duplicate recent order status" };
      }

      return sendToCustomerTokens({
        shopDomain,
        customerId: customer.id,
        type: "order_event",
        title: copy.title,
        message: copy.message,
        deepLink: buildOrderDeepLink({
          shopDomain,
          orderId,
          orderNumber: effectiveOrderNumber,
          orderToken: effectivePayload.token || context.orderToken || "",
          orderStatusUrl: effectivePayload.order_status_url || context.orderStatusUrl || "",
          deepLink: template.deep_link
        }),
        data,
        eventId
      });
    }
  );

  await pool.query(
    `
    UPDATE notification_events
    SET status = $2, processed_at = NOW(), error_message = $3
    WHERE id = $1
    `,
    [
      eventId,
      sendResult.total > 0 ? "processed" : "skipped",
      sendResult.deduplicated ? sendResult.reason : sendResult.total > 0 ? null : "No active tokens"
    ]
  );

  return sendResult;
}

async function sendManualOrderStatus({
  shopDomain,
  shopifyCustomerId,
  customerEmail,
  orderId,
  orderNumber,
  status,
  attemptCount,
  branchAddress,
  branchHours,
  pickupHours,
  branchPickupDeadlineAt,
  branchPickupDeadlineLabel,
  rescheduledDate,
  rescheduledDateLabel,
  title,
  message
}) {
  const templateCode = normalizeManualStatus(status);
  if (!validManualStatusCodes.has(templateCode)) {
    throw new Error("Unsupported order status");
  }

  let customer = null;
  if (shopifyCustomerId) {
    customer = await getCustomerByShopifyId(shopDomain, shopifyCustomerId);
  }
  if (!customer) {
    customer = await getCustomerByOrderReference({
      shopDomain,
      orderId,
      orderNumber
    });
  }
  if (!customer && customerEmail) {
    customer = await getCustomerByEmail(shopDomain, customerEmail);
  }
  if (!customer) {
    throw new Error("Customer not found");
  }

  const template = (await getTemplate(shopDomain, templateCode)) || defaultManualTemplates[templateCode] || null;
  if (!template) {
    throw new Error(`Template not found for ${templateCode}`);
  }

  const returnSettings = await fetchReturnSettingsForShop(shopDomain);
  const effectiveBranchAddress = branchAddress || returnSettings?.branchAddress;
  const effectiveBranchHours = branchHours || returnSettings?.branchHours;
  const effectivePickupHours = pickFirstString([pickupHours, returnSettings?.pickupHours]);
  if (branchAddress || branchHours || pickupHours) {
    await saveReturnNotificationSettings(shopDomain, {
      branchAddress: effectiveBranchAddress,
      branchHours: effectiveBranchHours,
      pickupHours: effectivePickupHours
    }).catch((error) => {
      console.warn("Failed to cache manual return settings", {
        shopDomain,
        error: String(error?.message || error || "unknown")
      });
    });
  }
  const copy = buildOrderNotificationCopy({
    templateCode,
    orderNumber,
    payload: {
      attemptCount,
      returnSettingsBranchAddress: returnSettings?.branchAddress,
      returnSettingsBranchHours: returnSettings?.branchHours,
      returnSettingsPickupHours: returnSettings?.pickupHours,
      branchAddress: effectiveBranchAddress,
      branchHours: effectiveBranchHours,
      pickupHours: effectivePickupHours,
      branchPickupDeadlineAt,
      branchPickupDeadlineLabel,
      rescheduledDate,
      rescheduledDateLabel,
      title,
      message
    },
    fallbackTitle: template.title,
    fallbackMessage: template.message
  });

  return withOrderStatusNotificationLock(
    { shopDomain, orderId, orderNumber, status: templateCode },
    async () => {
      const duplicated =
        DEDUPED_ORDER_STATUS_CODES.has(templateCode) &&
        (await hasRecentOrderStatusNotification({
          shopDomain,
          orderId,
          orderNumber,
          status: templateCode
        }));
      if (duplicated) {
        return { sent: 0, failed: 0, total: 0, deduplicated: true, reason: "Duplicate recent order status" };
      }

      return sendToCustomerTokens({
        shopDomain,
        customerId: customer.id,
        type: "order_manual",
        title: copy.title,
        message: copy.message,
        deepLink: buildOrderDeepLink({
          shopDomain,
          orderId,
          orderNumber,
          orderToken: "",
          orderStatusUrl: "",
          deepLink: template.deep_link
        }),
        data: {
          orderId,
          orderNumber,
          status: templateCode,
          attemptCount: Math.max(0, Number(attemptCount || 0) || 0),
          branchAddress: String(branchAddress || "").trim(),
          branchHours: String(branchHours || "").trim(),
          pickupHours: String(effectivePickupHours || "").trim(),
          branchPickupDeadlineAt: String(branchPickupDeadlineAt || "").trim(),
          branchPickupDeadlineLabel: String(branchPickupDeadlineLabel || "").trim(),
          rescheduledDate: String(rescheduledDate || "").trim(),
          rescheduledDateLabel: String(rescheduledDateLabel || "").trim(),
          statusLabel: copy.statusLabel,
          productName: copy.productsInline || "",
          productNames: copy.productNames || [],
          deepLinkType: "order"
        }
      });
    }
  );
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
  if (isBranchPickupExpiredRefund(payload)) {
    await pool.query(
      `UPDATE notification_events SET status = 'skipped', error_message = 'Branch pickup refund notification sent manually', processed_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { skipped: true, reason: "Branch pickup refund notification sent manually" };
  }

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

  const refundOrder = payload.order_id ? await fetchShopifyOrderById(shopDomain, payload.order_id) : null;
  const orderNumber = mapped.order_number || "";
  const customerEmail = pickFirstString([
    customer?.email,
    refundOrder?.email,
    refundOrder?.customer?.email
  ])
    .toLowerCase()
    .trim();
  const refundFromReturnsPortal = isReturnPortalRefund(payload);
  const notificationType = refundFromReturnsPortal ? "return_event" : "refund_event";
  const deepLink = refundFromReturnsPortal
    ? buildReturnDeepLink({
        shopDomain,
        orderNumber,
        email: customerEmail,
        deepLink: ""
      })
    : buildOrderDeepLink({
        shopDomain,
        orderId: payload.order_id,
        orderNumber,
        orderToken: refundOrder?.token || "",
        orderStatusUrl: refundOrder?.order_status_url || "",
        deepLink: template.deep_link
      });

  const sendResult = await sendToCustomerTokens({
    shopDomain,
    customerId: customer.id,
    type: notificationType,
    title: copy.title,
    message: copy.message,
    deepLink,
    data: {
      orderId: payload.order_id,
      orderNumber,
      orderToken: refundOrder?.token || "",
      orderStatusUrl: refundOrder?.order_status_url || "",
      refundId: payload.id || "",
      statusLabel: copy.statusLabel,
      productName: "",
      productNames: [],
      deepLinkType: refundFromReturnsPortal ? "return" : "order",
      deeplinkType: refundFromReturnsPortal ? "return" : "order",
      linkType: refundFromReturnsPortal ? "return" : "order",
      notificationType: refundFromReturnsPortal ? "return_event" : "refund_event",
      eventType: refundFromReturnsPortal ? "return_event" : "refund_event",
      route: refundFromReturnsPortal ? "returns" : "orders",
      openScreen: refundFromReturnsPortal ? "returns_portal" : "orders"
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

async function getLatestOrderNotification({ shopDomain, orderNumber }) {
  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
  if (!shopDomain || !normalizedOrderNumber) return null;

  const result = await pool.query(
    `
    SELECT n.id, n.title, n.message, n.data, n.created_at
    FROM notifications n
    WHERE n.shop_domain = $1
      AND n.status = 'sent'
      AND n.type IN ('order_event', 'order_manual')
      AND regexp_replace(COALESCE(n.data->>'orderNumber', ''), '\\D', '', 'g') = $2
      AND COALESCE(n.data->>'status', '') <> 'order_delivered'
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 1
    `,
    [shopDomain, normalizedOrderNumber]
  );

  const row = result.rows[0];
  if (!row) return null;
  const createdAt = row.created_at ? new Date(row.created_at).toISOString() : "";
  const createdAtLabel = formatNotificationSentAt(row.created_at);
  const message = row.message || "";
  const orderDetailLineBreakSpacer = "\u2003".repeat(10);
  return {
    id: row.id,
    title: row.title || "",
    message: createdAtLabel ? `${createdAtLabel}${orderDetailLineBreakSpacer}${message}` : message,
    rawMessage: message,
    createdAt,
    createdAtLabel,
  };
}

module.exports = {
  getLatestOrderNotification,
  processOrderWebhook,
  sendManualOrderStatus,
  processRefundWebhook
};

