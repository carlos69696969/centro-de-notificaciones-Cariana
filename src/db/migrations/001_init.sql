CREATE TABLE IF NOT EXISTS shops (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL UNIQUE,
  access_token TEXT,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  shopify_customer_id BIGINT NOT NULL,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, shopify_customer_id)
);

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  token TEXT NOT NULL,
  platform TEXT DEFAULT 'android',
  app_version TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, token)
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  deep_link TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, code)
);

CREATE TABLE IF NOT EXISTS notification_events (
  id BIGSERIAL PRIMARY KEY,
  webhook_id TEXT UNIQUE,
  shop_domain TEXT NOT NULL,
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  fcm_token_id BIGINT REFERENCES fcm_tokens(id) ON DELETE SET NULL,
  event_id BIGINT REFERENCES notification_events(id) ON DELETE SET NULL,
  campaign_id BIGINT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  deep_link TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  fcm_message_id TEXT,
  error_message TEXT,
  opened_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  deep_link TEXT,
  audience_type TEXT NOT NULL,
  audience_filters JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notifications
ADD CONSTRAINT fk_notifications_campaign
FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  fcm_token_id BIGINT REFERENCES fcm_tokens(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS returns_events (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  return_reference TEXT,
  shopify_customer_id BIGINT,
  status TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkout_events (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  checkout_id TEXT,
  cart_token TEXT,
  shopify_customer_id BIGINT,
  email TEXT,
  completed_at TIMESTAMPTZ,
  abandoned_stage TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, checkout_id)
);

CREATE TABLE IF NOT EXISTS app_metrics (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sent_count INTEGER NOT NULL DEFAULT 0,
  opened_count INTEGER NOT NULL DEFAULT 0,
  converted_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, metric_date)
);

CREATE TABLE IF NOT EXISTS order_customer_map (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  order_id BIGINT NOT NULL,
  shopify_customer_id BIGINT,
  order_number TEXT,
  last_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, order_id)
);
