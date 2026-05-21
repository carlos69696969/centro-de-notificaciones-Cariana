const pool = require("../db/pool");

async function getTemplate(shopDomain, code) {
  const custom = await pool.query(
    `
    SELECT title, message, deep_link
    FROM notification_templates
    WHERE shop_domain = $1 AND code = $2 AND is_active = TRUE
    `,
    [shopDomain, code]
  );
  if (custom.rowCount > 0) {
    return custom.rows[0];
  }

  const fallback = await pool.query(
    `
    SELECT title, message, deep_link
    FROM notification_templates
    WHERE shop_domain IS NULL AND code = $1 AND is_active = TRUE
    `,
    [code]
  );

  if (fallback.rowCount > 0) {
    return fallback.rows[0];
  }

  return null;
}

module.exports = {
  getTemplate
};
