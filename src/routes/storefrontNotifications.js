const express = require("express");
const pool = require("../db/pool");
const env = require("../config/env");
const { verifyAppProxySignature } = require("../services/shopifyAppProxyVerifier");
const { buildOrderDeepLink, buildLegacyOrderFallbackDeepLink, toAbsoluteStorefrontUrl } = require("../services/deepLinkService");
const { recordAbandonedCartActivity } = require("../services/abandonedCartService");

const router = express.Router();
const DISPLAY_TIME_ZONE = env.notificationsDisplayTimezone || "America/Mexico_City";

function extractQueryString(req) {
  const parts = req.originalUrl.split("?");
  return parts.length > 1 ? parts[1] : "";
}

function requireValidProxy(req, res, next) {
  const verified = verifyAppProxySignature(extractQueryString(req));
  if (!verified) {
    return res.status(401).send("Invalid app proxy signature");
  }
  return next();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeTrim(value) {
  return String(value || "").trim();
}

function normalizeShopDomain(value) {
  return safeTrim(value).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function appendQueryParams(urlString, params) {
  const validEntries = Object.entries(params).filter(([, value]) => safeTrim(value));
  if (!validEntries.length) {
    return urlString;
  }
  try {
    const parsed = new URL(urlString);
    for (const [key, value] of validEntries) {
      parsed.searchParams.set(key, safeTrim(value));
    }
    return parsed.toString();
  } catch (_error) {
    const query = validEntries
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(safeTrim(value))}`)
      .join("&");
    const separator = urlString.includes("?") ? "&" : "?";
    return `${urlString}${separator}${query}`;
  }
}

function buildReturnsPortalUrl({ shopDomain, orderNumber, email }) {
  const configuredPortal = safeTrim(process.env.RETURNS_PORTAL_URL || env.returnsPortalUrl || "");
  const basePortalUrl = configuredPortal
    ? configuredPortal.replace(/\/+$/, "")
    : "https://gestion-devoluciones-pro.onrender.com/devoluciones";

  return appendQueryParams(basePortalUrl, {
    shop: normalizeShopDomain(shopDomain),
    order: safeTrim(orderNumber).replace(/^#/, ""),
    email: safeTrim(email).toLowerCase()
  });
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function parseOrderId(value) {
  const text = safeTrim(value);
  if (!text) {
    return "";
  }
  if (/^\d+$/.test(text)) {
    return text;
  }
  const match = text.match(/(\d+)(?!.*\d)/);
  return match ? match[1] : "";
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
    return "";
  }
  return safeTrim(result.rows[0].access_token || "");
}

async function fetchOrderSnapshot({ shopDomain, orderId }) {
  const normalizedOrderId = parseOrderId(orderId);
  if (!normalizedOrderId) {
    return null;
  }

  const accessToken = await getShopAccessToken(shopDomain);
  if (!accessToken) {
    return null;
  }

  const apiVersion = "2026-04";
  const fields = ["id", "order_number", "order_status_url", "token"].join(",");
  const url = `https://${shopDomain}/admin/api/${apiVersion}/orders/${normalizedOrderId}.json?status=any&fields=${fields}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.order || null;
}

async function fetchOrderSnapshotFromEvents({ shopDomain, orderId }) {
  const normalizedOrderId = parseOrderId(orderId);
  if (!normalizedOrderId) {
    return null;
  }

  const result = await pool.query(
    `
    SELECT payload
    FROM notification_events
    WHERE shop_domain = $1
      AND topic IN ('orders/create','orders/updated','orders/fulfilled','fulfillment_orders/line_items_prepared_for_local_delivery')
      AND (
        payload->>'id' = $2
        OR payload->>'order_id' = $2
        OR payload->'order'->>'id' = $2
      )
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [shopDomain, normalizedOrderId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const payload = result.rows[0].payload || {};
  return {
    order_number: payload.order_number || payload.order?.order_number || "",
    token: payload.token || payload.order_token || payload.order?.token || payload.order?.order_token || "",
    order_status_url:
      payload.order_status_url || payload.orderStatusUrl || payload.order?.order_status_url || payload.order?.orderStatusUrl || ""
  };
}

function buildOrderTargetUrl({ shopDomain, orderId, orderNumber, orderToken, orderStatusUrl }) {
  const statusUrl = safeTrim(orderStatusUrl);
  if (statusUrl) {
    return toAbsoluteStorefrontUrl(shopDomain, statusUrl);
  }

  const token = safeTrim(orderToken);
  if (token) {
    const normalizedShop = normalizeShopDomain(shopDomain);
    const base = normalizedShop ? `https://${normalizedShop}` : "";
    const path = `/orders/${encodeURIComponent(token)}`;
    return base ? `${base}${path}` : path;
  }

  return buildLegacyOrderFallbackDeepLink({
    shopDomain,
    orderId: parseOrderId(orderId),
    orderNumber
  });
}

async function markOpenedByReturnContext({ shopDomain, orderNumber, email }) {
  const normalizedOrder = safeTrim(orderNumber).replace(/^#/, "");
  const normalizedEmail = safeTrim(email).toLowerCase();
  if (!shopDomain || (!normalizedOrder && !normalizedEmail)) return;

  await pool.query(
    `
    WITH candidates AS (
      SELECT n.id
      FROM notifications n
      WHERE n.shop_domain = $1
        AND n.status = 'sent'
        AND n.opened_at IS NULL
        AND n.type IN ('return_event', 'refund_event')
        AND (
          ($2 <> '' AND (
            COALESCE(n.data->>'orderNumber', '') = $2
            OR COALESCE(n.data->>'returnReference', '') = $2
          ))
          OR ($3 <> '' AND LOWER(COALESCE(n.data->>'customerEmail', '')) = $3)
        )
      ORDER BY n.created_at DESC
      LIMIT 20
    )
    UPDATE notifications n
    SET opened_at = COALESCE(n.opened_at, NOW()), updated_at = NOW()
    FROM candidates c
    WHERE n.id = c.id
    `,
    [shopDomain, normalizedOrder, normalizedEmail]
  );
}

async function markOpenedByOrderContext({ shopDomain, orderNumber }) {
  const normalizedOrder = safeTrim(orderNumber).replace(/^#/, "");
  if (!shopDomain || !normalizedOrder) return;

  await pool.query(
    `
    WITH candidates AS (
      SELECT n.id
      FROM notifications n
      WHERE n.shop_domain = $1
        AND n.status = 'sent'
        AND n.opened_at IS NULL
        AND n.type IN ('order_event', 'order_manual', 'refund_event')
        AND COALESCE(n.data->>'orderNumber', '') = $2
      ORDER BY n.created_at DESC
      LIMIT 20
    )
    UPDATE notifications n
    SET opened_at = COALESCE(n.opened_at, NOW()), updated_at = NOW()
    FROM candidates c
    WHERE n.id = c.id
    `,
    [shopDomain, normalizedOrder]
  );
}

async function markOpenedByCampaignContext({ shopDomain, campaignId, targetUrl, shopifyCustomerId }) {
  const normalizedCampaignId = Number(campaignId || 0);
  const normalizedTargetUrl = safeTrim(targetUrl);
  if (!normalizedCampaignId && !normalizedTargetUrl) return;

  const customerContext = await resolveCustomerContext(shopDomain, shopifyCustomerId);
  const currentCustomerId = Number(customerContext.customerId || 0);
  const currentCustomerEmail = safeTrim(customerContext.customerEmail).toLowerCase();
  const effectiveShopDomain = safeTrim(customerContext.effectiveShopDomain || shopDomain);

  if (!currentCustomerId && !currentCustomerEmail) return;

  if (effectiveShopDomain) {
    await pool.query(
    `
    WITH candidates AS (
      SELECT n.id
      FROM notifications n
      WHERE n.shop_domain = $1
        AND n.status = 'sent'
        AND n.opened_at IS NULL
        AND n.type = 'campaign'
        AND (
          ($2 > 0 AND n.customer_id = $2)
          OR ($3 <> '' AND LOWER(COALESCE(n.data->>'customerEmail', '')) = $3)
        )
        AND (
          ($4 > 0 AND (n.campaign_id = $4 OR COALESCE(n.data->>'campaignId', '') = $4::text))
          OR ($5 <> '' AND COALESCE(n.deep_link, '') = $5)
        )
      ORDER BY n.created_at DESC
      LIMIT 20
    )
    UPDATE notifications n
    SET opened_at = COALESCE(n.opened_at, NOW()), updated_at = NOW()
    FROM candidates c
    WHERE n.id = c.id
    `,
      [effectiveShopDomain, currentCustomerId, currentCustomerEmail, normalizedCampaignId, normalizedTargetUrl]
    );
    return;
  }

  await pool.query(
    `
    WITH candidates AS (
      SELECT n.id
      FROM notifications n
      WHERE n.status = 'sent'
        AND n.opened_at IS NULL
        AND n.type = 'campaign'
        AND (
          ($1 > 0 AND n.customer_id = $1)
          OR ($2 <> '' AND LOWER(COALESCE(n.data->>'customerEmail', '')) = $2)
        )
        AND (
          ($3 > 0 AND (n.campaign_id = $3 OR COALESCE(n.data->>'campaignId', '') = $3::text))
          OR ($4 <> '' AND COALESCE(n.deep_link, '') = $4)
        )
      ORDER BY n.created_at DESC
      LIMIT 20
    )
    UPDATE notifications n
    SET opened_at = COALESCE(n.opened_at, NOW()), updated_at = NOW()
    FROM candidates c
    WHERE n.id = c.id
    `,
    [currentCustomerId, currentCustomerEmail, normalizedCampaignId, normalizedTargetUrl]
  );
}

function resolveNotificationDeepLink({ shopDomain, item }) {
  const rawData = item?.data && typeof item.data === "object" ? item.data : {};
  const type = safeTrim(item?.type);
  const deepLinkType = safeTrim(rawData.deepLinkType || rawData.deeplinkType || rawData.linkType);
  const isOrderLike = ["order_event", "order_manual", "refund_event"].includes(type) || deepLinkType === "order";
  const existing = safeTrim(item?.deep_link);

  if (!isOrderLike) {
    return existing;
  }

  const generated = buildOrderDeepLink({
    shopDomain,
    orderId: rawData.orderId || rawData.order_id || "",
    orderNumber: rawData.orderNumber || rawData.order_number || "",
    orderToken: rawData.orderToken || rawData.order_token || "",
    orderStatusUrl: rawData.orderStatusUrl || rawData.order_status_url || "",
    deepLink: ""
  });

  return safeTrim(generated) || existing;
}

function expandStoredNotificationMessage(item) {
  const message = String(item?.message || "");
  if (!/\.\.\.\s*$/.test(message)) {
    return message;
  }

  const title = String(item?.title || "").toLowerCase();
  if (!title.includes("intento de recolecci")) {
    return message;
  }

  const failedPickupText =
    "No logramos completar la recolección. 🚚 Visitamos tu domicilio, pero no obtuvimos respuesta al tocar la puerta ni al comunicarnos contigo. Nuestro equipo volverá a intentarlo mañana. 📦✨";
  const failedPickupTextNoAccent =
    "No logramos completar la recoleccion. 🚚 Visitamos tu domicilio, pero no obtuvimos respuesta al tocar la puerta ni al comunicarnos contigo. Nuestro equipo volvera a intentarlo mañana. 📦✨";
  const prefix = message.split(/No logramos completar la recolecci[oó]n\./i)[0] || "";
  const hasAccent = /recolección/i.test(message);
  return `${prefix}${hasAccent ? failedPickupText : failedPickupTextNoAccent}`;
}

function normalizeNotificationItem(item) {
  return {
    ...item,
    message: expandStoredNotificationMessage(item)
  };
}

function renderItemsHtml(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div class="item"><div class="msg">Aun no tienes notificaciones.</div></div>';
  }

  const formatNotificationDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return new Intl.DateTimeFormat("es-MX", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: DISPLAY_TIME_ZONE
    })
      .format(date)
      .replace(".", "")
      .replace(",", "")
      .toLowerCase();
  };

  return items
    .map((rawItem) => {
      const item = normalizeNotificationItem(rawItem);
      const unread = !item.opened_at;
      const deepLink = item.deep_link
        ? `<div class="meta"><a class="link" href="${escapeHtml(item.deep_link)}">Abrir</a></div>`
        : "";

      return `
      <div class="item" data-id="${Number(item.id)}" data-unread="${unread ? "1" : "0"}">
        <h3 class="title">
          ${escapeHtml(item.title)}
          ${unread ? '<span class="badge new">Nueva</span>' : ""}
        </h3>
        <div class="meta">${escapeHtml(formatNotificationDate(item.created_at))}</div>
        <div class="msg">${escapeHtml(item.message || "")}</div>
        ${deepLink}
      </div>`;
    })
    .join("");
}

function renderShellHtml({ shop, customerId, initialHistory = [], initialUnread = 0, homeUrl = "/" }) {
  const safeShop = JSON.stringify(shop || "");
  const safeCustomerId = JSON.stringify(customerId || "");
  const safeInitialHistory = JSON.stringify(initialHistory || []);
  const safeInitialUnread = Number(initialUnread) || 0;
  const safeDisplayTimeZone = JSON.stringify(DISPLAY_TIME_ZONE);
  const safeHomeUrl = escapeHtml(homeUrl || "/");
  const serverSummary = `Total: ${initialHistory.length} | No leidas: ${safeInitialUnread}`;
  const serverItems = renderItemsHtml(initialHistory);

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Notificaciones</title>
    <style>
      :root {
        --bg: #f5f7fb;
        --card: #ffffff;
        --text: #111827;
        --muted: #6b7280;
        --brand: #005bd3;
        --border: #e5e7eb;
      }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .wrap {
        max-width: 720px;
        margin: 0 auto;
        padding: 12px 16px 16px;
      }
      h1 {
        font-size: 22px;
        margin: 0 0 4px;
      }
      .home-action {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-height: 30px;
        margin: 0 0 6px;
        padding: 4px 7px;
        border-radius: 8px;
        background: var(--brand);
        color: #fff;
        font-size: 14px;
        font-weight: 700;
        line-height: 1;
        text-decoration: none;
        box-sizing: border-box;
      }
      .home-action:active {
        transform: translateY(1px);
      }
      .home-action-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        line-height: 0.72;
        transform: translateY(-5px);
      }
      .muted {
        color: var(--muted);
        font-size: 14px;
      }
      .toolbar {
        margin-top: 12px;
        display: flex;
        gap: 8px;
      }
      button {
        border: 0;
        border-radius: 10px;
        background: var(--brand);
        color: white;
        padding: 10px 12px;
        cursor: pointer;
      }
      .list {
        margin-top: 8px;
        display: grid;
        gap: 10px;
      }
      .item {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 12px;
      }
      .title {
        margin: 0;
        font-size: 16px;
      }
      .meta {
        color: var(--muted);
        font-size: 12px;
        margin-top: 4px;
      }
      .msg {
        margin-top: 8px;
        font-size: 14px;
        white-space: pre-wrap;
      }
      .badge {
        display: inline-block;
        font-size: 11px;
        border-radius: 999px;
        padding: 3px 8px;
        margin-left: 8px;
        border: 1px solid var(--border);
        color: var(--muted);
      }
      .badge.new {
        color: white;
        border-color: var(--brand);
        background: var(--brand);
      }
      a.link {
        color: var(--brand);
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Notificaciones</h1>
      <a class="home-action" href="${safeHomeUrl}" aria-label="Ir al inicio de la tienda">
        <span class="home-action-icon" aria-hidden="true">←</span>
        <span>Inicio</span>
      </a>
      <div class="list" id="list">${serverItems}</div>
    </div>

    <script>
      const SHOP = ${safeShop};
      const CUSTOMER_ID = ${safeCustomerId};
      const INITIAL_HISTORY = ${safeInitialHistory};

      const listEl = document.getElementById("list");
      const basePath = window.location.pathname.replace(/\/$/, "");
      const DISPLAY_TIME_ZONE = ${safeDisplayTimeZone};
      const proxyQuery = window.location.search || "";

      function withProxyQuery(path) {
        if (!proxyQuery) return basePath + path;
        const separator = path.includes("?") ? "&" : "?";
        return basePath + path + separator + proxyQuery.replace(/^\?/, "");
      }

      function fmtDate(value) {
        const d = new Date(value);
        if (isNaN(d.getTime())) return value;
        return new Intl.DateTimeFormat("es-MX", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: DISPLAY_TIME_ZONE
        })
          .format(d)
          .replace(".", "")
          .replace(",", "")
          .toLowerCase();
      }

      function escapeHtmlClient(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function renderHistory(history, unreadCount) {
        listEl.innerHTML = "";
        if (!history.length) {
          const empty = document.createElement("div");
          empty.className = "item";
          empty.innerHTML = '<div class="msg">Aun no tienes notificaciones.</div>';
          listEl.appendChild(empty);
          return;
        }

        for (const item of history) {
          const div = document.createElement("div");
          div.className = "item";
          div.dataset.id = String(item.id);
          const unread = !item.opened_at;
          div.dataset.unread = unread ? "1" : "0";

          div.innerHTML = \`
            <h3 class="title">
              \${escapeHtmlClient(item.title)}
              \${unread ? '<span class="badge new">Nueva</span>' : ""}
            </h3>
            <div class="meta">\${fmtDate(item.created_at)}</div>
            <div class="msg">\${escapeHtmlClient(item.message || "")}</div>
            \${item.deep_link ? '<div class="meta"><a class="link" href="' + escapeHtmlClient(item.deep_link) + '">Abrir</a></div>' : ""}
          \`;

          const linkEl = div.querySelector("a.link");
          if (linkEl) {
            linkEl.addEventListener("click", async (event) => {
              event.preventDefault();
              event.stopPropagation();
              try {
                if (window.Android && typeof window.Android.dismissNotificationByUrl === "function") {
                  window.Android.dismissNotificationByUrl(linkEl.href);
                }
              } catch (_nativeError) {
                // Continue even if native bridge is unavailable.
              }
              if (div.dataset.unread === "1") {
                try {
                  await markOpened(item.id);
                } catch (_error) {
                  // Continue navigation even if mark-open request fails.
                }
              }
              window.location.href = linkEl.href;
            });
          }

          div.addEventListener("click", async () => {
            if (div.dataset.unread === "1") {
              await markOpened(item.id);
              await load();
            }
          });

          listEl.appendChild(div);
        }
      }

      async function markOpened(id) {
        const response = await fetch(withProxyQuery("/open"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ id })
        });
        if (!response.ok) {
          throw new Error("No se pudo marcar como leida");
        }
      }

      async function load() {
        try {
          const response = await fetch(withProxyQuery("/list"));
          if (!response.ok) {
            throw new Error("No se pudo cargar el historial");
          }
          const data = await response.json();
          const history = data.history || [];
          renderHistory(history, data.unread || 0);
        } catch (error) {
          listEl.innerHTML = "";
          const err = document.createElement("div");
          err.className = "item";
          err.innerHTML = '<div class="msg">Intenta de nuevo en unos segundos.</div>';
          listEl.appendChild(err);
          console.error(error);
        }
      }

      renderHistory(INITIAL_HISTORY, ${safeInitialUnread});
    </script>
  </body>
</html>`;
}

async function getNotificationsByCustomer(shopDomain, shopifyCustomerId) {
  if (!shopDomain || !shopifyCustomerId) {
    return { history: [], unread: 0 };
  }

  const context = await resolveCustomerContext(shopDomain, shopifyCustomerId);
  const currentCustomerId = context.customerId;
  const currentCustomerEmail = context.customerEmail;
  const effectiveShopDomain = context.effectiveShopDomain || safeTrim(shopDomain);

  if (!currentCustomerId && !currentCustomerEmail) {
    return { history: [], unread: 0 };
  }

  const history = await pool.query(
    `
    SELECT n.id, n.type, n.title, n.message, n.deep_link, n.data, n.status, n.created_at, n.opened_at
    FROM notifications n
    LEFT JOIN customers c ON c.id = n.customer_id
    WHERE n.status = 'sent'
      AND (
        (
          n.shop_domain = $1
          AND (
            ($2 > 0 AND n.customer_id = $2)
            OR ($3 <> '' AND LOWER(COALESCE(n.data->>'customerEmail', c.email, '')) = $3)
          )
        )
        OR (
          $3 <> ''
          AND n.type = 'return_event'
          AND LOWER(COALESCE(n.data->>'customerEmail', c.email, '')) = $3
        )
        OR (
          n.shop_domain = $1
          AND n.type = 'return_event'
          AND EXISTS (
            SELECT 1
            FROM order_customer_map ocm
            WHERE ocm.shop_domain = $1
              AND ocm.shopify_customer_id = $4
              AND ocm.order_number = REPLACE(COALESCE(n.data->>'orderNumber', n.data->>'returnReference', ''), '#', '')
          )
        )
      )
    ORDER BY n.created_at DESC
    LIMIT 50
    `,
    [effectiveShopDomain, currentCustomerId, currentCustomerEmail, Number(shopifyCustomerId)]
  );

  const rows = history.rows.map((row) => ({
    ...normalizeNotificationItem(row),
    deep_link: resolveNotificationDeepLink({
      shopDomain,
      item: row
    })
  }));

  const unread = rows.reduce((acc, row) => acc + (row.opened_at ? 0 : 1), 0);
  return { history: rows, unread };
}

async function getUnreadCountByToken(shopDomain, pushToken) {
  const normalizedToken = safeTrim(pushToken);
  if (!normalizedToken) {
    return 0;
  }

  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS unread
    FROM notifications n
    JOIN fcm_tokens t ON t.id = n.fcm_token_id
    WHERE n.status = 'sent'
      AND n.opened_at IS NULL
      AND t.token = $1
    `,
    [normalizedToken]
  );
  return result.rows[0]?.unread || 0;
}

async function getUnreadCount(shopDomain, shopifyCustomerId, pushToken) {
  if (!shopDomain && !shopifyCustomerId && !pushToken) {
    return 0;
  }

  const context = await resolveCustomerContext(shopDomain, shopifyCustomerId);
  const currentCustomerId = context.customerId;
  const currentCustomerEmail = context.customerEmail;
  const effectiveShopDomain = context.effectiveShopDomain || safeTrim(shopDomain);

  if (!currentCustomerId && !currentCustomerEmail) {
    return getUnreadCountByToken(effectiveShopDomain, pushToken);
  }

  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS unread
    FROM notifications n
    LEFT JOIN customers c ON c.id = n.customer_id
    WHERE n.status = 'sent'
      AND n.opened_at IS NULL
      AND (
        (
          n.shop_domain = $1
          AND (
            ($2 > 0 AND n.customer_id = $2)
            OR ($3 <> '' AND LOWER(COALESCE(n.data->>'customerEmail', c.email, '')) = $3)
          )
        )
        OR (
          $3 <> ''
          AND n.type = 'return_event'
          AND LOWER(COALESCE(n.data->>'customerEmail', c.email, '')) = $3
        )
        OR (
          n.shop_domain = $1
          AND n.type = 'return_event'
          AND EXISTS (
            SELECT 1
            FROM order_customer_map ocm
            WHERE ocm.shop_domain = $1
              AND ocm.shopify_customer_id = $4
              AND ocm.order_number = REPLACE(COALESCE(n.data->>'orderNumber', n.data->>'returnReference', ''), '#', '')
          )
        )
      )
    `,
    [effectiveShopDomain, currentCustomerId, currentCustomerEmail, Number(shopifyCustomerId)]
  );
  const unread = result.rows[0]?.unread || 0;
  if (unread > 0) {
    return unread;
  }

  return getUnreadCountByToken(effectiveShopDomain, pushToken);
}

function resolveShopDomain(req) {
  return req.query.shop || req.header("x-shopify-shop-domain") || "";
}

function resolveCustomerId(req) {
  return req.query.logged_in_customer_id || req.query.cid || "";
}

async function resolveCustomerContext(shopDomain, shopifyCustomerId) {
  const numericCustomerId = Number(shopifyCustomerId || 0);
  const normalizedShop = safeTrim(shopDomain);
  if (!numericCustomerId) {
    return {
      customerId: 0,
      customerEmail: "",
      effectiveShopDomain: normalizedShop
    };
  }

  const exactMatch = await pool.query(
    `
    SELECT id, LOWER(COALESCE(email, '')) AS email, shop_domain
    FROM customers
    WHERE shop_domain = $1
      AND shopify_customer_id = $2
    LIMIT 1
    `,
    [normalizedShop, numericCustomerId]
  );

  if (exactMatch.rowCount > 0) {
    return {
      customerId: Number(exactMatch.rows[0].id || 0),
      customerEmail: String(exactMatch.rows[0].email || "").trim().toLowerCase(),
      effectiveShopDomain: normalizedShop || String(exactMatch.rows[0].shop_domain || "").trim().toLowerCase()
    };
  }

  // Fallback when the store's myshopify alias changed.
  const fallbackMatch = await pool.query(
    `
    SELECT id, LOWER(COALESCE(email, '')) AS email, shop_domain
    FROM customers
    WHERE shopify_customer_id = $1
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [numericCustomerId]
  );

  if (fallbackMatch.rowCount > 0) {
    return {
      customerId: Number(fallbackMatch.rows[0].id || 0),
      customerEmail: String(fallbackMatch.rows[0].email || "").trim().toLowerCase(),
      effectiveShopDomain: String(fallbackMatch.rows[0].shop_domain || "").trim().toLowerCase()
    };
  }

  return {
    customerId: 0,
    customerEmail: "",
    effectiveShopDomain: normalizedShop
  };
}

router.get("/badge", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = resolveShopDomain(req);
    const shopifyCustomerId = resolveCustomerId(req);
    const pushToken = req.query.pt || req.query.push_token || "";
    const customerContext = await resolveCustomerContext(shopDomain, shopifyCustomerId);
    const unread = await getUnreadCount(shopDomain, shopifyCustomerId, pushToken);
    return res.json({
      unread,
      hasCustomerContext: Boolean(customerContext.customerId || customerContext.customerEmail),
      hasTokenContext: Boolean(safeTrim(pushToken)),
      notificationsUrl: "/apps/notificaciones"
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/cart-event", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = resolveShopDomain(req);
    if (!shopDomain) {
      return res.status(400).json({ error: "Missing shop" });
    }

    const queryCustomerId = resolveCustomerId(req);
    const bodyCustomerId = req.body?.customerId || req.body?.shopifyCustomerId || "";
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const result = await recordAbandonedCartActivity({
      shopDomain,
      cartToken: payload.cartToken || payload.cart?.token || payload.cart?.cart_token || "",
      shopifyCustomerId: queryCustomerId || bodyCustomerId,
      email: payload.email || payload.cart?.email || "",
      payload
    });

    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.get("/widget.js", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = req.query.shop || "";
    const shopifyCustomerId = req.query.logged_in_customer_id || "";
    const unread = await getUnreadCount(shopDomain, shopifyCustomerId);
    const customerHint = String(shopifyCustomerId || "");
    const shopCacheKey = String(shopDomain || "").trim().toLowerCase() || "default";

    const js = `
(function() {
  if (window.__carianaBellInit) return;
  window.__carianaBellInit = true;

  var unread = ${Number(unread) || 0};
  var customerHint = ${JSON.stringify(customerHint)};
  var shopCacheKey = ${JSON.stringify(shopCacheKey)};
  var badgeCacheKey = "cariana_noti_badge_v1:" + shopCacheKey;
  var pushToken = "";
  var url = "/apps/notificaciones" + (customerHint ? ("?cid=" + encodeURIComponent(customerHint)) : "");
  var lastCartEventHash = "";
  var lastCartEventAt = 0;
  var ensureTimer = 0;
  var blankPanelCleanupTimer = 0;

  function readBadgeCache() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(badgeCacheKey) : "";
      if (!raw) return { unread: 0, customerHint: "" };
      var parsed = JSON.parse(raw);
      return {
        unread: Number(parsed && parsed.unread) || 0,
        customerHint: normalizeCustomerId(parsed && parsed.customerHint)
      };
    } catch (_err) {
      return { unread: 0, customerHint: "" };
    }
  }

  function writeBadgeCache() {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(
        badgeCacheKey,
        JSON.stringify({
          unread: Number(unread) || 0,
          customerHint: customerHint || ""
        })
      );
    } catch (_err) {}
  }

  function normalizeCustomerId(value) {
    var text = String(value == null ? "" : value).trim();
    return /^\\d+$/.test(text) ? text : "";
  }

  function detectCustomerIdFromStorefront() {
    try {
      var fromAnalytics = window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.page &&
        window.ShopifyAnalytics.meta.page.customerId;
      var cid = normalizeCustomerId(fromAnalytics);
      if (cid) return cid;
    } catch (_err1) {}

    try {
      var fromSt = window.__st && window.__st.cid;
      var cid2 = normalizeCustomerId(fromSt);
      if (cid2) return cid2;
    } catch (_err2) {}

    try {
      if (window.Android && typeof window.Android.getPushCustomerId === "function") {
        var fromAndroid = normalizeCustomerId(window.Android.getPushCustomerId());
        if (fromAndroid) return fromAndroid;
      }
    } catch (_err3) {}

    return "";
  }

  function detectPushTokenFromAndroid() {
    try {
      if (window.Android && typeof window.Android.getPushToken === "function") {
        var token = String(window.Android.getPushToken() || "").trim();
        if (token) return token;
      }
    } catch (_err4) {}
    return "";
  }

  function detectTrayUnreadFromAndroid() {
    try {
      if (window.Android && typeof window.Android.getTrayNotificationCount === "function") {
        var value = Number(window.Android.getTrayNotificationCount());
        if (!isNaN(value) && value >= 0) return value;
      }
    } catch (_err5) {}
    return -1;
  }

  function ensureCustomerHint() {
    if (!customerHint) {
      customerHint = detectCustomerIdFromStorefront();
      if (customerHint) {
        url = "/apps/notificaciones?cid=" + encodeURIComponent(customerHint);
        var bell = document.getElementById("cariana-noti-bell");
        if (bell) {
          bell.href = url;
        }
        writeBadgeCache();
      }
    }
    return customerHint;
  }

  function updateBadge(count) {
    unread = Number(count) || 0;
    var bell = document.getElementById("cariana-noti-bell");
    if (!bell) return;

    var badge = document.getElementById("cariana-noti-badge");
    if (unread <= 0) {
      if (badge && badge.parentElement) {
        badge.parentElement.removeChild(badge);
      }
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.id = "cariana-noti-badge";
      bell.appendChild(badge);
    }

    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.style.setProperty("position", "absolute", "important");
    badge.style.setProperty("top", "-6px", "important");
    badge.style.setProperty("right", "-8px", "important");
    badge.style.setProperty("min-width", "18px", "important");
    badge.style.setProperty("height", "18px", "important");
    badge.style.setProperty("padding", "0 4px", "important");
    badge.style.setProperty("border-radius", "999px", "important");
    badge.style.setProperty("background", "#ef4444", "important");
    badge.style.setProperty("color", "#ffffff", "important");
    badge.style.setProperty("font-size", "11px", "important");
    badge.style.setProperty("font-family", "Arial, sans-serif", "important");
    badge.style.setProperty("font-weight", "700", "important");
    badge.style.setProperty("line-height", "18px", "important");
    badge.style.setProperty("text-align", "center", "important");
    badge.style.setProperty("display", "inline-flex", "important");
    badge.style.setProperty("align-items", "center", "important");
    badge.style.setProperty("justify-content", "center", "important");
    badge.style.setProperty("box-sizing", "border-box", "important");
  }

  function createBellElement() {
    var a = document.createElement("a");
    a.href = url;
    a.id = "cariana-noti-bell";
    a.setAttribute("aria-label", "Notificaciones");
    a.style.cssText = "position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;margin-left:10px;text-decoration:none;color:inherit;flex:0 0 auto;";

    var icon = document.createElement("span");
    icon.textContent = "\uD83D\uDD14";
    icon.style.cssText = "font-size:22px;line-height:1;display:inline-block;";
    a.appendChild(icon);

    updateBadge(unread);
    return a;
  }

  function findHeaderTarget() {
    var selectors = [
      ".header__icons",
      ".site-header__icons",
      ".header-icons",
      ".header__actions",
      ".header__inline-menu",
      ".header-wrapper .list-menu",
      "header .list-menu",
      "header .header",
      "header .container",
      "header"
    ];
    for (var i = 0; i < selectors.length; i++) {
      var node = document.querySelector(selectors[i]);
      if (node) return node;
    }
    return null;
  }

  function attachBell() {
    var existing = document.getElementById("cariana-noti-bell");
    var target = findHeaderTarget();
    if (!target) return false;

    var cart = document.querySelector('a[href*="/cart"], .header__icon--cart, .icon-cart');

    if (existing) {
      if (cart && cart.parentElement && existing.parentElement !== cart.parentElement) {
        cart.parentElement.insertBefore(existing, cart);
      } else if (!cart && existing.parentElement !== target) {
        target.appendChild(existing);
      }
      return true;
    }

    var bell = createBellElement();
    if (cart && cart.parentElement) {
      cart.parentElement.insertBefore(bell, cart);
    } else {
      target.appendChild(bell);
    }
    return true;
  }

  function runEnsure() {
    ensureCustomerHint();
    attachBell();
    scheduleBlankBellPanelCleanup();
    setTimeout(attachBell, 250);
    setTimeout(attachBell, 900);
    setTimeout(attachBell, 1800);
  }

  function scheduleEnsure() {
    if (ensureTimer) return;
    ensureTimer = setTimeout(function() {
      ensureTimer = 0;
      runEnsure();
    }, 80);
  }

  function watchDomChanges() {
    var observer = new MutationObserver(function() {
      scheduleEnsure();
      scheduleBlankBellPanelCleanup();
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  function watchNavigation() {
    var lastHref = location.href;
    setInterval(function() {
      if (location.href !== lastHref) {
        lastHref = location.href;
        runEnsure();
      }
    }, 500);
  }

  function isCartMutationUrl(value) {
    var requestUrl = String(value || "");
    return /\\/cart\\/(add|change|update|clear)(\\.js)?(\\?|$)/i.test(requestUrl);
  }

  function hideElement(node) {
    if (!node || node === document.body || node === document.documentElement) return;
    node.setAttribute("hidden", "hidden");
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("data-cariana-hidden-empty", "1");
    node.classList.remove("active", "animate", "is-active", "is-open", "cart-notification--active");
    node.style.setProperty("display", "none", "important");
    node.style.setProperty("visibility", "hidden", "important");
    node.style.setProperty("pointer-events", "none", "important");
  }

  function isNodeNearBell(node, bellRect) {
    if (!node || !node.getBoundingClientRect) return false;
    var rect = node.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 32) return false;
    if (rect.top < bellRect.top - 12 || rect.top > bellRect.bottom + 120) return false;
    if (rect.left > bellRect.right + 360 || rect.right < bellRect.left - 40) return false;
    if (rect.top > Math.min(360, window.innerHeight * 0.55)) return false;
    return true;
  }

  function looksLikeEmptyBellPanel(node) {
    if (!node || node.id === "cariana-noti-bell" || node.id === "cariana-noti-badge") return false;
    if (node.closest && node.closest("#cariana-noti-bell")) return false;
    if (node.querySelector && node.querySelector('img, video, canvas, svg, input, textarea, select, button, a[href]:not(#cariana-noti-bell)')) return false;
    var text = (node.textContent || "").replace(/\\s+/g, "").trim();
    if (text.length > 2) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(node) : null;
    if (style) {
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      var bg = String(style.backgroundColor || "").toLowerCase();
      var hasWhiteBg = bg === "white" || bg === "#fff" || bg === "#ffffff" || /rgba?\\(\\s*255\\s*,\\s*255\\s*,\\s*255/i.test(bg);
      if (!hasWhiteBg && style.boxShadow === "none" && style.borderStyle === "none") return false;
    }
    return true;
  }

  function closeBlankBellPanel() {
    var bell = document.getElementById("cariana-noti-bell");
    if (!bell || !bell.getBoundingClientRect) return;
    var bellRect = bell.getBoundingClientRect();
    var candidates = document.querySelectorAll("body *");
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (!isNodeNearBell(node, bellRect)) continue;
      if (!looksLikeEmptyBellPanel(node)) continue;
      hideElement(node);
    }
  }

  function scheduleBlankBellPanelCleanup() {
    if (blankPanelCleanupTimer) return;
    blankPanelCleanupTimer = setTimeout(function() {
      blankPanelCleanupTimer = 0;
      closeBlankBellPanel();
      setTimeout(closeBlankBellPanel, 180);
      setTimeout(closeBlankBellPanel, 600);
    }, 50);
  }

  function closeStuckCartNotification() {
    var selectors = [
      "cart-notification",
      "#cart-notification",
      ".cart-notification",
      ".cart-notification-wrapper",
      "#cart-notification-form",
      ".cart-notification-product",
      ".cart-notification__links"
    ];
    var nodes = [];
    for (var i = 0; i < selectors.length; i++) {
      var found = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < found.length; j++) {
        if (nodes.indexOf(found[j]) === -1) nodes.push(found[j]);
      }
    }

    for (var k = 0; k < nodes.length; k++) {
      var node = nodes[k];
      var text = (node.textContent || "").trim();
      var hasCartItems = !!node.querySelector('a[href*="/products/"], img, .cart-item, .cart-notification-product__image');
      var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { height: 0 };
      var looksBlankBlock = rect.height > 80 && text.length < 8 && !hasCartItems;
      if (!looksBlankBlock) continue;

      hideElement(node);
    }

    document.documentElement.classList.remove("overflow-hidden");
    if (document.body) {
      document.body.classList.remove("overflow-hidden", "cart-notification--active");
      document.body.style.removeProperty("overflow");
    }
  }

  function afterCartMutation(source) {
    setTimeout(closeStuckCartNotification, 120);
    setTimeout(closeBlankBellPanel, 130);
    setTimeout(closeStuckCartNotification, 450);
    setTimeout(closeBlankBellPanel, 460);
    setTimeout(function() {
      scheduleEnsure();
      closeBlankBellPanel();
      if (source && source.indexOf("add") !== -1) {
        fetchCartAndTrack(source);
      }
    }, 700);
  }

  function hashCartSnapshot(snapshot) {
    var items = Array.isArray(snapshot && snapshot.items) ? snapshot.items : [];
    var signature = [
      String(snapshot && (snapshot.token || snapshot.cart_token) || ""),
      Number(snapshot && snapshot.item_count || 0),
      Number(snapshot && snapshot.total_price || 0),
      items.slice(0, 8).map(function(item) {
        return [Number(item && (item.id || item.variant_id) || 0), Number(item && item.quantity || 0)].join("x");
      }).join("|")
    ].join("#");
    return signature;
  }

  function sendCartEvent(snapshot, source) {
    ensureCustomerHint();
    var eventBody = {
      source: source || "storefront_add_to_cart",
      customerId: customerHint || "",
      cartToken: String(snapshot && (snapshot.token || snapshot.cart_token) || ""),
      email: String(snapshot && (snapshot.email || snapshot.customer_email) || ""),
      cart: snapshot || {}
    };
    if (!eventBody.cartToken && !eventBody.customerId) {
      return;
    }

    var hash = hashCartSnapshot(snapshot || {});
    var now = Date.now();
    if (hash && hash === lastCartEventHash && now - lastCartEventAt < 15000) {
      return;
    }
    lastCartEventHash = hash;
    lastCartEventAt = now;

    fetch("/apps/notificaciones/cart-event", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventBody),
      keepalive: true
    }).catch(function() {});
  }

  function fetchCartAndTrack(source) {
    fetch("/cart.js", { credentials: "same-origin" })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(snapshot) {
        if (!snapshot) return;
        if (Number(snapshot.item_count || 0) < 1) return;
        sendCartEvent(snapshot, source);
      })
      .catch(function() {});
  }

  function hookAddToCartActions() {
    document.addEventListener("submit", function(event) {
      var form = event && event.target;
      if (!form || !form.action || form.action.indexOf("/cart/add") === -1) return;
      setTimeout(function() { fetchCartAndTrack("form_submit"); }, 850);
    }, true);

    document.addEventListener("click", function(event) {
      if (!event || !event.target || !event.target.closest) return;
      var addButton = event.target.closest('button[name="add"],input[name="add"],button[data-add-to-cart],button[data-action="add-to-cart"]');
      if (!addButton) return;
      setTimeout(function() { fetchCartAndTrack("button_click"); }, 900);
    }, true);

    if (window.fetch) {
      var originalFetch = window.fetch;
      window.fetch = function(input, init) {
        var requestUrl = typeof input === "string" ? input : (input && input.url) || "";
        var responsePromise = originalFetch.apply(this, arguments);
        if (isCartMutationUrl(requestUrl)) {
          responsePromise.then(function() {
            afterCartMutation(/\\/cart\\/add/i.test(requestUrl) ? "fetch_add" : "fetch_cart_change");
          }).catch(function() {});
        }
        return responsePromise;
      };
    }

    if (window.XMLHttpRequest && !window.__carianaCartXhrHooked) {
      window.__carianaCartXhrHooked = true;
      var originalOpen = window.XMLHttpRequest.prototype.open;
      var originalSend = window.XMLHttpRequest.prototype.send;
      window.XMLHttpRequest.prototype.open = function(method, requestUrl) {
        this.__carianaCartMutation = isCartMutationUrl(requestUrl);
        this.__carianaCartAdd = /\\/cart\\/add/i.test(String(requestUrl || ""));
        return originalOpen.apply(this, arguments);
      };
      window.XMLHttpRequest.prototype.send = function() {
        if (this.__carianaCartMutation) {
          this.addEventListener("loadend", function() {
            afterCartMutation(this.__carianaCartAdd ? "xhr_add" : "xhr_cart_change");
          });
        }
        return originalSend.apply(this, arguments);
      };
    }
  }

  function refreshBadge() {
    ensureCustomerHint();
    var trayUnread = detectTrayUnreadFromAndroid();
    if (trayUnread > 0) {
      updateBadge(trayUnread);
      writeBadgeCache();
      return;
    }
    if (!pushToken) {
      pushToken = detectPushTokenFromAndroid();
    }
    var query = [];
    if (customerHint) query.push("cid=" + encodeURIComponent(customerHint));
    if (pushToken) query.push("pt=" + encodeURIComponent(pushToken));
    var badgeUrl = "/apps/notificaciones/badge" + (query.length ? ("?" + query.join("&")) : "");
    fetch(badgeUrl)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) return;
        var nextUnread = Number(data.unread) || 0;
        var hasCustomerContext = !!data.hasCustomerContext;
        var hasTokenContext = !!data.hasTokenContext;

        // Prevent accidental badge reset when storefront/proxy briefly omits customer context.
        if (!hasCustomerContext && !hasTokenContext && !customerHint && unread > 0 && nextUnread === 0) {
          return;
        }

        updateBadge(nextUnread);
        writeBadgeCache();
      })
      .catch(function() {});
  }

  function init() {
    var cached = readBadgeCache();
    if (!customerHint && cached.customerHint) {
      customerHint = cached.customerHint;
      url = "/apps/notificaciones?cid=" + encodeURIComponent(customerHint);
    }
    if (unread <= 0 && cached.unread > 0) {
      unread = cached.unread;
    }

    ensureCustomerHint();
    runEnsure();
    hookAddToCartActions();
    watchDomChanges();
    watchNavigation();
    refreshBadge();
    setInterval(refreshBadge, 60000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();`;
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    return res.status(200).send(js);
  } catch (error) {
    return next(error);
  }
});

router.get("/open-return", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = resolveShopDomain(req);
    const orderNumber = req.query.order || "";
    const email = req.query.email || "";
    await markOpenedByReturnContext({ shopDomain, orderNumber, email });
    const targetUrl = buildReturnsPortalUrl({ shopDomain, orderNumber, email });
    const safeTarget = escapeHtml(targetUrl);

    return res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Abriendo devolucion...</title>
    <meta http-equiv="refresh" content="0;url=${safeTarget}" />
  </head>
  <body>
    <p>Abriendo portal de devoluciones...</p>
    <p><a href="${safeTarget}">Continuar</a></p>
    <script>
      window.location.replace(${JSON.stringify(targetUrl)});
    </script>
  </body>
</html>`);
  } catch (error) {
    return next(error);
  }
});

