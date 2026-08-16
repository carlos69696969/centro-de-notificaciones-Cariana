(function () {
  if (window.CarianaVariantVisualsLoaded) return;
  window.CarianaVariantVisualsLoaded = true;
  var SCRIPT_VERSION = "2026-08-16-gallery-replacement-v25";

  function parseJson(selector) {
    var node = document.querySelector(selector);
    if (!node) return null;
    try {
      var parsed = JSON.parse(node.textContent || "null");
      if (typeof parsed === "string") parsed = JSON.parse(parsed || "null");
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function debugEnabled() {
    return /[?&]carianaVisualDebug=1\b/.test(window.location.search || "");
  }

  function showDebug(details) {
    if (!debugEnabled() || !document.body) return;
    var node = document.getElementById("cariana-variant-visuals-debug");
    if (!node) {
      node = document.createElement("pre");
      node.id = "cariana-variant-visuals-debug";
      node.style.cssText =
        "position:fixed;z-index:2147483647;left:8px;bottom:8px;max-width:92vw;max-height:45vh;overflow:auto;background:#111827;color:#d1fae5;padding:10px;border-radius:6px;font:12px/1.35 monospace;white-space:pre-wrap;";
      document.body.appendChild(node);
    }
    node.textContent = JSON.stringify(details, null, 2);
  }

  function installStyles() {
    if (document.getElementById("cariana-variant-visuals-style")) return;
    var style = document.createElement("style");
    style.id = "cariana-variant-visuals-style";
    style.textContent =
      '[data-cariana-variant-visuals-filtered="hidden"]{display:none!important;visibility:hidden!important;}' +
      '[data-cariana-variant-visuals-filtered="visible"]{visibility:visible!important;}' +
      "[data-cariana-variant-visuals-native='hidden']{display:none!important;visibility:hidden!important;}" +
      ".cariana-variant-visuals-gallery{display:block!important;width:100%;margin:0 0 24px;}" +
      ".cariana-variant-visuals-gallery__track{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;width:100%;}" +
      ".cariana-variant-visuals-gallery__item{margin:0;min-width:0;}" +
      ".cariana-variant-visuals-gallery__image{display:block;width:100%;height:auto;object-fit:contain;}" +
      ".cariana-variant-visuals-gallery__dots{display:none;}" +
      "@media(max-width:749px){.cariana-variant-visuals-gallery{margin:0 0 18px;}.cariana-variant-visuals-gallery__track{display:flex!important;grid-template-columns:none;gap:0;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;}.cariana-variant-visuals-gallery__track::-webkit-scrollbar{display:none;}.cariana-variant-visuals-gallery__item{flex:0 0 100%;scroll-snap-align:start;}.cariana-variant-visuals-gallery__dots{display:flex!important;justify-content:center;align-items:center;gap:7px;margin:10px 0 0;}.cariana-variant-visuals-gallery__dot{appearance:none;border:0;border-radius:50%;width:8px;height:8px;padding:0;background:#c7c7c7;}.cariana-variant-visuals-gallery__dot[aria-current='true']{background:#333;}}";
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
      document.querySelector(".rio-media-gallery") ||
      document.querySelector("media-gallery") ||
      document.querySelector("[data-testid='media-gallery-grid']") ||
      document.querySelector(".media-gallery__grid") ||
      document.querySelector(".product__media-list") ||
      document.querySelector(".product-information__media") ||
      document.querySelector(".product-media-gallery") ||
      document.querySelector(".product__media-wrapper");

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
          image.closest(".rio-media-gallery") ||
          image.closest("media-gallery") ||
          image.closest("[data-testid='media-gallery-grid']") ||
          image.closest(".media-gallery__grid") ||
          image.closest(".product__media-list") ||
          image.closest(".product-information__media") ||
          image.closest(".product-media-gallery") ||
          image.closest(".product__media-wrapper");
        if (wrapper && wrappers.indexOf(wrapper) < 0 && !wrapper.classList.contains("cariana-variant-visuals-gallery")) {
          wrappers.push(wrapper);
        }
      });
    });

    return (
      wrappers.find(function (node) { return node.matches && node.matches(".rio-media-gallery"); }) ||
      wrappers.find(function (node) { return node.matches && node.matches("media-gallery"); }) ||
      wrappers.find(function (node) { return node.matches && node.matches(".product-information__media"); }) ||
      wrappers[0] ||
      sourceGallery()
    );
  }

  function hideNativeGallery(media, hidden) {
    var wrapper = commonGalleryWrapper(media);
    if (!wrapper) return null;

    wrapper.setAttribute("data-cariana-variant-visuals-native", hidden ? "hidden" : "visible");
    if (hidden) {
      wrapper.style.setProperty("display", "none", "important");
      wrapper.style.setProperty("visibility", "hidden", "important");
    } else {
      wrapper.style.removeProperty("display");
      wrapper.style.removeProperty("visibility");
    }
    return wrapper;
  }

  function syncReplacementCarouselDots(gallery) {
    var track = gallery && gallery.querySelector(".cariana-variant-visuals-gallery__track");
    var dots = gallery ? Array.from(gallery.querySelectorAll(".cariana-variant-visuals-gallery__dot")) : [];
    if (!track || !dots.length) return;

    var index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    dots.forEach(function (dot, dotIndex) {
      dot.setAttribute("aria-current", dotIndex === index ? "true" : "false");
    });
  }

  function bindReplacementCarousel(gallery) {
    var track = gallery && gallery.querySelector(".cariana-variant-visuals-gallery__track");
    if (!track || track.getAttribute("data-cariana-carousel-bound") === "true") return;

    track.setAttribute("data-cariana-carousel-bound", "true");
    track.addEventListener(
      "scroll",
      function () {
        window.clearTimeout(track.CarianaVariantVisualsDotsTimer);
        track.CarianaVariantVisualsDotsTimer = window.setTimeout(function () {
          syncReplacementCarouselDots(gallery);
        }, 60);
      },
      { passive: true }
    );

    Array.from(gallery.querySelectorAll(".cariana-variant-visuals-gallery__dot")).forEach(function (dot, index) {
      dot.addEventListener("click", function () {
        track.scrollTo({ left: track.clientWidth * index, behavior: "smooth" });
      });
    });
  }

  function renderReplacementGallery(media, group) {
    var nativeWrapper = commonGalleryWrapper(media);
    if (!nativeWrapper || !nativeWrapper.parentElement) return false;

    var allowed = {};
    (group.mediaIds || []).forEach(function (id) {
      allowed[numericId(id)] = true;
    });

    var selectedMedia = media.filter(function (item) {
      return Boolean(allowed[numericId(item.id || item.gid)]);
    });
    if (!selectedMedia.length) return false;

    var renderKey = selectedMedia
      .map(function (item) {
        return numericId(item.id || item.gid);
      })
      .join(",");

    var gallery = document.querySelector(".cariana-variant-visuals-gallery");
    if (!gallery) {
      gallery = document.createElement("div");
      gallery.className = "cariana-variant-visuals-gallery";
    }

    if (gallery.parentElement !== nativeWrapper.parentElement || gallery.nextSibling !== nativeWrapper) {
      nativeWrapper.parentElement.insertBefore(gallery, nativeWrapper);
    }

    if (gallery.getAttribute("data-cariana-render-key") !== renderKey) {
      var track = document.createElement("div");
      var dots = document.createElement("div");

      gallery.innerHTML = "";
      gallery.setAttribute("data-cariana-render-key", renderKey);
      track.className = "cariana-variant-visuals-gallery__track";
      dots.className = "cariana-variant-visuals-gallery__dots";

      selectedMedia.forEach(function (item, index) {
        var figure = document.createElement("figure");
        var image = document.createElement("img");
        var dot = document.createElement("button");

        figure.className = "cariana-variant-visuals-gallery__item";
        image.className = "cariana-variant-visuals-gallery__image";
        image.src = item.src;
        image.alt = item.alt || "";
        image.loading = index === 0 ? "eager" : "lazy";
        figure.appendChild(image);
        track.appendChild(figure);

        dot.className = "cariana-variant-visuals-gallery__dot";
        dot.type = "button";
        dot.setAttribute("aria-label", "Imagen " + (index + 1));
        dot.setAttribute("aria-current", index === 0 ? "true" : "false");
        dots.appendChild(dot);
      });

      gallery.appendChild(track);
      gallery.appendChild(dots);
      bindReplacementCarousel(gallery);
    }

    gallery.hidden = false;
    gallery.style.removeProperty("display");
    hideNativeGallery(media, true);
    syncReplacementCarouselDots(gallery);
    return true;
  }

  function keepReplacementGalleryVisible() {
    var gallery = document.querySelector(".cariana-variant-visuals-gallery");
    if (!gallery) return false;

    gallery.hidden = false;
    gallery.style.setProperty("display", "block", "important");
    gallery.style.setProperty("visibility", "visible", "important");

    var node = gallery.parentElement;
    while (node && node !== document.body) {
      var nativeState = node.getAttribute("data-cariana-variant-visuals-native");
      var originalState = node.getAttribute("data-cariana-variant-visuals-original");
      if (nativeState === "hidden" || originalState === "hidden") {
        node.style.removeProperty("display");
        node.style.removeProperty("visibility");
        if (nativeState === "hidden") node.setAttribute("data-cariana-variant-visuals-native", "visible");
        if (originalState === "hidden") node.setAttribute("data-cariana-variant-visuals-original", "visible");
      }
      node = node.parentElement;
    }

    return true;
  }

  function originalGalleries() {
    var nodes = Array.from(
      document.querySelectorAll(
        ".rio-media-gallery, media-gallery, slideshow-component, .product-information__media, .product-media-gallery, .product__media-wrapper, .product__media-list, [data-testid='media-gallery-grid'], .media-gallery__grid"
      )
    );
    var unique = [];
    nodes.forEach(function (node) {
      if (node.matches && node.matches("slideshow-component") && !node.querySelector(".product-media[data-media-id]")) return;
      var gallery = node.closest("media-gallery") || node;
      if (
        unique.indexOf(gallery) < 0 &&
        !gallery.classList.contains("cariana-variant-visuals-gallery") &&
        !gallery.querySelector(".cariana-variant-visuals-gallery")
      ) {
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

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  function applyNativeGalleryFilter(allowed) {
    var style = document.getElementById("cariana-variant-visuals-native-filter");
    if (!style) {
      style = document.createElement("style");
      style.id = "cariana-variant-visuals-native-filter";
      document.head.appendChild(style);
    }

    var allowedIds = Object.keys(allowed).filter(Boolean);
    if (!allowedIds.length) {
      style.textContent = "";
      return false;
    }

    var hideSelectors = [
      "media-gallery li:has(.product-media[data-media-id])",
      "media-gallery slideshow-slide:has(.product-media[data-media-id])",
      "slideshow-slide:has(.product-media[data-media-id])",
      "media-gallery .product-media-container:has(.product-media[data-media-id])",
      "[data-testid='media-gallery-grid'] li:has(.product-media[data-media-id])",
      ".product__media-list > *:has(.product-media[data-media-id])"
    ];

    var showSelectors = [];
    allowedIds.forEach(function (id) {
      var escapedId = cssEscape(id);
      showSelectors.push("media-gallery li:has(.product-media[data-media-id='" + escapedId + "'])");
      showSelectors.push("media-gallery slideshow-slide:has(.product-media[data-media-id='" + escapedId + "'])");
      showSelectors.push("slideshow-slide:has(.product-media[data-media-id='" + escapedId + "'])");
      showSelectors.push("media-gallery .product-media-container:has(.product-media[data-media-id='" + escapedId + "'])");
      showSelectors.push("[data-testid='media-gallery-grid'] li:has(.product-media[data-media-id='" + escapedId + "'])");
      showSelectors.push(".product__media-list > *:has(.product-media[data-media-id='" + escapedId + "'])");
    });

    style.textContent =
      hideSelectors.join(",") +
      "{display:none!important;visibility:hidden!important;}" +
      showSelectors.join(",") +
      "{display:revert!important;visibility:visible!important;}";

    if (document.body) document.body.classList.add("cariana-variant-visuals-active");
    applyDirectMediaFilter(allowedIds);
    syncCarouselControls(allowedIds);
    return true;
  }

  function closestMediaItem(mediaNode) {
    return (
      mediaNode.closest("slideshow-slide") ||
      mediaNode.closest("li") ||
      mediaNode.closest(".product-media-container") ||
      mediaNode.closest(".product__media-item") ||
      mediaNode
    );
  }

  function closestImageItem(imageNode) {
    return (
      imageNode.closest("slideshow-slide") ||
      imageNode.closest("li") ||
      imageNode.closest(".product-media-container") ||
      imageNode.closest(".product-media") ||
      imageNode.closest("picture") ||
      imageNode
    );
  }

  function applyDirectMediaFilter(allowedIds) {
    var allowedSet = {};
    allowedIds.forEach(function (id) {
      allowedSet[id] = true;
    });

    var count = 0;
    document.querySelectorAll(".product-media[data-media-id], [data-media-id].product-media").forEach(function (mediaNode) {
      count += 1;
      var id = numericId(mediaNode.getAttribute("data-media-id"));
      var show = Boolean(allowedSet[id]);
      var item = closestMediaItem(mediaNode);

      item.hidden = !show;
      item.setAttribute("aria-hidden", show ? "false" : "true");
      item.setAttribute("data-cariana-variant-visuals-filtered", show ? "visible" : "hidden");
      if (show) {
        item.style.removeProperty("display");
        item.style.removeProperty("visibility");
      } else {
        item.style.setProperty("display", "none", "important");
        item.style.setProperty("visibility", "hidden", "important");
      }
    });
    return count;
  }

  function applyImageKeyFilter(media, allowedIds) {
    var allowedSet = {};
    var seenItems = [];
    var count = 0;

    allowedIds.forEach(function (id) {
      allowedSet[id] = true;
    });

    media.forEach(function (item) {
      var id = numericId(item.id || item.gid);
      var show = Boolean(allowedSet[id]);
      imageNodesForMedia(item).forEach(function (imageNode) {
        var visualItem = closestImageItem(imageNode);
        if (seenItems.indexOf(visualItem) >= 0) return;
        seenItems.push(visualItem);
        count += 1;

        visualItem.hidden = !show;
        visualItem.setAttribute("aria-hidden", show ? "false" : "true");
        visualItem.setAttribute("data-cariana-variant-visuals-filtered", show ? "visible" : "hidden");
        if (show) {
          visualItem.style.removeProperty("display");
          visualItem.style.removeProperty("visibility");
        } else {
          visualItem.style.setProperty("display", "none", "important");
          visualItem.style.setProperty("visibility", "hidden", "important");
        }
      });
    });

    return count;
  }

  function syncCarouselControls(allowedIds) {
    var allowedSet = {};
    allowedIds.forEach(function (id) {
      allowedSet[id] = true;
    });

    document.querySelectorAll("slideshow-component, slideshow-controls").forEach(function (scope) {
      var slides = Array.from(document.querySelectorAll("slideshow-slide:has(.product-media[data-media-id])"));
      var scopedSlides = slides.filter(function (slide) {
        return !scope.contains || scope.contains(slide) || !slide.closest("slideshow-component") || slide.closest("slideshow-component") === scope;
      });
      if (!scopedSlides.length) scopedSlides = slides;

      var visibleIndex = 0;
      scopedSlides.forEach(function (slide, index) {
        var mediaNode = slide.querySelector(".product-media[data-media-id]");
        var id = mediaNode ? numericId(mediaNode.getAttribute("data-media-id")) : "";
        var show = Boolean(allowedSet[id]);
        slide.hidden = !show;
        slide.setAttribute("aria-hidden", show ? "false" : "true");
        if (show) visibleIndex += 1;
      });

      var buttons = Array.from(scope.querySelectorAll("button, [role='button'], a"));
      buttons.forEach(function (button, index) {
        if (buttons.length < scopedSlides.length) return;
        var slide = scopedSlides[index];
        if (!slide) return;
        var mediaNode = slide.querySelector(".product-media[data-media-id]");
        var id = mediaNode ? numericId(mediaNode.getAttribute("data-media-id")) : "";
        var show = Boolean(allowedSet[id]);
        button.hidden = !show;
        if (show) button.style.removeProperty("display");
        else button.style.setProperty("display", "none", "important");
      });
    });
  }

  function applyFilter() {
    installStyles();

    var config = parseJson("[data-cariana-variant-visuals-config]");
    var media = parseJson("[data-cariana-variant-visuals-media]") || [];
    if (!config || !media.length) {
      showDebug({
        loaded: true,
        version: SCRIPT_VERSION,
        hasConfig: Boolean(config),
        mediaCount: media.length,
        configScriptNodes: document.querySelectorAll("[data-cariana-variant-visuals-config]").length,
        mediaScriptNodes: document.querySelectorAll("[data-cariana-variant-visuals-media]").length,
        productMediaNodes: document.querySelectorAll(".product-media[data-media-id], [data-media-id].product-media").length,
        slideshowSlides: document.querySelectorAll("slideshow-slide").length
      });
      return;
    }

    var group = findActiveGroup(config);
    if (!group || !group.mediaIds || !group.mediaIds.length) {
      showDebug({
        loaded: true,
        version: SCRIPT_VERSION,
        hasConfig: true,
        mediaCount: media.length,
        groups: Object.keys(config.groups || {}),
        selectedOptions: selectedOptions(),
        selectedVariantId: selectedVariantId(),
        groupFound: Boolean(group),
        productMediaNodes: document.querySelectorAll(".product-media[data-media-id], [data-media-id].product-media").length,
        slideshowSlides: document.querySelectorAll("slideshow-slide").length
      });
      return;
    }

    var allowed = {};
    group.mediaIds.forEach(function (id) {
      allowed[numericId(id)] = true;
    });

    var replacementRendered = renderReplacementGallery(media, group);
    var productMediaNodeCount = document.querySelectorAll(".product-media[data-media-id], [data-media-id].product-media").length;
    var nativeFilterResult = applyNativeGalleryFilter(allowed);
    var imageKeyNodeCount = applyImageKeyFilter(media, Object.keys(allowed));
    var result = replacementRendered || nativeFilterResult || imageKeyNodeCount > 0;
    var selectedReplacementMedia = media.filter(function (item) {
      return Boolean(allowed[numericId(item.id || item.gid)]);
    });
    showDebug({
      loaded: true,
      version: SCRIPT_VERSION,
      hasConfig: true,
      mediaCount: media.length,
      groups: Object.keys(config.groups || {}),
      activeGroup: group.label || "",
      activeGroupMediaIds: group.mediaIds || [],
      selectedOptions: selectedOptions(),
      selectedVariantId: selectedVariantId(),
      allowedNumericIds: Object.keys(allowed),
      replacementMediaCount: selectedReplacementMedia.length,
      replacementMedia: selectedReplacementMedia.map(function (item) {
        return { id: numericId(item.id || item.gid), key: item.key || "", alt: item.alt || "" };
      }),
      productMediaNodes: productMediaNodeCount,
      imageKeyNodes: imageKeyNodeCount,
      originalGalleryNodes: originalGalleries().length,
      slideshowSlides: document.querySelectorAll("slideshow-slide").length,
      nativeFilterApplied: Boolean(result),
      replacementGallery: replacementRendered
    });

    if (replacementRendered) {
      setOriginalGalleryHidden(true);
      keepReplacementGalleryVisible();
      return;
    }

    if (result) {
      setOriginalGalleryHidden(false);
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
  new MutationObserver(scheduleFilter).observe(document.documentElement, { childList: true, subtree: true });
  scheduleFilter();
})();
