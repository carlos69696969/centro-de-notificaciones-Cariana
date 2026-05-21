const pool = require("../db/pool");
const { getCustomerByShopifyId } = require("./customerService");
const { getTemplate } = require("./templateService");
const { sendToCustomerTokens } = require("./notificationService");

const returnTemplateMap = {
  requested: "return_requested",
  request_received: "return_requested",
  return_requested: "return_requested",
  solicitud_de_devolucion_recibida: "return_requested",
  approved: "return_approved",
  return_approved: "return_approved",
  devolucion_aprobada: "return_approved",
  rejected: "return_rejected",
  return_rejected: "return_rejected",
  devolucion_rechazada: "return_rejected",
  pickup_scheduled: "return_pickup_scheduled",
  collection_scheduled: "return_pickup_scheduled",
  recoleccion_programada: "return_pickup_scheduled",
  picked_up: "return_picked_up",
  product_picked_up: "return_picked_up",
  producto_recogido: "return_picked_up",
  refund_processed: "refund_processed",
  reembolso_procesado: "refund_processed",
  refund_completed: "refund_completed",
  reembolso_completado: "refund_completed"
};

function normalizeReturnStatus(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s-]+/g, "_");
}

async function processReturnEvent({ shopDomain, payload }) {
  const status = payload.status;
  const normalizedStatus = normalizeReturnStatus(status);
  const templateCode = returnTemplateMap[normalizedStatus] || null;

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
      normalizedStatus || status,
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
