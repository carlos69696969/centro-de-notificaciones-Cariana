const express = require("express");
const pool = require("../db/pool");
const env = require("../config/env");
const { verifyAppProxySignature } = require("../services/shopifyAppProxyVerifier");
const { buildOrderDeepLink, buildLegacyOrderFallbackDeepLink, toAbsoluteStorefrontUrl } = require("../services/deepLinkService");

const router = express.Router();

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

function renderItemsHtml(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<div class="item"><div class="msg">Aun no tienes notificaciones.</div></div>';
  }

  return items
    .map((item) => {
      const unread = !item.opened_at;
      const deepLink = item.deep_link
        ? `<div class="meta"><a class="link" href="${escapeHtml(item.deep_link)}">Abrir</a></div>`
        : "";

      return `
      <div class="item" data-id="${Number(item.id)}" data-unread="${unread ? "1" : "0"}">
        <h3 class="title">
          ${escapeHtml(item.title)}
          <span class="badge ${unread ? "new" : ""}">${unread ? "Nueva" : "Leida"}</span>
        </h3>
        <div class="meta">${escapeHtml(item.created_at)}</div>
        <div class="msg">${escapeHtml(item.message || "")}</div>
        ${deepLink}
      </div>`;
    })
    .join("");
}

function renderShellHtml({ shop, customerId, initialHistory = [], initialUnread = 0 }) {
  const safeShop = JSON.stringify(shop || "");
  const safeCustomerId = JSON.stringify(customerId || "");
  const safeInitialHistory = JSON.stringify(initialHistory || []);
  const safeInitialUnread = Number(initialUnread) || 0;
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
        --brand: #0f766e;
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
        padding: 16px;
      }
      h1 {
        font-size: 22px;
        margin: 0 0 8px;
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
        margin-top: 14px;
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
      <div class="muted" id="summary">${escapeHtml(serverSummary)}</div>
      <div class="toolbar">
        <button id="reloadBtn">Actualizar</button>
      </div>
      <div class="list" id="list">${serverItems}</div>
    </div>

    <script>
      const SHOP = ${safeShop};
      const CUSTOMER_ID = ${safeCustomerId};
      const INITIAL_HISTORY = ${safeInitialHistory};

      const listEl = document.getElementById("list");
      const summaryEl = document.getElementById("summary");
      const reloadBtn = document.getElementById("reloadBtn");
      const basePath = window.location.pathname.replace(/\/$/, "");

      function fmtDate(value) {
        const d = new Date(value);
        return isNaN(d.getTime()) ? value : d.toLocaleString();
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
        summaryEl.textContent = "Total: " + history.length + " | No leidas: " + (unreadCount || 0);
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
              <span class="badge \${unread ? "new" : ""}">\${unread ? "Nueva" : "Leida"}</span>
            </h3>
            <div class="meta">\${fmtDate(item.created_at)}</div>
            <div class="msg">\${escapeHtmlClient(item.message || "")}</div>
            \${item.deep_link ? '<div class="meta"><a class="link" href="' + escapeHtmlClient(item.deep_link) + '">Abrir</a></div>' : ""}
          \`;

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
        const response = await fetch(basePath + "/open", {
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
          const response = await fetch(basePath + "/list");
          if (!response.ok) {
            throw new Error("No se pudo cargar el historial");
          }
          const data = await response.json();
          const history = data.history || [];
          renderHistory(history, data.unread || 0);
        } catch (error) {
          summaryEl.textContent = "No se pudieron cargar las notificaciones";
          listEl.innerHTML = "";
          const err = document.createElement("div");
          err.className = "item";
          err.innerHTML = '<div class="msg">Intenta de nuevo con el boton Actualizar.</div>';
          listEl.appendChild(err);
          console.error(error);
        }
      }

      renderHistory(INITIAL_HISTORY, ${safeInitialUnread});
      reloadBtn.addEventListener("click", load);
    </script>
  </body>
</html>`;
}

async function getNotificationsByCustomer(shopDomain, shopifyCustomerId) {
  if (!shopDomain || !shopifyCustomerId) {
    return { history: [], unread: 0 };
  }

  const customerLookup = await pool.query(
    `
    SELECT id, LOWER(COALESCE(email, '')) AS email
    FROM customers
    WHERE shop_domain = $1
      AND shopify_customer_id = $2
    LIMIT 1
    `,
    [shopDomain, Number(shopifyCustomerId)]
  );
  const currentCustomerId = Number(customerLookup.rows[0]?.id || 0);
  const currentCustomerEmail = String(customerLookup.rows[0]?.email || "").trim().toLowerCase();

  if (!currentCustomerId && !currentCustomerEmail) {
    return { history: [], unread: 0 };
  }

  const history = await pool.query(
    `
    SELECT n.id, n.type, n.title, n.message, n.deep_link, n.data, n.status, n.created_at, n.opened_at
    FROM notifications n
    LEFT JOIN customers c ON c.id = n.customer_id
    WHERE n.shop_domain = $1
      AND n.status = 'sent'
      AND (
        ($2 > 0 AND n.customer_id = $2)
        OR ($3 <> '' AND LOWER(COALESCE(n.data->>'customerEmail', c.email, '')) = $3)
      )
    ORDER BY n.created_at DESC
    LIMIT 100
    `,
    [shopDomain, currentCustomerId, currentCustomerEmail]
  );

  const rows = history.rows.map((row) => ({
    ...row,
    deep_link: resolveNotificationDeepLink({
      shopDomain,
      item: row
    })
  }));

  const unread = rows.reduce((acc, row) => acc + (row.opened_at ? 0 : 1), 0);
  return { history: rows, unread };
}

async function getUnreadCount(shopDomain, shopifyCustomerId) {
  if (!shopDomain || !shopifyCustomerId) {
    return 0;
  }

  const customerLookup = await pool.query(
    `
    SELECT id, LOWER(COALESCE(email, '')) AS email
    FROM customers
    WHERE shop_domain = $1
      AND shopify_customer_id = $2
    LIMIT 1
    `,
    [shopDomain, Number(shopifyCustomerId)]
  );
  const currentCustomerId = Number(customerLookup.rows[0]?.id || 0);
  const currentCustomerEmail = String(customerLookup.rows[0]?.email || "").trim().toLowerCase();

  if (!currentCustomerId && !currentCustomerEmail) {
    return 0;
  }

  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS unread
    FROM notifications n
    LEFT JOIN customers c ON c.id = n.customer_id
    WHERE n.shop_domain = $1
      AND n.status = 'sent'
      AND n.opened_at IS NULL
      AND (
        ($2 > 0 AND n.customer_id = $2)
        OR ($3 <> '' AND LOWER(COALESCE(n.data->>'customerEmail', c.email, '')) = $3)
      )
    `,
    [shopDomain, currentCustomerId, currentCustomerEmail]
  );
  return result.rows[0]?.unread || 0;
}

function resolveShopDomain(req) {
  return req.query.shop || req.header("x-shopify-shop-domain") || "";
}

function resolveCustomerId(req) {
  return req.query.logged_in_customer_id || req.query.cid || "";
}

router.get("/badge", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = resolveShopDomain(req);
    const shopifyCustomerId = resolveCustomerId(req);
    const unread = await getUnreadCount(shopDomain, shopifyCustomerId);
    return res.json({
      unread,
      notificationsUrl: "/apps/notificaciones"
    });
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

    const js = `
(function() {
  if (window.__carianaBellInit) return;
  window.__carianaBellInit = true;

  var unread = ${Number(unread) || 0};
  var customerHint = ${JSON.stringify(customerHint)};
  var url = "/apps/notificaciones" + (customerHint ? ("?cid=" + encodeURIComponent(customerHint)) : "");

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

    return "";
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

  function scheduleEnsure() {
    ensureCustomerHint();
    attachBell();
    setTimeout(attachBell, 250);
    setTimeout(attachBell, 900);
    setTimeout(attachBell, 1800);
  }

  function watchDomChanges() {
    var observer = new MutationObserver(function() {
      scheduleEnsure();
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
        scheduleEnsure();
      }
    }, 500);
  }

  function refreshBadge() {
    ensureCustomerHint();
    var badgeUrl = "/apps/notificaciones/badge" + (customerHint ? ("?cid=" + encodeURIComponent(customerHint)) : "");
    fetch(badgeUrl)
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) return;
        updateBadge(data.unread || 0);
      })
      .catch(function() {});
  }

  function init() {
    ensureCustomerHint();
    scheduleEnsure();
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
      initialUnread: initial.unread
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
    if (!shopDomain || !shopifyCustomerId || !notificationId) {
      return res.status(400).json({ error: "Missing required params" });
    }

    const result = await pool.query(
      `
      UPDATE notifications n
      SET opened_at = COALESCE(n.opened_at, NOW()), updated_at = NOW()
      FROM customers c
      WHERE n.id = $1
        AND n.customer_id = c.id
        AND c.shop_domain = $2
        AND c.shopify_customer_id = $3
      RETURNING n.id
      `,
      [notificationId, shopDomain, Number(shopifyCustomerId)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
