CREATE TABLE IF NOT EXISTS store_credit_notification_jobs (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  source_key TEXT NOT NULL,
  shopify_customer_id BIGINT,
  customer_email TEXT,
  order_id TEXT,
  order_number TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'MXN',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  send_result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, source_key)
);

CREATE INDEX IF NOT EXISTS idx_store_credit_notification_jobs_due
ON store_credit_notification_jobs (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_store_credit_notification_jobs_customer
ON store_credit_notification_jobs (shop_domain, shopify_customer_id);
