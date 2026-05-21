const crypto = require("crypto");
const env = require("../config/env");

function timingSafeEqualHex(a, b) {
  const aBuf = Buffer.from(String(a || ""), "utf8");
  const bBuf = Buffer.from(String(b || ""), "utf8");
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyAppProxySignature(queryString) {
  const params = new URLSearchParams(queryString || "");
  const signature = params.get("signature");
  if (!signature || !env.shopifyApiSecret) {
    return false;
  }

  const queryMap = {};
  for (const [key, value] of params.entries()) {
    if (key === "signature") {
      continue;
    }
    if (!queryMap[key]) {
      queryMap[key] = [];
    }
    queryMap[key].push(value);
  }

  const sortedParams = Object.keys(queryMap)
    .sort()
    .map((key) => `${key}=${queryMap[key].join(",")}`)
    .join("");

  const calculated = crypto.createHmac("sha256", env.shopifyApiSecret).update(sortedParams).digest("hex");
  return timingSafeEqualHex(signature, calculated);
}

module.exports = {
  verifyAppProxySignature
};
