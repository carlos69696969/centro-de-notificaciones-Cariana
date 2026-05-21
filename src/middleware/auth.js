const env = require("../config/env");

function requireInternalApiKey(req, res, next) {
  if (!env.appInternalApiKey) {
    return next();
  }

  const key = req.header("x-api-key");
  if (key !== env.appInternalApiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

function resolveShopDomain(req, _res, next) {
  req.shopDomain = req.header("x-shop-domain") || req.query.shop || req.body?.shopDomain || null;
  next();
}

module.exports = {
  requireInternalApiKey,
  resolveShopDomain
};
