const pool = require("../db/pool");
const { shopifyGraphql } = require("./shopifyAdminService");

const METAFIELD_NAMESPACE = "cariana_visuals";
const METAFIELD_KEY = "variant_image_map";

const PRODUCT_FIELDS = `
  id
  title
  handle
  options {
    id
    name
    values
  }
  media(first: 100) {
    nodes {
      ... on MediaImage {
        id
        alt
        image {
          url
          altText
          width
          height
        }
        preview {
          image {
            url
            altText
            width
            height
          }
        }
      }
    }
  }
  variants(first: 250) {
    nodes {
      id
      title
      availableForSale
      selectedOptions {
        name
        value
      }
      image {
        id
        url
        altText
        width
        height
      }
    }
  }
  metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
    id
    value
  }
`;

function normalizeShopifyProductId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("gid://shopify/Product/")) return text;

  const numericMatch = text.match(/(\d{8,})(?!.*\d)/);
  if (numericMatch) return `gid://shopify/Product/${numericMatch[1]}`;

  return "";
}

function extractHandle(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    const parts = url.pathname.split("/").filter(Boolean);
    const productIndex = parts.indexOf("products");
    if (productIndex >= 0 && parts[productIndex + 1]) return parts[productIndex + 1];
  } catch (_error) {}

  if (!text.includes("/") && !text.includes(" ")) return text;
  return "";
}

function compactMediaNode(node) {
  const image = node?.image || node?.preview?.image || {};
  return {
    id: node?.id || "",
    alt: node?.alt || image.altText || "",
    url: image.url || "",
    width: image.width || null,
    height: image.height || null
  };
}

function parseMetafieldConfig(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function compactProduct(product) {
  if (!product) return null;

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    options: product.options || [],
    media: (product.media?.nodes || []).map(compactMediaNode).filter((media) => media.id && media.url),
    variants: (product.variants?.nodes || []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      availableForSale: Boolean(variant.availableForSale),
      selectedOptions: variant.selectedOptions || [],
      image: variant.image
        ? {
            id: variant.image.id || "",
            alt: variant.image.altText || "",
            url: variant.image.url || "",
            width: variant.image.width || null,
            height: variant.image.height || null
          }
        : null
    })),
    metafieldConfig: parseMetafieldConfig(product.metafield?.value)
  };
}

async function searchProducts(shopDomain, queryText) {
  const query = `
    query SearchProducts($query: String!) {
      products(first: 12, query: $query) {
        nodes {
          id
          title
          handle
          featuredImage {
            url
            altText
          }
          totalVariants
        }
      }
    }
  `;

  const cleanQuery = String(queryText || "").trim();
  const data = await shopifyGraphql(shopDomain, query, {
    query: cleanQuery ? `title:*${cleanQuery}* OR handle:*${cleanQuery}*` : ""
  });

  return (data.products?.nodes || []).map((product) => ({
    id: product.id,
    title: product.title,
    handle: product.handle,
    imageUrl: product.featuredImage?.url || "",
    imageAlt: product.featuredImage?.altText || "",
    totalVariants: product.totalVariants || 0
  }));
}

async function getProductByInput(shopDomain, input) {
  const productId = normalizeShopifyProductId(input);
  const handle = productId ? "" : extractHandle(input);

  if (productId) {
    const query = `
      query ProductById($id: ID!) {
        product(id: $id) {
          ${PRODUCT_FIELDS}
        }
      }
    `;
    const data = await shopifyGraphql(shopDomain, query, { id: productId });
    return compactProduct(data.product);
  }

  if (handle) {
    const query = `
      query ProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          ${PRODUCT_FIELDS}
        }
      }
    `;
    const data = await shopifyGraphql(shopDomain, query, { handle });
    return compactProduct(data.productByHandle);
  }

  return null;
}

async function getSavedConfig(shopDomain, productId) {
  const result = await pool.query(
    `
    SELECT config, synced_metafield_at, updated_at
    FROM variant_visual_configs
    WHERE shop_domain = $1 AND shopify_product_gid = $2
    LIMIT 1
    `,
    [shopDomain, productId]
  );

  return result.rows[0] || null;
}

function buildThemeConfig(product, config) {
  const selectedConfig = config || {};
  const groups = selectedConfig.groups || {};

  return {
    version: 1,
    productId: product.id,
    handle: product.handle,
    colorOptionName: selectedConfig.colorOptionName || "Color",
    sizeOptionName: selectedConfig.sizeOptionName || "Talla",
    groups
  };
}

async function saveVariantVisualConfig(shopDomain, product, config) {
  const themeConfig = buildThemeConfig(product, config);

  const mutation = `
    mutation SaveVariantVisualMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          key
          namespace
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyGraphql(shopDomain, mutation, {
    metafields: [
      {
        ownerId: product.id,
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        type: "json",
        value: JSON.stringify(themeConfig)
      }
    ]
  });

  const userErrors = data.metafieldsSet?.userErrors || [];
  if (userErrors.length) {
    throw new Error(`Shopify metafield save failed: ${userErrors.map((error) => error.message).join(", ")}`);
  }

  const result = await pool.query(
    `
    INSERT INTO variant_visual_configs (
      shop_domain,
      shopify_product_gid,
      product_handle,
      product_title,
      config,
      synced_metafield_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
    ON CONFLICT (shop_domain, shopify_product_gid)
    DO UPDATE SET
      product_handle = EXCLUDED.product_handle,
      product_title = EXCLUDED.product_title,
      config = EXCLUDED.config,
      synced_metafield_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    [shopDomain, product.id, product.handle, product.title, JSON.stringify(config)]
  );

  return {
    saved: result.rows[0],
    metafield: themeConfig
  };
}

module.exports = {
  METAFIELD_KEY,
  METAFIELD_NAMESPACE,
  getProductByInput,
  getSavedConfig,
  saveVariantVisualConfig,
  searchProducts
};
