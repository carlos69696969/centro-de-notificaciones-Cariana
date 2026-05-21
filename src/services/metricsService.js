const pool = require("../db/pool");

async function getDashboardMetrics(shopDomain) {
  const [users, notifications, conversions] = await Promise.all([
    pool.query(
      `
      SELECT COUNT(DISTINCT customer_id)::int AS installed_users
      FROM fcm_tokens
      WHERE shop_domain = $1
        AND is_active = TRUE
        AND customer_id IS NOT NULL
      `,
      [shopDomain]
    ),
    pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened_count
      FROM notifications
      WHERE shop_domain = $1
      `,
      [shopDomain]
    ),
    pool.query(
      `
      SELECT COUNT(*) FILTER (WHERE converted_at IS NOT NULL)::int AS converted_count
      FROM notifications
      WHERE shop_domain = $1
      `,
      [shopDomain]
    )
  ]);

  const sent = notifications.rows[0].sent_count || 0;
  const opened = notifications.rows[0].opened_count || 0;

  return {
    installedUsers: users.rows[0].installed_users || 0,
    notificationsSent: sent,
    openRate: sent > 0 ? Number(((opened / sent) * 100).toFixed(2)) : 0,
    conversions: conversions.rows[0].converted_count || 0
  };
}

module.exports = {
  getDashboardMetrics
};
