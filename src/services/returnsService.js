const pool = require("../db/pool");
const { getCustomerByEmail, getCustomerByShopifyId } = require("./customerService");
const { getTemplate } = require("./templateService");
const { sendToCustomerTokens, sendToEmailTokens } = require("./notificationService");

const returnTemplateMap = {
  // Generic review/request aliases
  in_review: "return_requested",
  en_revision: "return_requested",
  review: "return_requested",
  pending_review: "return_requested",
  requested: "return_requested",
  request_received: "return_requested",
  return_requested: "return_requested",
  approve_request: "return_approved",
  confirm_request: "return_requested",
  solicitud_de_devolucion_recibida: "return_requested",

  // Approved aliases
  approved_by_store: "return_approved",
  approve: "return_approved",
  aprobada: "return_approved",
  approved: "return_approved",
  return_approved: "return_approved",
  devolucion_aprobada: "return_approved",

  // Rejected aliases
  rejected_by_store: "return_rejected",
  reject: "return_rejected",
  reject_request: "return_rejected",
  reject_after_failed_pickups: "return_rejected",
  deny_received: "return_rejected",
  mark_returned_to_customer: "return_rejected",
  mark_not_returned: "return_rejected",
  rejected: "return_rejected",
  rechazada: "return_rejected",
  reembolso_denegado: "return_rejected",
  no_devuelto: "return_rejected",
  return_rejected: "return_rejected",
  devolucion_rechazada: "return_rejected",

  // Pickup scheduled / attempt aliases
  schedule_pickup: "return_pickup_scheduled",
  return_pickup_scheduled: "return_pickup_scheduled",
  pickup_attempt_failed: "return_pickup_scheduled",
  intento_fallido_1: "return_pickup_scheduled",
  intento_fallido_2: "return_pickup_scheduled",
  pickup_scheduled: "return_pickup_scheduled",
  collection_scheduled: "return_pickup_scheduled",
  recoleccion_programada: "return_pickup_scheduled",

  // Picked-up / received aliases
  mark_received: "return_picked_up",
  recibida: "return_picked_up",
  return_picked_up: "return_picked_up",
  pickedup: "return_picked_up",
  picked_up: "return_picked_up",
  product_picked_up: "return_picked_up",
  producto_recogido: "return_picked_up",

  // Refund aliases
  process_refund: "refund_completed",
  refund_issued: "refund_processed",
  refund_in_process: "refund_processed",
  refund_processed: "refund_processed",
  reembolso_procesado: "refund_processed",
  refunded: "refund_completed",
  reembolsada: "refund_completed",
  completada: "refund_completed",
  refund_completed: "refund_completed",
  reembolso_completado: "refund_completed"
};

const defaultReturnTemplates = {
  return_requested: {
    title: "Devolucion solicitada",
    message: "Tu solicitud de devolucion ha sido recibida."
  },
  return_approved: {
    title: "Devolucion aprobada",
    message: "Tu devolucion ha sido aprobada."
  },
  return_rejected: {
    title: "Devolucion rechazada",
    message: "Tu devolucion ha sido rechazada."
  },
  return_pickup_scheduled: {
    title: "Recoleccion programada",
    message: "La recoleccion de tu devolucion fue programada."
  },
  return_picked_up: {
    title: "Producto recogido",
    message: "Recibimos tu producto para continuar con tu devolucion."
  },
  refund_processed: {
    title: "Reembolso procesado",
    message: "Tu reembolso ya fue procesado."
  },
  refund_completed: {
    title: "Reembolso completado",
    message: "Tu reembolso fue completado."
  }
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

function extractEventEmail(payload) {
  return (
    payload.email ||
    payload.customer?.email ||
    payload.customer_email ||
    payload.customerEmail ||
    ""
  );
}

function fallbackTemplateFor(templateCode, payload) {
  const base = defaultReturnTemplates[templateCode];
  if (!base) {
    return null;
  }

  const note = String(payload.note || payload.message || "").trim();
  return {
    title: base.title,
    message: note || base.message,
    deep_link: null
  };
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

  const eventEmail = extractEventEmail(payload);
  const customer = await resolveCustomer(shopDomain, payload);

  const dbTemplate = await getTemplate(shopDomain, templateCode);
  const template = dbTemplate || fallbackTemplateFor(templateCode, payload);
  if (!template) {
    return { skipped: true, reason: "Template not found", eventId: eventInsert.rows[0].id };
  }

  if (customer?.id) {
    const primaryResult = await sendToCustomerTokens({
      shopDomain,
      customerId: customer.id,
      type: "return_event",
      title: template.title,
      message: template.message,
      deepLink: template.deep_link || `/returns/${returnReference || ""}`,
      data: {
        returnReference: returnReference || "",
        status: templateCode
      },
      eventId: eventInsert.rows[0].id
    });

    if (primaryResult.total > 0 || !eventEmail) {
      return primaryResult;
    }
  }

  if (eventEmail) {
    return sendToEmailTokens({
      shopDomain,
      email: eventEmail,
      type: "return_event",
      title: template.title,
      message: template.message,
      deepLink: template.deep_link || `/returns/${returnReference || ""}`,
      data: {
        returnReference: returnReference || "",
        status: templateCode
      },
      eventId: eventInsert.rows[0].id
    });
  }

  return { skipped: true, reason: "Customer not found", eventId: eventInsert.rows[0].id };
}

module.exports = {
  processReturnEvent
};
