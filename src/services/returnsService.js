const pool = require("../db/pool");
const { getCustomerByEmail, getCustomerByShopifyId } = require("./customerService");
const { getTemplate } = require("./templateService");
const { sendToCustomerTokens } = require("./notificationService");

const returnTemplateMap = {
  in_review: "return_requested",
  review: "return_requested",
  pending_review: "return_requested",
  requested: "return_requested",
  request_received: "return_requested",
  return_requested: "return_requested",
  solicitud_de_devolucion_recibida: "return_requested",
  approved_by_store: "return_approved",
  approve: "return_approved",
  approved: "return_approved",
  return_approved: "return_approved",
  devolucion_aprobada: "return_approved",
  rejected_by_store: "return_rejected",
  reject: "return_rejected",
  rejected: "return_rejected",
  return_rejected: "return_rejected",
  devolucion_rechazada: "return_rejected",
  schedule_pickup: "return_pickup_scheduled",
  pickup_scheduled: "return_pickup_scheduled",
  collection_scheduled: "return_pickup_scheduled",
  recoleccion_programada: "return_pickup_scheduled",
  pickedup: "return_picked_up",
  picked_up: "return_picked_up",
  product_picked_up: "return_picked_up",
  producto_recogido: "return_picked_up",
  refund_issued: "refund_processed",
  refund_in_process: "refund_processed",
  refund_processed: "refund_processed",
  reembolso_procesado: "refund_processed",
  refunded: "refund_completed",
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

function resolveTemplateCodeFromReturnPayload(payload) {
  const statusCandidates = [
    payload.status,
    payload.event,
    payload.action,
    payload.return_status,
    payload.returnStatus,
    payload.type
  ];

  for (const candidate of statusCandidates) {
    const normalized = normalizeReturnStatus(candidate);
    const templateCode = returnTemplateMap[normalized];
    if (templateCode) {
      return { templateCode, normalizedStatus: normalized };
    }
  }

  return { templateCode: null, normalizedStatus: normalizeReturnStatus(payload.status) || "unknown" };
}

async function resolveCustomer(shopDomain, payload) {
  const customerIdCandidates = [
    payload.shopify_customer_id,
    payload.shopifyCustomerId,
    payload.customer_id,
    payload.customerId,
    payload.customer?.id
  ];

  for (const value of customerIdCandidates) {
    if (!value) {
      continue;
    }
    const customer = await getCustomerByShopifyId(shopDomain, value);
    if (customer) {
      return customer;
    }
  }

  const email = payload.email || payload.customer?.email || payload.customer_email || payload.customerEmail;
  if (email) {
    return getCustomerByEmail(shopDomain, email);
  }

  return null;
}

async function processReturnEvent({ shopDomain, payload }) {
  const { templateCode, normalizedStatus } = resolveTemplateCodeFromReturnPayload(payload);
  const returnReference =
    payload.return_reference || payload.returnReference || payload.return_id || payload.returnId || null;

  const rawCustomerId =
    payload.shopify_customer_id ||
    payload.shopifyCustomerId ||
    payload.customer_id ||
    payload.customerId ||
    payload.customer?.id ||
    null;
  const normalizedCustomerId = rawCustomerId ? Number(rawCustomerId) || null : null;

  const eventInsert = await pool.query(
    `
    INSERT INTO returns_events (shop_domain, return_reference, shopify_customer_id, status, payload, processed_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
    RETURNING id
    `,
    [
      shopDomain,
      returnReference,
      normalizedCustomerId,
      normalizedStatus,
      JSON.stringify(payload)
    ]
  );

  if (!templateCode) {
    return { skipped: true, reason: "Unknown status", eventId: eventInsert.rows[0].id };
  }

  const customer = await resolveCustomer(shopDomain, payload);
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
    deepLink: template.deep_link || `/returns/${returnReference || ""}`,
    data: {
      returnReference: returnReference || "",
      status: templateCode
    }
  });
}

module.exports = {
  processReturnEvent
};
