const express = require("express");
const { scheduleStoreCreditNotification } = require("../services/storeCreditService");

const router = express.Router();

router.post("/events", async (req, res, next) => {
  try {
    const shopDomain = req.body.shopDomain || req.shopDomain;
    const event = req.body.event && typeof req.body.event === "object" ? req.body.event : req.body;

    if (!shopDomain || !event || typeof event !== "object") {
      return res.status(400).json({ error: "shopDomain and event payload are required" });
    }

    const result = await scheduleStoreCreditNotification({
      shopDomain,
      sourceKey: event.sourceKey,
      shopifyCustomerId: event.shopifyCustomerId,
      customerEmail: event.customerEmail,
      orderId: event.orderId,
      orderNumber: event.orderNumber,
      amount: event.amount,
      currencyCode: event.currencyCode,
      delayMs: event.delayMs,
      sendNow: Boolean(event.sendNow)
    });

    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
