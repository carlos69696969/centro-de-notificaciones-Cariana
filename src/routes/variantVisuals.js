const express = require("express");
const {
  getProductByInput,
  getSavedConfig,
  saveVariantVisualConfig,
  searchProducts
} = require("../services/variantVisualService");

const router = express.Router();

function requireShop(req, res) {
  if (!req.shopDomain) {
    res.status(400).json({ error: "shopDomain is required" });
    return null;
  }

  return req.shopDomain;
}

router.get("/products/search", async (req, res, next) => {
  try {
    const shopDomain = requireShop(req, res);
    if (!shopDomain) return;

    const products = await searchProducts(shopDomain, req.query.query || "");
    return res.json({ products });
  } catch (error) {
    return next(error);
  }
});

router.get("/product", async (req, res, next) => {
  try {
    const shopDomain = requireShop(req, res);
    if (!shopDomain) return;

    const input = req.query.product || req.query.productId || req.query.handle;
    if (!input) {
      return res.status(400).json({ error: "product, productId or handle is required" });
    }

    const product = await getProductByInput(shopDomain, input);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const saved = await getSavedConfig(shopDomain, product.id);
    return res.json({
      product,
      savedConfig: saved?.config || product.metafieldConfig || null,
      savedAt: saved?.updated_at || null,
      syncedMetafieldAt: saved?.synced_metafield_at || null
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/product", async (req, res, next) => {
  try {
    const shopDomain = requireShop(req, res);
    if (!shopDomain) return;

    const { productId, config } = req.body || {};
    if (!productId || !config) {
      return res.status(400).json({ error: "productId and config are required" });
    }

    const product = await getProductByInput(shopDomain, productId);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const result = await saveVariantVisualConfig(shopDomain, product, config);
    return res.json({
      ok: true,
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle
      },
      metafield: result.metafield,
      savedAt: result.saved.updated_at
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
