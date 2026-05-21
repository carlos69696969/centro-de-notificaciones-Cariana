const express = require("express");
const pool = require("../db/pool");
const { verifyAppProxySignature } = require("../services/shopifyAppProxyVerifier");

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

function renderShellHtml({ shop, customerId }) {
  const safeShop = JSON.stringify(shop || "");
  const safeCustomerId = JSON.stringify(customerId || "");

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
      <div class="muted" id="summary">Cargando...</div>
      <div class="toolbar">
        <button id="reloadBtn">Actualizar</button>
      </div>
      <div class="list" id="list"></div>
    </div>

    <script>
      const SHOP = ${safeShop};
      const CUSTOMER_ID = ${safeCustomerId};

      const listEl = document.getElementById("list");
      const summaryEl = document.getElementById("summary");
      const reloadBtn = document.getElementById("reloadBtn");

      function fmtDate(value) {
        const d = new Date(value);
        return isNaN(d.getTime()) ? value : d.toLocaleString();
      }

      async function markOpened(id) {
        const qs = new URLSearchParams(window.location.search);
        qs.set("id", id);
        await fetch("./open?" + qs.toString(), { method: "POST" });
      }

      async function load() {
        const response = await fetch("./list" + window.location.search);
        const data = await response.json();
        const history = data.history || [];
        summaryEl.textContent = "Total: " + history.length + " | No leidas: " + (data.unread || 0);

        listEl.innerHTML = "";
        for (const item of history) {
          const div = document.createElement("div");
          div.className = "item";

          const unread = !item.opened_at;
          div.innerHTML = \`
            <h3 class="title">
              \${item.title}
              <span class="badge \${unread ? "new" : ""}">\${unread ? "Nueva" : "Leida"}</span>
            </h3>
            <div class="meta">\${fmtDate(item.created_at)}</div>
            <div class="msg">\${item.message || ""}</div>
            \${item.deep_link ? '<div class="meta"><a class="link" href="' + item.deep_link + '">Abrir</a></div>' : ""}
          \`;

          div.addEventListener("click", async () => {
            if (unread) {
              await markOpened(item.id);
              await load();
            }
          });

          listEl.appendChild(div);
        }
      }

      reloadBtn.addEventListener("click", load);
      load();
    </script>
  </body>
</html>`;
}

async function getNotificationsByCustomer(shopDomain, shopifyCustomerId) {
  const history = await pool.query(
    `
    SELECT n.id, n.title, n.message, n.deep_link, n.status, n.created_at, n.opened_at
    FROM notifications n
    JOIN customers c ON c.id = n.customer_id
    WHERE c.shop_domain = $1
      AND c.shopify_customer_id = $2
    ORDER BY n.created_at DESC
    LIMIT 100
    `,
    [shopDomain, Number(shopifyCustomerId)]
  );

  const unread = history.rows.reduce((acc, row) => acc + (row.opened_at ? 0 : 1), 0);
  return { history: history.rows, unread };
}

async function getUnreadCount(shopDomain, shopifyCustomerId) {
  if (!shopDomain || !shopifyCustomerId) {
    return 0;
  }
  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS unread
    FROM notifications n
    JOIN customers c ON c.id = n.customer_id
    WHERE c.shop_domain = $1
      AND c.shopify_customer_id = $2
      AND n.opened_at IS NULL
    `,
    [shopDomain, Number(shopifyCustomerId)]
  );
  return result.rows[0]?.unread || 0;
}

router.get("/badge", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = req.query.shop || "";
    const shopifyCustomerId = req.query.logged_in_customer_id || "";
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

    const js = `
(function() {
  var unread = ${Number(unread) || 0};
  var url = "/apps/notificaciones";

  function createBell() {
    var a = document.createElement("a");
    a.href = url;
    a.setAttribute("aria-label", "Notificaciones");
    a.style.cssText = "position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;margin-left:10px;text-decoration:none;color:inherit;";
    a.innerHTML = '<span style="font-size:22px;line-height:1">🔔</span>';

    var badge = document.createElement("span");
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.style.cssText = "position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;background:#ef4444;color:#fff;font-size:11px;line-height:18px;text-align:center;font-weight:700;" + (unread > 0 ? "" : "display:none;");
    a.appendChild(badge);
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
      "header .header"
    ];

    for (var i = 0; i < selectors.length; i++) {
      var candidate = document.querySelector(selectors[i]);
      if (candidate) return candidate;
    }

    var account = document.querySelector('a[href*="/account"], .header__icon--account, .icon-account');
    if (account && account.parentElement) return account.parentElement;

    var cart = document.querySelector('a[href*="/cart"], .header__icon--cart, .icon-cart');
    if (cart && cart.parentElement) return cart.parentElement;

    return document.querySelector("header");
  }

  function mount() {
    if (document.getElementById("cariana-noti-bell")) return;
    var target = findHeaderTarget();
    if (!target) return;
    var bell = createBell();
    bell.id = "cariana-noti-bell";

    var cart = document.querySelector('a[href*="/cart"], .header__icon--cart, .icon-cart');
    if (cart && cart.parentElement) {
      cart.parentElement.insertBefore(bell, cart);
    } else {
      target.appendChild(bell);
    }
  }

  function mountWithRetry() {
    var attempts = 0;
    var maxAttempts = 30;
    var timer = setInterval(function() {
      attempts++;
      mount();
      if (document.getElementById("cariana-noti-bell") || attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWithRetry);
  } else {
    mountWithRetry();
  }
})();`;

    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    return res.status(200).send(js);
  } catch (error) {
    return next(error);
  }
});

router.get("/", requireValidProxy, async (req, res) => {
  const shopDomain = req.query.shop || "";
  const shopifyCustomerId = req.query.logged_in_customer_id || "";

  if (!shopifyCustomerId) {
    return res.status(200).send(
      "<h2>Inicia sesion para ver tus notificaciones</h2><p>Este espacio muestra el historial de avisos de tu cuenta.</p>"
    );
  }

  return res.status(200).send(renderShellHtml({ shop: shopDomain, customerId: shopifyCustomerId }));
});

router.get("/list", requireValidProxy, async (req, res, next) => {
  try {
    const shopDomain = req.query.shop || "";
    const shopifyCustomerId = req.query.logged_in_customer_id || "";
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
    const shopDomain = req.query.shop || "";
    const shopifyCustomerId = req.query.logged_in_customer_id || "";
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
