const pool = require("../db/pool");

let ensureSettingsTablePromise = null;

function normalize(value) {
  return String(value || "").trim();
}

async function ensureReturnNotificationSettingsTable() {
  if (!ensureSettingsTablePromise) {
    ensureSettingsTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS return_notification_settings (
        shop_domain TEXT PRIMARY KEY,
        branch_address TEXT DEFAULT '',
        branch_hours TEXT DEFAULT '',
        pickup_hours TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }
  await ensureSettingsTablePromise;
}

async function getReturnNotificationSettings(shopDomain) {
  const shop = normalize(shopDomain).toLowerCase();
  if (!shop) return null;

  await ensureReturnNotificationSettingsTable();
  const result = await pool.query(
    `
    SELECT branch_address, branch_hours, pickup_hours
    FROM return_notification_settings
    WHERE shop_domain = $1
    `,
    [shop]
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    branchAddress: normalize(row.branch_address),
    branchHours: normalize(row.branch_hours),
    pickupHours: normalize(row.pickup_hours)
  };
}

async function saveReturnNotificationSettings(shopDomain, settings = {}) {
  const shop = normalize(shopDomain).toLowerCase();
  if (!shop) {
    throw new Error("shopDomain is required");
  }

  await ensureReturnNotificationSettingsTable();
  const branchAddress = normalize(settings.branchAddress ?? settings.branch_address);
  const branchHours = normalize(settings.branchHours ?? settings.branch_hours);
  const pickupHours = normalize(settings.pickupHours ?? settings.pickup_hours);

  const result = await pool.query(
    `
    INSERT INTO return_notification_settings (
      shop_domain,
      branch_address,
      branch_hours,
      pickup_hours,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    ON CONFLICT (shop_domain)
    DO UPDATE SET
      branch_address = EXCLUDED.branch_address,
      branch_hours = EXCLUDED.branch_hours,
      pickup_hours = EXCLUDED.pickup_hours,
      updated_at = NOW()
    RETURNING branch_address, branch_hours, pickup_hours
    `,
    [shop, branchAddress, branchHours, pickupHours]
  );

  const row = result.rows[0];
  return {
    branchAddress: normalize(row.branch_address),
    branchHours: normalize(row.branch_hours),
    pickupHours: normalize(row.pickup_hours)
  };
}

module.exports = {
  getReturnNotificationSettings,
  saveReturnNotificationSettings
};
