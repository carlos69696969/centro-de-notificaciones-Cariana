const express = require("express");
const {
  getAbandonedCartSettings,
  saveAbandonedCartSettings
} = require("../services/abandonedCartService");

const router = express.Router();

router.get("/settings", async (req, res, next) => {
  try {
    if (!req.shopDomain) {
      return res.status(400).json({ error: "shopDomain is required" });
    }

    const settings = await getAbandonedCartSettings(req.shopDomain);
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

router.post("/settings", async (req, res, next) => {
  try {
    const shopDomain = req.shopDomain || req.body?.shopDomain;
    if (!shopDomain) {
      return res.status(400).json({ error: "shopDomain is required" });
    }

    const settings = await saveAbandonedCartSettings(shopDomain, req.body || {});
    return res.json({ ok: true, settings });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
