const pool = require("../db/pool");
const { getCustomerByShopifyId } = require("./customerService");
const { getTemplate } = require("./templateService");
const { sendToCustomerTokens } = require("./notificationService");

const returnTemplateMap = {
  requested: "return_requested",
  approved: "return_approved",
  rejected: "return_rejected",
  pickup_scheduled: "return_pickup_scheduled",
  picked_up: "return_picked_up",
  refund_processed: "refund_processed",
  refund_completed: "refund_completed"
};

async function processReturnEvent({ shopDomain, payload }) {
  const status = payload.status;
  const templateCode = returnTemplateMap[status] || null;

  const eventInsert = await pool.query(
    `
    INSERT INTO returns_events (shop_domain, return_reference, shopify_customer_id, status, payload, processed_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
    RETURNING id
    `,
    [
      shopDomain,
      payload.return_reference || null,
      payload.shopify_customer_id || null,
      status,
      JSON.stringify(payload)
    ]
  );

  if (!templateCode) {
    return { skipped: true, reason: "Unknown status", eventId: eventInsert.rows[0].id };
  }

  const customer = await getCustomerByShopifyId(shopDomain, payload.shopify_customer_id);
  if (!customer) {
    return { skipped: true, reason: "Customer not found", eventId: eventInsert.rows[0].id };
  }

  const template = await getTemplate(shopDomain, templateCode);
  if (!template) {
    return { skipped: true, reason: "Template not found", eventId: eventInsert.rows[0].id };
  }

  return sendToCustomerTokens({
    shopDomain,
    customerId: customer.id,
    type: "return_event",
    title: template.title,
    message: template.message,
    deepLink: template.deep_link || `/returns/${payload.return_reference || ""}`,
    data: {
      returnReference: payload.return_reference || "",
      status: templateCode
    }
  });
}

module.exports = {
  processReturnEvent
};
