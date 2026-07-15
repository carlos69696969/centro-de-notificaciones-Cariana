const admin = require("firebase-admin");
const env = require("../config/env");
const logger = require("../utils/logger");

let initialized = false;

function androidChannelForPayload(payload = {}) {
  const data = payload.data || {};
  const type = String(data.type || data.status || data.deepLinkType || "").trim().toLowerCase();
  if (
    [
      "return_requested",
      "return_received",
      "return_approved",
      "refund_issued",
      "refund_processed",
      "return_rejected"
    ].includes(type)
  ) {
    return "cariana_returns_v2";
  }
  if (
    [
      "order_shipped",
      "order_out_for_delivery",
      "order_delivered"
    ].includes(type)
  ) {
    return "cariana_shipping_v2";
  }
  if (
    [
      "order_created",
      "order_paid",
      "order_preparing",
      "order_ready",
      "order_confirmed"
    ].includes(type)
  ) {
    return "cariana_orders_v2";
  }
  if (["promo", "promotion", "campaign", "cart"].includes(type)) {
    return "cariana_promos_v2";
  }
  return "cariana_general_v2";
}

function initFirebase() {
  if (initialized) {
    return;
  }

  if (!env.firebaseServiceAccountJson) {
    logger.warn("Firebase service account is not configured; FCM sends will be skipped");
    initialized = true;
    return;
  }

  const serviceAccount = JSON.parse(env.firebaseServiceAccountJson);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: env.fcmProjectId || serviceAccount.project_id
  });
  initialized = true;
}

async function sendToToken(token, payload) {
  initFirebase();

  if (!admin.apps.length) {
    return {
      ok: false,
      error: "Firebase not configured"
    };
  }

  try {
    const title = payload.title || "CARIANA";
    const body = payload.body || "";
    const messageId = await admin.messaging().send({
      token,
      notification: {
        title,
        body
      },
      data: {
        ...(payload.data || {}),
        title,
        body,
        message: payload.body || payload.data?.message || ""
      },
      android: {
        priority: "high",
        notification: {
          channelId: androidChannelForPayload(payload),
          sound: "cariana_notification_sound"
        }
      }
    });

    return {
      ok: true,
      messageId
    };
  } catch (error) {
    const code = error.errorInfo?.code || error.code || "unknown";
    return {
      ok: false,
      error: code
    };
  }
}

module.exports = {
  sendToToken
};
