const express = require("express");
const cors = require("cors");
const path = require("path");
const env = require("./config/env");
const logger = require("./utils/logger");
const { startScheduler } = require("./jobs/scheduler");
const { requireInternalApiKey, resolveShopDomain } = require("./middleware/auth");

const healthRoutes = require("./routes/health");
const webhooksRoutes = require("./routes/webhooks");
const authRoutes = require("./routes/auth");
const mobileRoutes = require("./routes/mobile");
const campaignsRoutes = require("./routes/campaigns");
const templatesRoutes = require("./routes/templates");
const dashboardRoutes = require("./routes/dashboard");
const returnsRoutes = require("./routes/returns");
const ordersRoutes = require("./routes/orders");
const returnSettingsRoutes = require("./routes/returnSettings");
const storefrontNotificationsRoutes = require("./routes/storefrontNotifications");
const abandonedCartRoutes = require("./routes/abandonedCart");
const variantVisualsRoutes = require("./routes/variantVisuals");

const app = express();
const APP_LINK_DOMAIN = "app.cariana.mx";
const SHOP_DOMAIN = "www.cariana.mx";
const APP_LINK_SHA256_CERT_FINGERPRINTS = [
  "C3:10:44:A6:80:8C:D7:C3:97:22:C6:21:BF:64:82:8C:A9:51:67:30:93:83:DE:62:B5:6B:3A:3F:72:56:69:00",
  "93:E7:AA:11:1D:A5:4F:95:EE:8C:2C:85:6A:21:78:3C:3F:FC:40:DD:ED:E5:0B:65:89:88:51:51:C1:9A:2A:4B",
  "11:82:74:13:F1:BE:85:D8:14:B9:2F:B9:E5:B1:E5:A7:D3:3A:66:94:E0:FE:3E:52:28:ED:42:87:83:86:CE:F4",
];

function normalizeHost(hostHeader) {
  return String(hostHeader || "")
    .split(":")[0]
    .toLowerCase();
}

app.use(cors());
app.get("/.well-known/assetlinks.json", (_req, res) => {
  res.type("application/json").send([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.carlosjuarez.cariana",
        sha256_cert_fingerprints: APP_LINK_SHA256_CERT_FINGERPRINTS,
      },
    },
  ]);
});
app.get("*", (req, res, next) => {
  if (normalizeHost(req.headers.host) !== APP_LINK_DOMAIN) {
    return next();
  }

  const target = new URL(req.originalUrl || "/", `https://${SHOP_DOMAIN}`);
  return res.redirect(302, target.toString());
});
app.use("/webhooks", webhooksRoutes);
app.use(express.json({ limit: "1mb" }));
app.use(resolveShopDomain);

app.use("/health", healthRoutes);
app.use("/auth", authRoutes);
app.use("/api/mobile", requireInternalApiKey, mobileRoutes);
app.use("/api/campaigns", requireInternalApiKey, campaignsRoutes);
app.use("/api/templates", requireInternalApiKey, templatesRoutes);
app.use("/api/dashboard", requireInternalApiKey, dashboardRoutes);
app.use("/api/returns", requireInternalApiKey, returnsRoutes);
app.use("/api/orders", requireInternalApiKey, ordersRoutes);
app.use("/api/return-settings", requireInternalApiKey, returnSettingsRoutes);
app.use("/api/abandoned-cart", requireInternalApiKey, abandonedCartRoutes);
app.use("/api/variant-visuals", requireInternalApiKey, variantVisualsRoutes);
app.use("/proxy/notifications", storefrontNotificationsRoutes);
app.use("/proxy/returns", returnsRoutes);
app.use("/proxy/orders", ordersRoutes);

app.get("/finanzas", (_req, res) => {
  res.sendFile(path.join(__dirname, "views", "finanzas.html"));
});

app.get("/variant-visuals", (_req, res) => {
  res.sendFile(path.join(__dirname, "views", "variant-visuals.html"));
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});

app.use((error, _req, res, _next) => {
  logger.error("Unhandled error", { error: error.message, stack: error.stack });
  res.status(500).json({ error: "Internal server error", detail: error.message });
});

app.listen(env.port, () => {
  logger.info("Server started", { port: env.port, nodeEnv: env.nodeEnv });
  startScheduler();
});
