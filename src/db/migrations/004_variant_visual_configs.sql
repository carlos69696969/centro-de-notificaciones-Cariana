CREATE TABLE IF NOT EXISTS variant_visual_configs (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  shopify_product_gid TEXT NOT NULL,
  product_handle TEXT,
  product_title TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_metafield_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, shopify_product_gid)
);

CREATE INDEX IF NOT EXISTS idx_variant_visual_configs_shop
ON variant_visual_configs (shop_domain);
