const admin = require("firebase-admin");
const env = require("../config/env");
const logger = require("../utils/logger");

let initialized = false;

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
    const messageId = await admin.messaging().send({
      token,
      // Data-only payload ensures Android handles the tap through
      // CarianaFirebaseMessagingService + PendingIntent deep link.
      data: {
        ...(payload.data || {}),
        title: payload.title || "CARIANA",
        body: payload.body || "",
        message: payload.body || payload.data?.message || ""
      },
      android: {
        priority: "high"
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
