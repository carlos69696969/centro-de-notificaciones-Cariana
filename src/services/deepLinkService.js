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

function normalizeBaseUrl(shopDomain) {
  const configuredBase = safeTrim(process.env.SHOPIFY_STOREFRONT_BASE_URL || env.shopifyStorefrontBaseUrl || "");
  if (configuredBase) {
    return configuredBase.replace(/\/+$/, "");
  }

  const normalizedShop = safeTrim(shopDomain).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
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

  const normalizedShop = safeTrim(shopDomain).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!normalizedShop) {
    return value;
  }

  const normalizedPath = value.startsWith("/") ? value : `/${value}`;
  return `https://${normalizedShop}${normalizedPath}`;
}

function buildOrderDeepLink({ shopDomain, orderNumber, deepLink }) {
  if (safeTrim(deepLink)) {
    return toAbsoluteStorefrontUrl(shopDomain, deepLink);
  }

  const normalizedOrder = normalizeOrderNumber(orderNumber);
  const query = normalizedOrder ? `?order=${encodeURIComponent(normalizedOrder)}` : "";
  return toAbsoluteStorefrontUrl(shopDomain, `/account/orders${query}`);
}

function buildReturnDeepLink({ shopDomain, orderNumber, email, deepLink }) {
  if (safeTrim(deepLink)) {
    return toAbsoluteShopDomainUrl(shopDomain, deepLink);
  }

  const normalizedOrder = normalizeOrderNumber(orderNumber);
  const normalizedEmail = safeTrim(email).toLowerCase();

  const params = new URLSearchParams();
  if (normalizedOrder) {
    params.set("order", normalizedOrder);
  }
  if (normalizedEmail) {
    params.set("email", normalizedEmail);
  }

  const query = params.toString();
  const path = query ? `/apps/portal-devoluciones?${query}` : "/apps/portal-devoluciones";
  return toAbsoluteShopDomainUrl(shopDomain, path);
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
