CREATE TABLE IF NOT EXISTS return_notification_settings (
  shop_domain TEXT PRIMARY KEY,
  branch_address TEXT DEFAULT '',
  branch_hours TEXT DEFAULT '',
  pickup_hours TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
