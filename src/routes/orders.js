const express = require("express");
const { getLatestOrderNotification, sendManualOrderStatus } = require("../services/ordersService");

const router = express.Router();

router.get("/latest-notification", async (req, res, next) => {
  try {
    const shopDomain = req.query.shopDomain || req.query.shop || req.shopDomain || "";
    const orderNumber = req.query.orderNumber || req.query.order || "";
    if (!shopDomain || !orderNumber) {
      return res.status(400).json({
        error: "Missing required fields",
        detail: "shopDomain and orderNumber are required"
      });
    }

    const notification = await getLatestOrderNotification({ shopDomain, orderNumber });
    return res.json({ ok: true, notification });
  } catch (error) {
    return next(error);
  }
});

router.post("/manual-status", async (req, res, next) => {
  try {
    const {
      shopDomain,
      shopifyCustomerId,
      customerEmail,
      orderId,
      orderNumber,
      status,
      attemptCount,
      branchAddress,
      branchHours,
      pickupHours,
      branchPickupDeadlineAt,
      branchPickupDeadlineLabel,
      rescheduledDate,
      rescheduledDateLabel,
      title,
      message,
      source,
      notificationSource,
      refundKind,
      suppressRefundWebhook,
      suppressOrderInTransitWebhook,
    } = req.body;
    const hasOrderContext = Boolean(orderId || orderNumber);
    if (!shopDomain || !hasOrderContext || !status) {
      return res.status(400).json({
        error: "Missing required fields",
        detail: "shopDomain, orderId or orderNumber, and status are required"
      });
    }

    const result = await sendManualOrderStatus({
      shopDomain,
      shopifyCustomerId,
      customerEmail,
      orderId,
      orderNumber,
      status,
      attemptCount,
      branchAddress,
      branchHours,
      pickupHours,
      branchPickupDeadlineAt,
      branchPickupDeadlineLabel,
      rescheduledDate,
      rescheduledDateLabel,
      title,
      message,
      source,
      notificationSource,
      refundKind,
      suppressRefundWebhook,
      suppressOrderInTransitWebhook
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