router.get("/open-order", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = resolveShopDomain(req);
    const orderId = req.query.oid || req.query.order_id || req.query.orderId || "";
    let orderNumber = req.query.order || req.query.order_number || req.query.orderNumber || "";
    let orderToken = req.query.token || req.query.order_token || req.query.orderToken || "";
    let orderStatusUrl = req.query.status_url || req.query.order_status_url || req.query.orderStatusUrl || "";

    if ((!safeTrim(orderStatusUrl) || !safeTrim(orderToken)) && parseOrderId(orderId)) {
      const fromEvents = await fetchOrderSnapshotFromEvents({
        shopDomain,
        orderId
      });
      if (fromEvents) {
        orderNumber = orderNumber || String(fromEvents.order_number || "").trim();
        orderToken = orderToken || String(fromEvents.token || "").trim();
        orderStatusUrl = orderStatusUrl || String(fromEvents.order_status_url || "").trim();
      }
    }

    if ((!safeTrim(orderStatusUrl) || !safeTrim(orderToken)) && parseOrderId(orderId)) {
      const snapshot = await fetchOrderSnapshot({
        shopDomain,
        orderId
      });
      if (snapshot) {
        orderNumber = orderNumber || String(snapshot.order_number || "").trim();
        orderToken = orderToken || String(snapshot.token || "").trim();
        orderStatusUrl = orderStatusUrl || String(snapshot.order_status_url || "").trim();
      }
    }

    const targetUrl = buildOrderTargetUrl({
      shopDomain,
      orderId,
      orderNumber,
      orderToken,
      orderStatusUrl
    });
    await markOpenedByOrderContext({ shopDomain, orderNumber });
    const safeTarget = escapeHtml(targetUrl);

    if (!targetUrl || !isAbsoluteUrl(targetUrl)) {
      return res.status(400).send("Invalid order target");
    }

    return res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Abriendo pedido...</title>
    <meta http-equiv="refresh" content="0;url=${safeTarget}" />
  </head>
  <body>
    <p>Abriendo detalle del pedido...</p>
    <p><a href="${safeTarget}">Continuar</a></p>
    <script>
      window.location.replace(${JSON.stringify(targetUrl)});
    </script>
  </body>
</html>`);
  } catch (error) {
    return next(error);
  }
});

router.get("/open-campaign", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = resolveShopDomain(req);
    const shopifyCustomerId = resolveCustomerId(req);
    const campaignId = Number(req.query.campaign || req.query.campaign_id || req.query.campaignId || 0);
    const targetRaw = req.query.target || req.query.url || "";
    const targetUrl = toAbsoluteStorefrontUrl(shopDomain, safeTrim(targetRaw) || "/");

    await markOpenedByCampaignContext({
      shopDomain,
      campaignId,
      targetUrl,
      shopifyCustomerId
    });

    const safeTarget = escapeHtml(targetUrl);
    if (!targetUrl || !isAbsoluteUrl(targetUrl)) {
      return res.status(400).send("Invalid campaign target");
    }

    return res.status(200).send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Abriendo...</title>
    <meta http-equiv="refresh" content="0;url=${safeTarget}" />
  </head>
  <body>
    <p>Abriendo contenido...</p>
    <p><a href="${safeTarget}">Continuar</a></p>
    <script>
      window.location.replace(${JSON.stringify(targetUrl)});
    </script>
  </body>
</html>`);
  } catch (error) {
    return next(error);
  }
});

