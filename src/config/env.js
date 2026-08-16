const dotenv = require("dotenv");

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizeScopes(value, requiredScopes = []) {
  const scopes = new Set(
    String(value || "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean)
  );

  for (const scope of requiredScopes) {
    scopes.add(scope);
  }

  return Array.from(scopes).join(",");
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  databaseUrl: required("DATABASE_URL"),
  shopifyApiKey: process.env.SHOPIFY_API_KEY || "",
  shopifyApiSecret: process.env.SHOPIFY_API_SECRET || "",
  shopifyScopes: normalizeScopes(process.env.SHOPIFY_SCOPES, ["read_products", "write_products", "read_themes", "write_themes"]),
  shopifyAppUrl: process.env.SHOPIFY_APP_URL || "http://localhost:3000",
  shopifyStorefrontBaseUrl: process.env.SHOPIFY_STOREFRONT_BASE_URL || "",
  returnsPortalUrl: process.env.RETURNS_PORTAL_URL || "",
  appInternalApiKey: process.env.APP_INTERNAL_API_KEY || "",
  jwtSecret: process.env.JWT_SECRET || "change_me",
  fcmProjectId: process.env.FCM_PROJECT_ID || "",
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
  cronEnabled: String(process.env.CRON_ENABLED || "true").toLowerCase() === "true",
  notificationsMaxPerCustomer: Number(process.env.NOTIFICATIONS_MAX_PER_CUSTOMER || 100),
  abandonedCartSweepCron: process.env.ABANDONED_CART_SWEEP_CRON || "* * * * *",
  notificationsFailedRetentionDays: Number(process.env.NOTIFICATIONS_FAILED_RETENTION_DAYS || 30),
  notificationsVacuumEnabled: String(process.env.NOTIFICATIONS_VACUUM_ENABLED || "true").toLowerCase() === "true",
  notificationsDisplayTimezone: process.env.NOTIFICATIONS_DISPLAY_TIMEZONE || "America/Mexico_City"
};

module.exports = env;
