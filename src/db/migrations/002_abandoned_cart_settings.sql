CREATE TABLE IF NOT EXISTS abandoned_cart_settings (
  shop_domain TEXT PRIMARY KEY,
  stage1_delay_minutes INTEGER NOT NULL DEFAULT 60,
  stage2_delay_minutes INTEGER NOT NULL DEFAULT 1440,
  stage3_delay_minutes INTEGER NOT NULL DEFAULT 4320,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
