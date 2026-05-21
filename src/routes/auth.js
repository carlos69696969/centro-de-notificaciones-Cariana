const crypto = require("crypto");
const express = require("express");
const pool = require("../db/pool");
const env = require("../config/env");

const router = express.Router();

function verifyOAuthHmac(query) {
  const params = { ...query };
  const hmac = params.hmac;
  delete params.hmac;
  delete params.signature;

  const ordered = Object.keys(params)
    .sort()
    .map((key) => `${key}=${Array.isArray(params[key]) ? params[key].join(",") : params[key]}`)
    .join("&");
  const digest = crypto.createHmac("sha256", env.shopifyApiSecret).update(ordered).digest("hex");
  return digest === hmac;
}

router.get("/start", async (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send("Missing shop");
  }
  if (!env.shopifyApiKey || !env.shopifyApiSecret) {
    return res.status(500).send("Shopify credentials are missing");
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${env.shopifyAppUrl}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${env.shopifyApiKey}&scope=${encodeURIComponent(
    env.shopifyScopes
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  return res.redirect(installUrl);
});

router.get("/callback", async (req, res, next) => {
  try {
    if (!verifyOAuthHmac(req.query)) {
      return res.status(401).send("Invalid OAuth signature");
    }

    const shop = req.query.shop;
    const code = req.query.code;
    if (!shop || !code) {
      return res.status(400).send("Missing required OAuth params");
    }

    await pool.query(
      `
      INSERT INTO shops (shop_domain, access_token, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (shop_domain)
      DO UPDATE SET updated_at = NOW()
      `,
      [shop, null]
    );

    return res.send("App installed. OAuth token exchange pending implementation.");
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
