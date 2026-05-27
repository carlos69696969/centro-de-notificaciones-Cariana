const cron = require("node-cron");
const env = require("../config/env");
const pool = require("../db/pool");
const { runAbandonedCartSweep } = require("../services/abandonedCartService");
const { runScheduledCampaigns } = require("../services/campaignService");
const logger = require("../utils/logger");

function startScheduler() {
  if (!env.cronEnabled) {
    logger.info("Scheduler disabled");
    return;
  }

  cron.schedule("*/10 * * * *", async () => {
    try {
      await runAbandonedCartSweep();
      logger.info("Abandoned cart sweep complete");
    } catch (error) {
      logger.error("Abandoned cart sweep failed", { error: error.message });
    }
  });

  cron.schedule("* * * * *", async () => {
    try {
      await runScheduledCampaigns();
      logger.info("Scheduled campaign sweep complete");
    } catch (error) {
      logger.error("Scheduled campaign sweep failed", { error: error.message });
    }
  });

  cron.schedule("0 3 * * *", async () => {
    try {
      const result = await pool.query(
        `
        UPDATE fcm_tokens
        SET is_active = FALSE, updated_at = NOW()
        WHERE invalidated_at IS NOT NULL
          AND invalidated_at < NOW() - INTERVAL '30 days'
          AND is_active = TRUE
        RETURNING id
        `
      );
      logger.info("Token cleanup complete", { deactivated: result.rowCount });
    } catch (error) {
      logger.error("Token cleanup failed", { error: error.message });
    }
  });

  cron.schedule("20 3 * * *", async () => {
    try {
      const retentionDays = Number.isFinite(env.notificationsFailedRetentionDays) && env.notificationsFailedRetentionDays > 0
        ? Math.floor(env.notificationsFailedRetentionDays)
        : 30;
      const result = await pool.query(
        `
        DELETE FROM notifications
        WHERE status <> 'sent'
          AND created_at < NOW() - ($1::int * INTERVAL '1 day')
        `,
        [retentionDays]
      );
      logger.info("Non-sent notifications cleanup complete", {
        deleted: result.rowCount || 0,
        retentionDays
      });
    } catch (error) {
      logger.error("Non-sent notifications cleanup failed", { error: error.message });
    }
  });

  cron.schedule("35 3 * * *", async () => {
    if (!env.notificationsVacuumEnabled) {
      return;
    }

    try {
      await pool.query("VACUUM (ANALYZE) notifications");
      logger.info("Notifications vacuum analyze complete");
    } catch (error) {
      logger.warn("Notifications vacuum analyze failed", { error: error.message });
    }
  });
}

module.exports = {
  startScheduler
};
