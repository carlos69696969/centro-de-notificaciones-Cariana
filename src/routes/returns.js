const express = require("express");
const { processReturnEvent } = require("../services/returnsService");

const router = express.Router();

router.post("/events", async (req, res, next) => {
  try {
    const shopDomain = req.body.shopDomain || req.shopDomain;
    const event = req.body.event && typeof req.body.event === "object" ? req.body.event : req.body;

    if (!shopDomain || !event || typeof event !== "object") {
      return res.status(400).json({ error: "shopDomain and event payload are required" });
    }

    const result = await processReturnEvent({ shopDomain, payload: event });
    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
