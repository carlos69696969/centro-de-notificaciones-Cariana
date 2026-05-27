const express = require("express");
const { createCampaign, getCampaigns, sendCampaignNow } = require("../services/campaignService");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    if (!req.shopDomain) {
      return res.status(400).json({ error: "shopDomain is required" });
    }
    const campaigns = await getCampaigns(req.shopDomain);
    return res.json({ campaigns });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { shopDomain, name, title, message, deepLink, audienceType, audienceFilters, scheduledAt, createdBy } = req.body;
    if (!shopDomain || !name || !title || !message || !audienceType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const normalizedFilters = audienceFilters && typeof audienceFilters === "object" ? audienceFilters : {};
    const recurringDaily = String(normalizedFilters.recurringDaily ?? "").toLowerCase() === "true" || normalizedFilters.recurringDaily === true;
    const effectiveScheduledAt = scheduledAt || (recurringDaily ? new Date().toISOString() : null);

    const campaign = await createCampaign({
      shopDomain,
      name,
      title,
      message,
      deepLink,
      audienceType,
      audienceFilters: normalizedFilters,
      scheduledAt: effectiveScheduledAt,
      createdBy
    });

    return res.status(201).json({ campaign });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/send", async (req, res, next) => {
  try {
    const { shopDomain } = req.body;
    if (!shopDomain) {
      return res.status(400).json({ error: "shopDomain is required" });
    }

    const result = await sendCampaignNow(shopDomain, Number(req.params.id));
    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
