const pool = require("../db/pool");
const {
  getCustomerByEmail,
  getCustomerByShopifyId,
  upsertCustomerFromShopify
} = require("./customerService");
const { getTemplate } = require("./templateService");
const { sendToCustomerTokens, sendToEmailTokens } = require("./notificationService");
const { buildReturnDeepLink } = require("./deepLinkService");

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
    title: "Intento de recoleccion fallido",
    message: "No se pudo completar la recoleccion de tu devolucion."
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
    const byEmail = await getCustomerByEmail(shopDomain, email);
    if (byEmail) {
      return byEmail;
    }
  }

  return resolveCustomerFromOrderContext(shopDomain, payload);
}

async function resolveCustomerFromOrderContext(shopDomain, payload) {
  const email = String(
    payload.email || payload.customer?.email || payload.customer_email || payload.customerEmail || ""
  )
    .trim()
    .toLowerCase();
  const orderNumberRaw =
    payload.order_number ||
    payload.orderNumber ||
    payload.return_reference ||
    payload.returnReference ||
    payload.return_id ||
    payload.returnId ||
    "";
  const orderNumber = String(orderNumberRaw).replace(/^#/, "").trim();

  if (!email && !orderNumber) {
    return null;
  }

  const orderContext = await pool.query(
    `
    SELECT
      payload->>'order_number' AS order_number,
      payload->>'name' AS order_name,
      payload->'customer'->>'id' AS customer_id,
      payload->'customer'->>'email' AS customer_email
    FROM notification_events
    WHERE shop_domain = $1
      AND topic IN ('orders/create','orders/updated','orders/fulfilled')
      AND (
        ($2 <> '' AND (
          payload->>'order_number' = $2
          OR payload->>'name' = CONCAT('#', $2)
        ))
        OR ($3 <> '' AND LOWER(COALESCE(payload->'customer'->>'email', '')) = $3)
      )
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [shopDomain, orderNumber, email]
  );

  const context = orderContext.rows[0];
  if (!context) {
    return null;
  }

  const contextCustomerId = Number(context.customer_id || 0);
  const contextEmail = String(context.customer_email || email || "").trim() || null;

  if (!contextCustomerId) {
    if (!contextEmail) {
      return null;
    }
    return getCustomerByEmail(shopDomain, contextEmail);
  }

  if (contextEmail) {
    await upsertCustomerFromShopify(shopDomain, {
      id: contextCustomerId,
      email: contextEmail
    });
  }

  return getCustomerByShopifyId(shopDomain, contextCustomerId);
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

function pickFirstString(candidates) {
  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function truncateText(value, max = 90) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function extractProductNames(payload) {
  const fromArrays = []
    .concat(Array.isArray(payload.items) ? payload.items : [])
    .concat(Array.isArray(payload.products) ? payload.products : [])
    .concat(Array.isArray(payload.line_items) ? payload.line_items : [])
    .concat(Array.isArray(payload.lineItems) ? payload.lineItems : []);

  const fromArrayName = fromArrays
    .map((item) =>
      pickFirstString([
        item?.name,
        item?.title,
        item?.product_name,
        item?.productName,
        item?.sku_name
      ])
    )
    .filter(Boolean);

  const direct = pickFirstString([
    payload.product_name,
    payload.productName,
    payload.item_name,
    payload.itemName,
    payload.product?.name,
    payload.product?.title
  ]);

  const combined = []
    .concat(direct ? [direct] : [])
    .concat(fromArrayName)
    .map((name) => truncateText(name, 42))
    .filter(Boolean);

  return Array.from(new Set(combined)).slice(0, 5);
}

function extractRejectionReason(payload, options = {}) {
  const allowMessageFallback = options.allowMessageFallback === true;
  const candidates = [
    payload.reason,
    payload.rejection_reason,
    payload.rejectionReason,
    payload.reject_reason,
    payload.rejectReason,
    payload.denial_reason,
    payload.denialReason,
    payload.motivo,
    payload.motivo_de_negacion,
    payload.motivoNegacion
  ];

  if (allowMessageFallback) {
    candidates.push(payload.note, payload.message);
  }

  return truncateText(pickFirstString(candidates));
}

function formatProductsInline(productNames = []) {
  const clean = (Array.isArray(productNames) ? productNames : []).filter(Boolean).slice(0, 5);
  if (!clean.length) {
    return "";
  }
  return clean.join(", ");
}

const returnStatusLabels = {
  return_requested: "Solicitud recibida",
  return_approved: "Aprobada",
  return_rejected: "Rechazada",
  return_pickup_scheduled: "Intento de recoleccion fallido",
  return_picked_up: "Producto recogido",
  refund_processed: "Reembolso procesado",
  refund_completed: "Reembolso completado"
};

function buildReturnStatusTitle(templateCode) {
  const map = {
    return_requested: "Devolucion en revision",
    return_approved: "Devolucion aprobada",
    return_rejected: "Devolucion rechazada",
    return_pickup_scheduled: "Intento de recoleccion fallido",
    return_picked_up: "Producto recogido",
    refund_processed: "Reembolso procesado",
    refund_completed: "Reembolso completado"
  };
  return map[templateCode] || "Actualizacion de devolucion";
}

function isReturnedToCustomerEvent(payload = {}) {
  const action = normalizeReturnStatus(payload.action || payload.event_action || payload.eventAction || "");
  return action === "mark_returned_to_customer";
}

function isBranchReturnMethod(payload = {}) {
  const method = normalizeReturnStatus(
    payload.return_method ||
      payload.returnMethod ||
      payload.method ||
      payload.delivery_method ||
      payload.deliveryMethod ||
      payload.metodo ||
      ""
  );

  return method === "branch" || method === "sucursal" || method === "store_dropoff";
}

function buildPortalCurrentStatusText(templateCode, payload, fallbackMessage) {
  if (isReturnedToCustomerEvent(payload)) {
    return "📦Tu devolucion ya fue recogida en nuestra sucursal de devoluciones. Gracias por recoger tu devolucion.";
  }

  if (templateCode === "return_approved" && isBranchReturnMethod(payload)) {
    return "Tu solicitud de devolución fue aprobada. 📦 Por favor, lleva tu producto a la sucursal de devoluciones siguiendo las instrucciones de entrega.";
  }

  if (templateCode === "return_picked_up") {
    return "Producto recibido. 📦 Hemos recibido tu devolución y nuestro equipo ya se encuentra revisando tu producto. Una vez finalizado el proceso de verificación, realizaremos tu reembolso correspondiente. 💰";
  }
  if (templateCode === "refund_processed") {
    return "Tu reembolso ya fue procesado correctamente. Dependiendo de tu banco, puede reflejarse en un plazo de 5 a 10 dias habiles.";
  }

  const fromPayload = truncateText(
    pickFirstString([
      payload.portal_status_message,
      payload.portalStatusMessage,
      payload.status_message,
      payload.statusMessage,
      payload.current_status_message,
      payload.currentStatusMessage,
      payload.latest_status_message,
      payload.latestStatusMessage,
      payload.note,
      payload.message
    ]),
    180
  );
  if (fromPayload) {
    return fromPayload;
  }

  const byStatus = {
    return_requested:
      "Tu solicitud esta siendo revisada por nuestro equipo, regresa mas tarde para revisar el estado de tu solicitud.",
    return_approved:
      "Tu solicitud fue aprobada y estamos coordinando el siguiente paso de tu devolucion.",
    return_rejected:
      "Tu solicitud fue rechazada. Revisa el detalle para conocer el motivo y las opciones disponibles.",
    return_pickup_scheduled:
      "No se pudo completar la recoleccion. Estamos gestionando un nuevo intento para tu devolucion.",
    return_picked_up:
      "Tu paquete ya fue recolectado y estamos procesando tu devolucion.",
    refund_processed:
      "Tu reembolso fue procesado y se vera reflejado segun los tiempos de tu metodo de pago.",
    refund_completed:
      "Tu reembolso fue completado correctamente."
  };

  return byStatus[templateCode] || truncateText(fallbackMessage, 180);
}

function buildReturnPremiumTemplate({
  templateCode,
  orderNumber,
  payload,
  fallbackMessage,
  contextProductNames = []
}) {
  const normalizedOrder = String(orderNumber || "").replace(/^#/, "").trim();
  const payloadProductNames = extractProductNames(payload);
  const mergedProductNames = Array.from(new Set([...(payloadProductNames || []), ...(contextProductNames || [])])).slice(
    0,
    5
  );
  const productsInline = formatProductsInline(mergedProductNames);
  const rejectionReason = extractRejectionReason(payload, {
    allowMessageFallback: templateCode === "return_rejected"
  });
  const statusLabel = returnStatusLabels[templateCode] || "Actualizacion";
  const statusTitle = isReturnedToCustomerEvent(payload)
    ? "Devolucion entregada"
    : buildReturnStatusTitle(templateCode);
  const portalCurrentText = buildPortalCurrentStatusText(templateCode, payload, fallbackMessage);

  if (templateCode === "return_rejected") {
    const formalTitle = statusTitle;
    const formalParts = [];
    if (normalizedOrder) {
      formalParts.push(`Pedido #${normalizedOrder}.`);
    }
    if (productsInline) {
      formalParts.push(`${productsInline}.`);
    }
    const fallbackDetail = truncateText(fallbackMessage, 80);
    if (!productsInline && fallbackDetail) {
      formalParts.push(`${fallbackDetail}.`);
    }
    if (portalCurrentText) {
      formalParts.push(portalCurrentText);
    }

    return {
      title: formalTitle,
      message: formalParts.join(" "),
      productNames: mergedProductNames,
      productsInline,
      rejectionReason,
      statusLabel
    };
  }

  const title = statusTitle;

  const parts = [];
  if (normalizedOrder) {
    parts.push(`Pedido #${normalizedOrder}.`);
  }
  if (productsInline) {
    parts.push(`${productsInline}.`);
  }
  const detail = truncateText(fallbackMessage, 70);
  if (detail && !productsInline) {
    parts.push(`${detail}.`);
  }
  if (portalCurrentText) {
    parts.push(portalCurrentText);
  }

  return {
    title,
    message: parts.join(" "),
    productNames: mergedProductNames,
    productsInline,
    rejectionReason,
    statusLabel
  };
}

