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
      "[data-cariana-variant-visuals-wrapper='hidden']{display:none!important;visibility:hidden!important;}" +
      "body.cariana-variant-visuals-active media-gallery[data-cariana-variant-visuals-original]," +
      "body.cariana-variant-visuals-active [data-testid='media-gallery-grid'][data-cariana-variant-visuals-original]," +
      "body.cariana-variant-visuals-active .product__media-list[data-cariana-variant-visuals-original]{display:none!important;visibility:hidden!important;}" +
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
    var raw = input.getAttribute("data-option-name") || input.getAttribute("name") || input.getAttribute("aria-label") || "";
    var match = raw.match(/options\[(.+?)\]/i);
    return match ? match[1] : raw;
  }

  function selectedOptions() {
    var result = {};
    document
      .querySelectorAll(
        [
          'select[name^="options["]',
          "select.variant-option__select",
          'input[type="radio"][name^="options["]:checked',
          'input[type="radio"][data-option-name]:checked',
          'input[type="radio"][data-current-checked="true"]',
          '[data-variant-option][aria-selected="true"]',
          '[data-variant-option].is-selected'
        ].join(", ")
      )
      .forEach(function (input) {
        var optionName = optionNameFromInput(input);
        var value = input.value || input.getAttribute("data-variant-option") || input.textContent;
        if (optionName && value) result[normalize(optionName)] = value.trim();
      });

    document.querySelectorAll("fieldset.variant-option").forEach(function (fieldset) {
      var legend = fieldset.querySelector("legend");
      var checked = fieldset.querySelector('input[type="radio"]:checked, input[data-current-checked="true"]');
      if (!legend || !checked) return;

      var optionName = legend.childNodes[0] ? legend.childNodes[0].textContent : legend.textContent;
      if (optionName && checked.value) result[normalize(optionName)] = checked.value;
    });

    return result;
  }

  function selectedVariantId() {
    var input = document.querySelector('form[action*="/cart/add"] input[name="id"], input[name="id"][form]');
    return numericId(input && input.value);
  }

  function findActiveGroup(config) {
    var groups = config.groups || {};
    var options = selectedOptions();
    var colorValue = options[normalize(config.colorOptionName || "Color")];
    if (colorValue) {
      for (var colorName in groups) {
        if (normalize(colorName) === normalize(colorValue) || normalize(groups[colorName].label) === normalize(colorValue)) {
          return groups[colorName];
        }
      }
    }

    var variantId = selectedVariantId();
    if (variantId) {
      for (var color in groups) {
        var variants = groups[color].variantIds || [];
        if (variants.some(function (id) { return numericId(id) === variantId; })) return groups[color];
      }
    }

    var firstKey = Object.keys(groups)[0];
    return firstKey ? groups[firstKey] : null;
  }

  function sourceGallery() {
    var primary =
      document.querySelector("media-gallery") ||
      document.querySelector("[data-testid='media-gallery-grid']") ||
      document.querySelector(".media-gallery__grid") ||
      document.querySelector(".product__media-list") ||
      document.querySelector(".product-information__media");

    if (primary) return primary.closest("media-gallery") || primary;

    return null;
  }

  function mediaFileKey(media) {
    if (media.key) return media.key;
    return String(media.src || "").split("?")[0].split("/").pop();
  }

  function imageNodesForMedia(media) {
    var key = mediaFileKey(media);
    if (!key) return [];

    return Array.from(document.querySelectorAll("img")).filter(function (image) {
      var candidates = [
        image.currentSrc,
        image.src,
        image.getAttribute("src"),
        image.getAttribute("srcset"),
        image.getAttribute("data-src"),
        image.getAttribute("data-srcset")
      ].join(" ");
      return candidates.indexOf(key) >= 0;
    });
  }

  function commonGalleryWrapper(media) {
    var wrappers = [];
    media.forEach(function (item) {
      imageNodesForMedia(item).forEach(function (image) {
        if (image.closest(".cariana-variant-visuals-gallery")) return;
        var wrapper =
          image.closest("media-gallery") ||
          image.closest("[data-testid='media-gallery-grid']") ||
          image.closest(".media-gallery__grid") ||
          image.closest(".product__media-list") ||
          image.closest(".product-information__media") ||
          image.closest("section");
        if (wrapper && wrappers.indexOf(wrapper) < 0 && !wrapper.classList.contains("cariana-variant-visuals-gallery")) {
          wrappers.push(wrapper);
        }
      });
    });

    return (
      wrappers.find(function (node) { return node.matches && node.matches("media-gallery"); }) ||
      wrappers.find(function (node) { return node.matches && node.matches(".product-information__media"); }) ||
      wrappers[0] ||
      sourceGallery()
    );
  }

  function originalGalleries() {
    var nodes = Array.from(
      document.querySelectorAll("media-gallery, .product__media-list, [data-testid='media-gallery-grid'], .media-gallery__grid")
    );
    var unique = [];
    nodes.forEach(function (node) {
      var gallery = node.closest("media-gallery") || node;
      if (unique.indexOf(gallery) < 0 && !gallery.classList.contains("cariana-variant-visuals-gallery")) {
        unique.push(gallery);
      }
    });
    return unique;
  }

  function setOriginalGalleryHidden(hidden) {
    var galleries = originalGalleries();
    if (!galleries.length) return;

    if (document.body) {
      document.body.classList.toggle("cariana-variant-visuals-active", hidden);
    }

    galleries.forEach(function (gallery) {
      gallery.setAttribute("data-cariana-variant-visuals-original", hidden ? "hidden" : "visible");
      if (hidden) {
        gallery.style.setProperty("display", "none", "important");
        gallery.style.setProperty("visibility", "hidden", "important");
      } else {
        gallery.style.removeProperty("display");
        gallery.style.removeProperty("visibility");
      }
    });
  }

  function renderCompactGallery(media, allowed) {
    var gallery = commonGalleryWrapper(media);
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
    gallery.setAttribute("data-cariana-variant-visuals-wrapper", "hidden");
    if (document.body) document.body.classList.add("cariana-variant-visuals-active");
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
