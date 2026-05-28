const express = require("express");
const { verifyWebhookHmac } = require("../services/shopifyWebhookVerifier");
const { processOrderWebhook, processRefundWebhook } = require("../services/ordersService");
const { upsertCheckoutEvent } = require("../services/abandonedCartService");

const router = express.Router();

router.post("/shopify", express.raw({ type: "*/*" }), async (req, res, next) => {
  try {
    const hmac = req.header("x-shopify-hmac-sha256");
    const topic = req.header("x-shopify-topic");
    const shopDomain = req.header("x-shopify-shop-domain");
    const webhookId = req.header("x-shopify-webhook-id");

    const verified = verifyWebhookHmac(req.body, hmac);
    if (!verified) {
      return res.status(401).send("Invalid webhook signature");
    }

    const payload = JSON.parse(req.body.toString("utf8"));

    if (
      [
        "orders/create",
        "orders/updated",
        "orders/fulfilled",
        "orders/cancelled",
        "fulfillment_orders/line_items_prepared_for_local_delivery"
      ].includes(topic)
    ) {
      await processOrderWebhook({ topic, shopDomain, payload, webhookId });
    } else if (topic === "checkouts/update" || topic === "checkouts/create") {
      await upsertCheckoutEvent({ shopDomain, payload });
    } else if (topic === "refunds/create") {
      await processRefundWebhook({ shopDomain, payload, webhookId });
    }

    return res.status(200).send("ok");
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