router.get("/", requireValidProxy, async (req, res) => {
  const shopDomain = resolveShopDomain(req);
  const shopifyCustomerId = resolveCustomerId(req);

  if (!shopifyCustomerId) {
    return res.status(200).send(
      "<h2>Inicia sesion para ver tus notificaciones</h2><p>Este espacio muestra el historial de avisos de tu cuenta.</p>"
    );
  }

  let initial = { history: [], unread: 0 };
  try {
    initial = await getNotificationsByCustomer(shopDomain, shopifyCustomerId);
  } catch (_error) {
    initial = { history: [], unread: 0 };
  }

  return res.status(200).send(
    renderShellHtml({
      shop: shopDomain,
      customerId: shopifyCustomerId,
      initialHistory: initial.history,
      initialUnread: initial.unread,
      homeUrl: toAbsoluteStorefrontUrl(shopDomain, "/")
    })
  );
});

router.get("/list", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = resolveShopDomain(req);
    const shopifyCustomerId = resolveCustomerId(req);
    if (!shopDomain || !shopifyCustomerId) {
      return res.status(400).json({ error: "Missing shop or logged_in_customer_id" });
    }

    const data = await getNotificationsByCustomer(shopDomain, shopifyCustomerId);
    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

router.post("/open", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = resolveShopDomain(req);
    const shopifyCustomerId = resolveCustomerId(req);
    const notificationId = Number(req.query.id || req.body?.id || 0);
    if (!shopDomain || !notificationId) {
      return res.status(400).json({ error: "Missing required params" });
    }

    const customerContext = await resolveCustomerContext(shopDomain, shopifyCustomerId);
    const currentCustomerId = Number(customerContext.customerId || 0);
    const currentCustomerEmail = safeTrim(customerContext.customerEmail).toLowerCase();
    const effectiveShopDomain = safeTrim(customerContext.effectiveShopDomain || shopDomain);

    let result = { rowCount: 0 };
    if (currentCustomerId > 0) {
      result = await pool.query(
        `
        UPDATE notifications n
        SET opened_at = COALESCE(n.opened_at, NOW()), updated_at = NOW()
        WHERE n.id = $1
          AND n.customer_id = $2
        RETURNING n.id
        `,
        [notificationId, currentCustomerId]
      );
    }

    if (result.rowCount === 0 && currentCustomerEmail) {
      result = await pool.query(
        `
        UPDATE notifications n
        SET opened_at = COALESCE(n.opened_at, NOW()), updated_at = NOW()
        WHERE n.id = $1
          AND LOWER(COALESCE(n.data->>'customerEmail', '')) = $2
        RETURNING n.id
        `,
        [notificationId, currentCustomerEmail]
      );
    }

    if (result.rowCount === 0) {
      result = await pool.query(
        `
        UPDATE notifications n
        SET opened_at = COALESCE(n.opened_at, NOW()), updated_at = NOW()
        WHERE n.id = $1
          AND n.shop_domain = $2
        RETURNING n.id
        `,
        [notificationId, effectiveShopDomain || shopDomain]
      );
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
