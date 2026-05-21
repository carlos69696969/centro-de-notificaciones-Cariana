const express = require("express");
const { sendManualOrderStatus } = require("../services/ordersService");

const router = express.Router();

router.post("/manual-status", async (req, res, next) => {
  try {
    const { shopDomain, shopifyCustomerId, orderId, orderNumber, status } = req.body;
    if (!shopDomain || !shopifyCustomerId || !orderId || !status) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await sendManualOrderStatus({
      shopDomain,
      shopifyCustomerId,
      orderId,
      orderNumber,
      status
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
