const express = require("express");
const { sendManualOrderStatus } = require("../services/ordersService");

const router = express.Router();

router.post("/manual-status", async (req, res, next) => {
  try {
    const { shopDomain, shopifyCustomerId, customerEmail, orderId, orderNumber, status, attemptCount } = req.body;
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
      attemptCount
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
