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

const app = express();

app.use(cors());
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
