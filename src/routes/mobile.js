const express = require("express");
const pool = require("../db/pool");
const { upsertCustomerFromShopify } = require("../services/customerService");

const router = express.Router();

router.post("/register-token", async (req, res, next) => {
  try {
    const { shopDomain, shopifyCustomerId, email, firstName, lastName, token, platform, appVersion } = req.body;
    if (!shopDomain || !shopifyCustomerId || !token) {
      return res.status(400).json({ error: "shopDomain, shopifyCustomerId and token are required" });
    }

    const customer = await upsertCustomerFromShopify(shopDomain, {
      id: shopifyCustomerId,
      email,
      first_name: firstName,
      last_name: lastName
    });

    await pool.query(
      `
      INSERT INTO fcm_tokens
        (shop_domain, customer_id, token, platform, app_version, is_active, last_seen_at, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,TRUE,NOW(),NOW())
      ON CONFLICT (shop_domain, token)
      DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        platform = EXCLUDED.platform,
        app_version = EXCLUDED.app_version,
        is_active = TRUE,
        invalidated_at = NULL,
        last_seen_at = NOW(),
        updated_at = NOW()
      `,
      [shopDomain, customer.id, token, platform || "android", appVersion || null]
    );

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/unregister-token", async (req, res, next) => {
  try {
    const { shopDomain, token } = req.body;
    if (!shopDomain || !token) {
      return res.status(400).json({ error: "shopDomain and token are required" });
    }

    await pool.query(
      `
      UPDATE fcm_tokens
      SET is_active = FALSE, invalidated_at = NOW(), updated_at = NOW()
      WHERE shop_domain = $1 AND token = $2
      `,
      [shopDomain, token]
    );

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/notifications/opened", async (req, res, next) => {
  try {
    const { notificationId } = req.body;
    if (!notificationId) {
      return res.status(400).json({ error: "notificationId is required" });
    }

    await pool.query(
      `
      UPDATE notifications
      SET opened_at = NOW(), updated_at = NOW()
      WHERE id = $1
      `,
      [notificationId]
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/notifications/converted", async (req, res, next) => {
  try {
    const { notificationId } = req.body;
    if (!notificationId) {
      return res.status(400).json({ error: "notificationId is required" });
    }

    await pool.query(
      `
      UPDATE notifications
      SET converted_at = NOW(), updated_at = NOW()
      WHERE id = $1
      `,
      [notificationId]
    );
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
