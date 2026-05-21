const crypto = require("crypto");
const env = require("../config/env");

function safeCompare(a, b) {
  const first = Buffer.from(a || "", "utf8");
  const second = Buffer.from(b || "", "utf8");
  if (first.length !== second.length) {
    return false;
  }
  return crypto.timingSafeEqual(first, second);
}

function verifyWebhookHmac(rawBody, receivedHmac) {
  if (!env.shopifyApiSecret) {
    return false;
  }

  const digest = crypto.createHmac("sha256", env.shopifyApiSecret).update(rawBody).digest("base64");
  return safeCompare(digest, receivedHmac);
}

module.exports = {
  verifyWebhookHmac
};
