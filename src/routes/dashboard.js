const express = require("express");
const pool = require("../db/pool");
const { getDashboardMetrics } = require("../services/metricsService");

const router = express.Router();

router.get("/metrics", async (req, res, next) => {
  try {
    if (!req.shopDomain) {
      return res.status(400).json({ error: "shopDomain is required" });
    }
    const metrics = await getDashboardMetrics(req.shopDomain);
    return res.json(metrics);
  } catch (error) {
    return next(error);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    if (!req.shopDomain) {
      return res.status(400).json({ error: "shopDomain is required" });
    }
    const history = await pool.query(
      `
      SELECT id, type, title, message, status, created_at, opened_at, converted_at
      FROM notifications
      WHERE shop_domain = $1
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [req.shopDomain]
    );
    return res.json({ history: history.rows });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
