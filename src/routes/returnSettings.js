const express = require("express");
const {
  getReturnNotificationSettings,
  saveReturnNotificationSettings
} = require("../services/returnSettingsService");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const shopDomain = req.query.shopDomain || req.query.shop || req.shopDomain || "";
    const settings = await getReturnNotificationSettings(shopDomain);
    return res.json({ ok: true, settings });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const shopDomain = req.body.shopDomain || req.body.shop || req.shopDomain || "";
    const settings = await saveReturnNotificationSettings(shopDomain, req.body || {});
    return res.json({ ok: true, settings });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
