(function () {
  if (window.CarianaVariantVisualsLoaded) return;
  window.CarianaVariantVisualsLoaded = true;

  function parseJson(selector) {
    var node = document.querySelector(selector);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "null");
    } catch (_error) {
      return null;
    }
  }

  function installStyles() {
    if (document.getElementById("cariana-variant-visuals-style")) return;
    var style = document.createElement("style");
    style.id = "cariana-variant-visuals-style";
    style.textContent =
      '[data-cariana-variant-visuals-filtered="hidden"]{display:none!important;visibility:hidden!important;}' +
      '[data-cariana-variant-visuals-filtered="visible"]{visibility:visible!important;}' +
      ".cariana-variant-visuals-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--image-gap,16px);width:100%;}" +
      ".cariana-variant-visuals-gallery__item{margin:0;min-width:0;}" +
      ".cariana-variant-visuals-gallery__image{display:block;width:100%;height:auto;object-fit:contain;}" +
      "@media(max-width:749px){.cariana-variant-visuals-gallery{grid-template-columns:1fr;}}";
    document.head.appendChild(style);
  }

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function numericId(value) {
    var match = String(value || "").match(/(\d{8,})(?!.*\d)/);
    return match ? match[1] : "";
  }

  function optionNameFromInput(input) {
    var raw = input.getAttribute("name") || input.getAttribute("aria-label") || "";
    var match = raw.match(/options\[(.+?)\]/i);
    return match ? match[1] : raw;
  }

  function selectedOptions() {
    var result = {};
    document.querySelectorAll('select[name^="options["], input[type="radio"][name^="options["]:checked').forEach(function (input) {
      result[normalize(optionNameFromInput(input))] = input.value;
    });
    return result;
  }

  function selectedVariantId() {
    var input = document.querySelector('form[action*="/cart/add"] input[name="id"], input[name="id"][form]');
    return numericId(input && input.value);
  }

  function findActiveGroup(config) {
    var groups = config.groups || {};
    var variantId = selectedVariantId();
    if (variantId) {
      for (var color in groups) {
        var variants = groups[color].variantIds || [];
        if (variants.some(function (id) { return numericId(id) === variantId; })) return groups[color];
      }
    }

    var options = selectedOptions();
    var colorValue = options[normalize(config.colorOptionName || "Color")];
    if (colorValue) {
      for (var colorName in groups) {
        if (normalize(colorName) === normalize(colorValue) || normalize(groups[colorName].label) === normalize(colorValue)) {
          return groups[colorName];
        }
      }
    }

    var firstKey = Object.keys(groups)[0];
    return firstKey ? groups[firstKey] : null;
  }

  function mediaContainer(node) {
    return (
      node.closest(
        [
          ".product__media-item",
          ".product-gallery__media",
          ".media-gallery__item",
          ".thumbnail-list__item",
          ".product__media-list > *",
          ".slider__slide",
          "li"
        ].join(", ")
      ) ||
      node.closest(".product-media-container, [data-product-media], product-media") ||
      node
    );
  }

  function matchingNodesForMedia(media) {
    var id = numericId(media.id || media.gid);
    var nodes = [];
    if (id) {
      document.querySelectorAll('[data-media-id*="' + id + '"], [data-thumbnail-id*="' + id + '"], [id*="' + id + '"]').forEach(function (node) {
        nodes.push(mediaContainer(node));
      });
    }

    var srcKey = String(media.src || "").split("?")[0].split("/").pop();
    if (srcKey) {
      document.querySelectorAll("img, source, a").forEach(function (node) {
        var url = node.currentSrc || node.src || node.href || "";
        if (url.indexOf(srcKey) >= 0) nodes.push(mediaContainer(node));
      });
    }

    return nodes;
  }

  function sourceGallery() {
    return (
      document.querySelector(".product-information__media media-gallery") ||
      document.querySelector("media-gallery") ||
      document.querySelector(".product__media-list") ||
      document.querySelector(".media-gallery__grid")
    );
  }

  function setOriginalGalleryHidden(hidden) {
    var gallery = sourceGallery();
    if (!gallery) return;

    gallery.setAttribute("data-cariana-variant-visuals-original", hidden ? "hidden" : "visible");
    if (hidden) {
      gallery.style.setProperty("display", "none", "important");
      gallery.style.setProperty("visibility", "hidden", "important");
    } else {
      gallery.style.removeProperty("display");
      gallery.style.removeProperty("visibility");
    }
  }

  function renderCompactGallery(media, allowed) {
    var gallery = sourceGallery();
    if (!gallery) return false;

    var compact = document.querySelector(".cariana-variant-visuals-gallery");
    if (!compact) {
      compact = document.createElement("div");
      compact.className = "cariana-variant-visuals-gallery";
      gallery.parentElement.insertBefore(compact, gallery);
    }

    var selectedMedia = media.filter(function (item) {
      return Boolean(allowed[numericId(item.id || item.gid)]);
    });

    if (!selectedMedia.length) return false;

    compact.innerHTML = "";
    selectedMedia.forEach(function (item) {
      var figure = document.createElement("figure");
      var image = document.createElement("img");
      figure.className = "cariana-variant-visuals-gallery__item";
      image.className = "cariana-variant-visuals-gallery__image";
      image.src = item.src;
      image.alt = item.alt || "";
      image.loading = "lazy";
      figure.appendChild(image);
      compact.appendChild(figure);
    });

    compact.hidden = false;
    compact.style.removeProperty("display");
    return true;
  }

  function applyFilter() {
    installStyles();

    var config = parseJson("[data-cariana-variant-visuals-config]");
    var media = parseJson("[data-cariana-variant-visuals-media]") || [];
    if (!config || !media.length) return;

    var group = findActiveGroup(config);
    if (!group || !group.mediaIds || !group.mediaIds.length) return;

    var allowed = {};
    group.mediaIds.forEach(function (id) {
      allowed[numericId(id)] = true;
    });

    if (renderCompactGallery(media, allowed)) {
      setOriginalGalleryHidden(true);
      return;
    }

    setOriginalGalleryHidden(false);

    var knownContainers = [];
    media.forEach(function (item) {
      matchingNodesForMedia(item).forEach(function (container) {
        if (knownContainers.indexOf(container) < 0) knownContainers.push(container);
      });
    });

    knownContainers.forEach(function (container) {
      var itemId = "";
      media.some(function (item) {
        var nodes = matchingNodesForMedia(item);
        if (nodes.indexOf(container) >= 0) {
          itemId = numericId(item.id || item.gid);
          return true;
        }
        return false;
      });

      var shouldShow = Boolean(allowed[itemId]);
      container.hidden = !shouldShow;
      if (shouldShow) {
        container.style.removeProperty("display");
        container.style.removeProperty("visibility");
      } else {
        container.style.setProperty("display", "none", "important");
        container.style.setProperty("visibility", "hidden", "important");
      }
      container.setAttribute("data-cariana-variant-visuals-filtered", shouldShow ? "visible" : "hidden");
    });
  }

  function scheduleFilter() {
    window.clearTimeout(window.CarianaVariantVisualsTimer);
    window.CarianaVariantVisualsTimer = window.setTimeout(applyFilter, 80);
  }

  document.addEventListener("change", scheduleFilter, true);
  document.addEventListener("click", scheduleFilter, true);
  document.addEventListener("variant:change", scheduleFilter, true);
  document.addEventListener("shopify:section:load", scheduleFilter, true);
  window.addEventListener("popstate", scheduleFilter);
  scheduleFilter();
})();
