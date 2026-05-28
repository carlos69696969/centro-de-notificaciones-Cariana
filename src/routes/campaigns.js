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
    if (!shopDomain || !message || !audienceType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const normalizedFilters = audienceFilters && typeof audienceFilters === "object" ? audienceFilters : {};
    const recurring = String(normalizedFilters.recurring ?? "").toLowerCase() === "true" || normalizedFilters.recurring === true;
    const repeatEveryHours = Number(normalizedFilters.repeatEveryHours || 0);
    const validRepeatEveryHours = Number.isFinite(repeatEveryHours) ? Math.floor(repeatEveryHours) : 0;
    const effectiveScheduledAt = scheduledAt || (recurring && validRepeatEveryHours > 0 ? new Date().toISOString() : null);

    normalizedFilters.recurring = recurring;
    normalizedFilters.repeatEveryHours = validRepeatEveryHours;

    const campaign = await createCampaign({
      shopDomain,
      name: String(name || "").trim(),
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
