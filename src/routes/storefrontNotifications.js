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
  if (window.__carianaBellInit) return;
  window.__carianaBellInit = true;

  var unread = ${Number(unread) || 0};
  var url = "/apps/notificaciones";

  function updateBadge(count) {
    unread = Number(count) || 0;
    var badge = document.getElementById("cariana-noti-badge");
    if (!badge) return;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.style.display = unread > 0 ? "" : "none";
  }

  function createBellElement() {
    var a = document.createElement("a");
    a.href = url;
    a.id = "cariana-noti-bell";
    a.setAttribute("aria-label", "Notificaciones");
    a.style.cssText = "position:relative;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin:0 8px;text-decoration:none;color:inherit;flex:0 0 auto;";

    var icon = document.createElement("span");
    icon.style.cssText = "display:inline-flex;align-items:center;justify-content:center;line-height:0;";
    icon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><defs><linearGradient id="cariana-bell-grad" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse"><stop stop-color="#f7d154"></stop><stop offset="1" stop-color="#ff5f7f"></stop></linearGradient></defs><path d="M12 3.25c-3.5 0-6.34 2.84-6.34 6.34v3.06c0 .68-.21 1.33-.6 1.88l-1.07 1.47c-.26.36-.3.84-.1 1.23.2.39.6.63 1.04.63h14.14c.44 0 .84-.24 1.04-.63.2-.39.16-.87-.1-1.23l-1.07-1.47c-.39-.54-.6-1.2-.6-1.88V9.59c0-3.5-2.84-6.34-6.34-6.34Z" stroke="url(#cariana-bell-grad)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><path d="M9.7 19.3a2.3 2.3 0 0 0 4.6 0" stroke="url(#cariana-bell-grad)" stroke-width="1.8" stroke-linecap="round"></path></svg>';
    a.appendChild(icon);

    var badge = document.createElement("span");
    badge.id = "cariana-noti-badge";
    badge.style.cssText = "position:absolute;top:-3px;right:-3px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:linear-gradient(135deg,#ffb45a,#ff5f7f);color:#fff;font-size:10px;line-height:17px;text-align:center;font-weight:700;box-sizing:border-box;display:none;";
    a.appendChild(badge);
    updateBadge(unread);
    return a;
  }

  function findHeaderTarget() {
    var cart = document.querySelector('a[href*="/cart"], .header__icon--cart, .icon-cart, .site-header__cart');
    if (cart && cart.parentElement) return cart.parentElement;

    var account = document.querySelector('a[href*="/account"], .header__icon--account, .icon-account, .site-header__account');
    if (account && account.parentElement) return account.parentElement;

    var selectors = [
      ".header__icons",
      ".site-header__icons",
      ".header-icons",
      ".header__actions",
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

    var cart = document.querySelector('a[href*="/cart"], .header__icon--cart, .icon-cart, .site-header__cart');
    var account = document.querySelector('a[href*="/account"], .header__icon--account, .icon-account, .site-header__account');

    if (existing) {
      if (cart && cart.parentElement && existing.parentElement !== cart.parentElement) {
        cart.parentElement.insertBefore(existing, cart);
      } else if (cart && cart.parentElement && existing.parentElement === cart.parentElement && existing.nextSibling !== cart) {
        cart.parentElement.insertBefore(existing, cart);
      } else if (!cart && account && account.parentElement && existing.parentElement !== account.parentElement) {
        account.parentElement.insertBefore(existing, account.nextSibling);
      } else if (!cart && existing.parentElement !== target) {
        target.appendChild(existing);
      }
      return true;
    }

    var bell = createBellElement();
    if (cart && cart.parentElement) {
      cart.parentElement.insertBefore(bell, cart);
    } else if (account && account.parentElement) {
      account.parentElement.insertBefore(bell, account.nextSibling);
    } else {
      target.appendChild(bell);
    }
    return true;
  }

  function scheduleEnsure() {
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
    fetch("/apps/notificaciones/badge")
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) return;
        updateBadge(data.unread || 0);
      })
      .catch(function() {});
  }

  function init() {
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