async function resolveOrderProductNamesFromContext(shopDomain, payload) {
  const orderNumberRaw =
    payload.order_number ||
    payload.orderNumber ||
    payload.return_reference ||
    payload.returnReference ||
    payload.return_id ||
    payload.returnId ||
    "";
  const orderNumber = String(orderNumberRaw).replace(/^#/, "").trim();
  if (!orderNumber) {
    return [];
  }

  const email = String(
    payload.email || payload.customer?.email || payload.customer_email || payload.customerEmail || ""
  )
    .trim()
    .toLowerCase();

  const result = await pool.query(
    `
    SELECT payload
    FROM notification_events
    WHERE shop_domain = $1
      AND topic IN ('orders/create','orders/updated','orders/fulfilled')
      AND (
        payload->>'order_number' = $2
        OR payload->>'name' = CONCAT('#', $2)
        OR ($3 <> '' AND LOWER(COALESCE(payload->'customer'->>'email', '')) = $3)
      )
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [shopDomain, orderNumber, email]
  );

  const orderPayload = result.rows[0]?.payload || {};
  return extractProductNames(orderPayload);
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

  if (templateCode === "refund_completed") {
    return { skipped: true, reason: "Refund completed notifications are disabled", eventId: eventInsert.rows[0].id };
  }

  const eventEmail = extractEventEmail(payload);
  const orderNumber = payload.order_number || payload.orderNumber || returnReference || "";
  const customer = await resolveCustomer(shopDomain, payload);
  const contextProductNames = await resolveOrderProductNamesFromContext(shopDomain, payload);

  const dbTemplate = await getTemplate(shopDomain, templateCode);
  const template = dbTemplate || fallbackTemplateFor(templateCode, payload);
  if (!template) {
    return { skipped: true, reason: "Template not found", eventId: eventInsert.rows[0].id };
  }

  const premiumCopy = buildReturnPremiumTemplate({
    templateCode,
    orderNumber,
    payload,
    fallbackMessage: template.message,
    contextProductNames
  });
  const notificationTitle = premiumCopy.title || template.title;
  const notificationMessage = premiumCopy.message || template.message;
  const notificationData = {
    returnReference: returnReference || "",
    status: templateCode,
    statusLabel: premiumCopy.statusLabel || "",
    orderNumber: orderNumber || "",
    customerEmail: eventEmail || "",
    productName: premiumCopy.productsInline || "",
    productNames: premiumCopy.productNames || [],
    reason: premiumCopy.rejectionReason || "",
    deepLinkType: "return",
    deeplinkType: "return",
    linkType: "return",
    notificationType: "return_event",
    eventType: "return_event",
    route: "returns",
    openScreen: "returns_portal"
  };

  if (customer?.id) {
    const primaryResult = await sendToCustomerTokens({
      shopDomain,
      customerId: customer.id,
      type: "return_event",
      title: notificationTitle,
      message: notificationMessage,
      deepLink: buildReturnDeepLink({
        shopDomain,
        orderNumber,
        email: eventEmail,
        deepLink: template.deep_link
      }),
      data: notificationData,
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
      title: notificationTitle,
      message: notificationMessage,
      deepLink: buildReturnDeepLink({
        shopDomain,
        orderNumber,
        email: eventEmail,
        deepLink: template.deep_link
      }),
      data: notificationData,
      eventId: eventInsert.rows[0].id
    });
  }

  return { skipped: true, reason: "Customer not found", eventId: eventInsert.rows[0].id };
}

module.exports = {
  processReturnEvent
};
