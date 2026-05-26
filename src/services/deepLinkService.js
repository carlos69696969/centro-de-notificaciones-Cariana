const env = require("../config/env");

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function safeTrim(value) {
  return String(value || "").trim();
}

function normalizeOrderNumber(value) {
  return safeTrim(value).replace(/^#/, "");
}

function normalizeOrderId(value) {
  const text = safeTrim(value);
  if (!text) {
    return "";
  }
  if (/^\d+$/.test(text)) {
    return text;
  }
  const match = text.match(/(\d+)(?!.*\d)/);
  return match ? match[1] : "";
}

function normalizeShopDomain(value) {
  return safeTrim(value).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function normalizeBaseUrl(shopDomain) {
  const configuredBase = safeTrim(process.env.SHOPIFY_STOREFRONT_BASE_URL || env.shopifyStorefrontBaseUrl || "");
  if (configuredBase) {
    return configuredBase.replace(/\/+$/, "");
  }

  const normalizedShop = normalizeShopDomain(shopDomain);
  if (!normalizedShop) {
    return "";
  }
  return `https://${normalizedShop}`;
}

function toAbsoluteStorefrontUrl(shopDomain, pathOrUrl) {
  const value = safeTrim(pathOrUrl);
  if (!value) {
    return "";
  }
  if (isAbsoluteUrl(value)) {
    return value;
  }

  const base = normalizeBaseUrl(shopDomain);
  if (!base) {
    return value;
  }

  const normalizedPath = value.startsWith("/") ? value : `/${value}`;
  return `${base}${normalizedPath}`;
}

function toAbsoluteShopDomainUrl(shopDomain, pathOrUrl) {
  const value = safeTrim(pathOrUrl);
  if (!value) {
    return "";
  }
  if (isAbsoluteUrl(value)) {
    return value;
  }

  const normalizedShop = normalizeShopDomain(shopDomain);
  if (!normalizedShop) {
    return value;
  }

  const normalizedPath = value.startsWith("/") ? value : `/${value}`;
  return `https://${normalizedShop}${normalizedPath}`;
}

function appendQueryParams(urlString, params) {
  const validEntries = Object.entries(params).filter(([, value]) => safeTrim(value));
  if (!validEntries.length) {
    return urlString;
  }

  try {
    const parsed = new URL(urlString);
    for (const [key, value] of validEntries) {
      parsed.searchParams.set(key, safeTrim(value));
    }
    return parsed.toString();
  } catch (_error) {
    const query = validEntries
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(safeTrim(value))}`)
      .join("&");
    const separator = urlString.includes("?") ? "&" : "?";
    return `${urlString}${separator}${query}`;
  }
}

function buildOrderDeepLink({ shopDomain, orderNumber, orderId, orderStatusUrl, deepLink }) {
  if (safeTrim(deepLink)) {
    return toAbsoluteStorefrontUrl(shopDomain, deepLink);
  }

  const normalizedStatusUrl = safeTrim(orderStatusUrl);
  if (normalizedStatusUrl) {
    return toAbsoluteStorefrontUrl(shopDomain, normalizedStatusUrl);
  }

  const normalizedOrderId = normalizeOrderId(orderId);
  const normalizedOrder = normalizeOrderNumber(orderNumber);
  if (normalizedOrderId) {
    const query = normalizedOrder ? `?order=${encodeURIComponent(normalizedOrder)}` : "";
    return toAbsoluteStorefrontUrl(shopDomain, `/account/orders/${normalizedOrderId}${query}`);
  }

  const fallbackQuery = normalizedOrder ? `?order=${encodeURIComponent(normalizedOrder)}` : "";
  return toAbsoluteStorefrontUrl(shopDomain, `/account/orders${fallbackQuery}`);
}

function buildReturnDeepLink({ shopDomain, orderNumber, email, deepLink }) {
  const normalizedOrder = normalizeOrderNumber(orderNumber);
  const normalizedEmail = safeTrim(email).toLowerCase();
  const bridgeUrl = toAbsoluteShopDomainUrl(shopDomain, "/apps/notificaciones/open-return");

  return appendQueryParams(bridgeUrl, {
    order: normalizedOrder,
    email: normalizedEmail
  });
}

function buildCampaignDeepLink({ shopDomain, deepLink }) {
  if (safeTrim(deepLink)) {
    return toAbsoluteStorefrontUrl(shopDomain, deepLink);
  }
  return toAbsoluteStorefrontUrl(shopDomain, "/");
}

module.exports = {
  buildOrderDeepLink,
  buildReturnDeepLink,
  buildCampaignDeepLink,
  toAbsoluteStorefrontUrl
};
