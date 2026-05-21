const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    if (!req.shopDomain) {
      return res.status(400).json({ error: "shopDomain is required" });
    }
    const result = await pool.query(
      `
      SELECT *
      FROM notification_templates
      WHERE shop_domain = $1 OR shop_domain IS NULL
      ORDER BY code ASC
      `,
      [req.shopDomain]
    );
    return res.json({ templates: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { shopDomain, code, title, message, deepLink } = req.body;
    if (!shopDomain || !code || !title || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await pool.query(
      `
      INSERT INTO notification_templates
        (shop_domain, code, title, message, deep_link, is_active, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,TRUE,NOW())
      ON CONFLICT (shop_domain, code)
      DO UPDATE SET
        title = EXCLUDED.title,
        message = EXCLUDED.message,
        deep_link = EXCLUDED.deep_link,
        is_active = TRUE,
        updated_at = NOW()
      RETURNING *
      `,
      [shopDomain, code, title, message, deepLink || null]
    );

    return res.status(201).json({ template: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
