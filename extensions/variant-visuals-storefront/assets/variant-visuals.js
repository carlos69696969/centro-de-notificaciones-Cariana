(function () {
  if (window.CarianaVariantVisualsLoaded) return;
  window.CarianaVariantVisualsLoaded = true;
  var SCRIPT_VERSION = "2026-08-18-select-first-valid-color-v57";
  var immediateSelectedOptions = {};
  var immediateSelectedOptionsExpiresAt = 0;
  var persistentSelectedOptions = {};
  var persistentProductKey = "";
  var preloadedImageUrls = {};
  var preloadLinkUrls = {};
  var preloadBankUrls = {};
  var warmedProductMediaKey = "";

  function markReady() {
    document.documentElement.classList.add("cariana-variant-visuals-ready");
  }

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

  function installStyles() {}

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

  function validHex(value) {
    var text = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : "";
  }

  function groupForColorValue(config, colorValue) {
    var groups = (config && config.groups) || {};
    var wanted = normalize(colorValue);
    if (!wanted) return null;

    for (var colorName in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, colorName)) continue;

      var group = groups[colorName] || {};
      if (normalize(colorName) === wanted || normalize(group.label) === wanted) return group;
    }

    return null;
  }

  function optionNameFromInput(input) {
    if (input.classList && input.classList.contains("cariana-size-proxy")) return "Talla";

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

    document.querySelectorAll("fieldset").forEach(function (fieldset) {
      var legend = fieldset.querySelector("legend");
      var checked =
        fieldset.querySelector('input[type="radio"]:checked') ||
        fieldset.querySelector('input[data-current-checked="true"]');
      if (!legend || !checked) return;

      var optionName = legend.childNodes[0] ? legend.childNodes[0].textContent : legend.textContent;
      if (optionName && checked.value) result[normalize(optionName)] = checked.value;
    });

    if (Date.now() < immediateSelectedOptionsExpiresAt) {
      Object.keys(immediateSelectedOptions).forEach(function (optionName) {
        if (immediateSelectedOptions[optionName]) result[optionName] = immediateSelectedOptions[optionName];
      });
    }

    return result;
  }

  function selectedVariantId() {
    var input = document.querySelector('form[action*="/cart/add"] input[name="id"], input[name="id"][form]');
    return numericId(input && input.value);
  }

  function immediateOptionValue(optionName) {
    if (Date.now() >= immediateSelectedOptionsExpiresAt) return "";
    return immediateSelectedOptions[normalize(optionName)] || "";
  }

  function productSelectionKey(config) {
    return String((config && (config.productId || config.handle)) || "");
  }

  function ensurePersistentSelectionScope(config) {
    var nextKey = productSelectionKey(config);
    if (!nextKey || nextKey === persistentProductKey) return;
    persistentProductKey = nextKey;
    persistentSelectedOptions = {};
  }

  function rememberOptionSelection(optionName, value) {
    var key = normalize(optionName);
    if (!key || !value) return;

    persistentSelectedOptions[key] = value;
    immediateSelectedOptions[key] = value;
    immediateSelectedOptionsExpiresAt = Date.now() + 2500;
  }

  function selectedOptionsFromVariant(variants) {
    var result = {};
    var variantId = selectedVariantId();
    if (!variantId || !variants || !variants.length) return result;

    var variant = variants.find(function (candidate) {
      return numericId(candidate.id || candidate.gid) === variantId;
    });

    (variant && variant.selectedOptions ? variant.selectedOptions : []).forEach(function (option) {
      if (option && option.name && option.value) result[normalize(option.name)] = String(option.value).trim();
    });

    return result;
  }

  function controlIsSelected(control) {
    if (!control || !control.node) return false;

    var node = control.node;
    var wrapper = control.wrapper;
    var selectedSelector = [
      'input[type="radio"]:checked',
      'input[data-current-checked="true"]',
      '[aria-selected="true"]',
      '[data-current-checked="true"]',
      '[data-selected="true"]',
      '[aria-pressed="true"]',
      ".is-selected",
      ".selected",
      ".active"
    ].join(", ");

    if (
      node.checked ||
      node.getAttribute("aria-selected") === "true" ||
      node.getAttribute("aria-pressed") === "true" ||
      node.getAttribute("data-current-checked") === "true" ||
      node.getAttribute("data-selected") === "true" ||
      node.classList.contains("is-selected") ||
      node.classList.contains("selected") ||
      node.classList.contains("active")
    ) {
      return true;
    }

    if (!wrapper) return false;

    return (
      wrapper.getAttribute("aria-selected") === "true" ||
      wrapper.getAttribute("aria-pressed") === "true" ||
      wrapper.getAttribute("data-current-checked") === "true" ||
      wrapper.getAttribute("data-selected") === "true" ||
      wrapper.classList.contains("is-selected") ||
      wrapper.classList.contains("selected") ||
      wrapper.classList.contains("active") ||
      Boolean(wrapper.querySelector(selectedSelector))
    );
  }

  function selectedControlValue(optionName) {
    var controls = optionControls(optionName);
    var selectedProxy = controls.find(function (control) {
      return Boolean(
        control &&
          control.node &&
          control.node.classList &&
          control.node.classList.contains("cariana-size-proxy") &&
          (control.node.getAttribute("aria-pressed") === "true" ||
            control.node.classList.contains("cariana-size-proxy-selected"))
      );
    });

    if (selectedProxy && selectedProxy.value) return selectedProxy.value;

    var selected =
      controls.find(function (control) {
        return Boolean(
          control &&
            control.node &&
            (control.node.checked ||
              (control.wrapper && control.wrapper.querySelector && control.wrapper.querySelector('input[type="radio"]:checked')))
        );
      }) ||
      controls.find(function (control) {
        return Boolean(
          control &&
            control.node &&
            (control.node.getAttribute("aria-selected") === "true" ||
              control.node.getAttribute("aria-pressed") === "true" ||
              control.node.getAttribute("data-selected") === "true" ||
              control.node.classList.contains("is-selected") ||
              control.node.classList.contains("selected") ||
              control.node.classList.contains("active") ||
              (control.wrapper &&
                (control.wrapper.getAttribute("aria-selected") === "true" ||
                  control.wrapper.getAttribute("aria-pressed") === "true" ||
                  control.wrapper.getAttribute("data-selected") === "true" ||
                  control.wrapper.classList.contains("is-selected") ||
                  control.wrapper.classList.contains("selected") ||
                  control.wrapper.classList.contains("active"))))
        );
      }) ||
      controls.find(function (control) {
        return Boolean(
          control &&
            control.node &&
            (control.node.getAttribute("data-current-checked") === "true" ||
              (control.wrapper &&
                control.wrapper.querySelector &&
                control.wrapper.querySelector('input[data-current-checked="true"]')))
        );
      });
    return selected && selected.value ? selected.value : "";
  }

  function effectiveSelectedOptions(config, variants) {
    ensurePersistentSelectionScope(config);

    var colorOptionName = config.colorOptionName || "Color";
    var sizeOptionName = config.sizeOptionName || "Talla";
    var result = selectedOptionsFromVariant(variants);
    var domOptions = selectedOptions();

    Object.keys(domOptions).forEach(function (optionName) {
      if (domOptions[optionName]) result[optionName] = domOptions[optionName];
    });

    var selectedSize = selectedControlValue(sizeOptionName);
    var selectedColor = selectedControlValue(colorOptionName);
    if (selectedSize) result[normalize(sizeOptionName)] = selectedSize;
    if (selectedColor) result[normalize(colorOptionName)] = selectedColor;

    Object.keys(persistentSelectedOptions).forEach(function (optionName) {
      if (persistentSelectedOptions[optionName]) result[optionName] = persistentSelectedOptions[optionName];
    });

    var immediateSize = immediateOptionValue(sizeOptionName);
    var immediateColor = immediateOptionValue(colorOptionName);
    if (immediateSize) result[normalize(sizeOptionName)] = immediateSize;
    if (immediateColor) result[normalize(colorOptionName)] = immediateColor;

    return result;
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

  function variantOptionValue(variant, optionName) {
    var normalizedName = normalize(optionName);
    var selected = variant && variant.selectedOptions;
    if (!selected || !selected.length) return "";

    for (var index = 0; index < selected.length; index += 1) {
      if (normalize(selected[index].name) === normalizedName) return String(selected[index].value || "").trim();
    }

    return "";
  }

  function variantMatchesSelectedOptions(variant, options, ignoredOptionNames) {
    var ignored = {};
    (Array.isArray(ignoredOptionNames) ? ignoredOptionNames : [ignoredOptionNames]).forEach(function (optionName) {
      if (optionName) ignored[normalize(optionName)] = true;
    });

    for (var optionName in options) {
      if (!Object.prototype.hasOwnProperty.call(options, optionName)) continue;
      if (ignored[optionName]) continue;

      var selectedValue = options[optionName];
      if (!selectedValue) continue;

      var variantValue = "";
      var selected = variant.selectedOptions || [];
      for (var index = 0; index < selected.length; index += 1) {
        if (normalize(selected[index].name) === optionName) {
          variantValue = selected[index].value;
          break;
        }
      }

      if (variantValue && normalize(variantValue) !== normalize(selectedValue)) return false;
    }

    return true;
  }

  function optionStatusMap(variants, options, targetOptionName, ignoredOptionNames) {
    var map = {};
    if (!variants || !variants.length) {
      return map;
    }

    var ignored = Array.isArray(ignoredOptionNames) ? ignoredOptionNames.slice() : [ignoredOptionNames];
    ignored.push(targetOptionName);

    variants.forEach(function (variant) {
      if (!variantMatchesSelectedOptions(variant, options, ignored)) return;

      var value = variantOptionValue(variant, targetOptionName);
      var key = normalize(value);
      if (!key) return;

      if (!map[key]) map[key] = { exists: false, available: false };
      map[key].exists = true;
      if (variant.available !== false && variant.availableForSale !== false) map[key].available = true;
    });

    return map;
  }

  function optionControlValue(node) {
    return String(node.value || node.getAttribute("data-size-value") || node.getAttribute("data-variant-option") || node.textContent || "").trim();
  }

  function optionControlWrapper(node) {
    if (!node) return null;
    if (node.id) {
      var label = document.querySelector('label[for="' + cssEscape(node.id) + '"]');
      if (label) return label;
    }
    if (node.nextElementSibling && node.nextElementSibling.matches("label,button,[role='button'],.swatch-input__label,.variant-option__button-label")) {
      return node.nextElementSibling;
    }
    if (node.previousElementSibling && node.previousElementSibling.matches("label,button,[role='button'],.swatch-input__label,.variant-option__button-label")) {
      return node.previousElementSibling;
    }
    return (
      node.closest("label") ||
      node.closest(".variant-option__button-label") ||
      node.closest(".variant-option__button") ||
      node.closest(".swatch-input__label") ||
      node.closest("[data-variant-option]") ||
      node
    );
  }

  function optionControls(optionName) {
    var normalizedOptionName = normalize(optionName || "");
    var controls = [];

    document
      .querySelectorAll(
        [
          'input[type="radio"]',
          "[data-variant-option]",
          ".cariana-size-proxy[data-size-value]"
        ].join(", ")
      )
      .forEach(function (node) {
        var inputOptionName = optionNameFromInput(node);
        if (normalize(inputOptionName) !== normalizedOptionName) return;

        controls.push({
          node: node,
          value: optionControlValue(node),
          wrapper: optionControlWrapper(node)
        });
      });

    document.querySelectorAll("fieldset").forEach(function (fieldset) {
      var legend = fieldset.querySelector("legend");
      var fieldsetOptionName = legend && legend.childNodes[0] ? legend.childNodes[0].textContent : legend && legend.textContent;
      if (normalize(fieldsetOptionName) !== normalizedOptionName) return;

      fieldset.querySelectorAll('input[type="radio"]').forEach(function (node) {
        if (
          controls.some(function (control) {
            return control.node === node;
          })
        ) {
          return;
        }
        controls.push({
          node: node,
          value: optionControlValue(node),
          wrapper: optionControlWrapper(node)
        });
      });
    });

    return controls;
  }

  function resolvedNativeOptionStatus(control, fallbackStatus) {
    var node = control && control.node;
    if (!node || node.tagName !== "INPUT" || !node.hasAttribute("data-option-available")) {
      return fallbackStatus;
    }

    var exists = Boolean(numericId(node.getAttribute("data-variant-id")));
    return {
      exists: exists,
      available: exists && node.getAttribute("data-option-available") !== "false"
    };
  }

  function setMissingVisualState(target, missing) {
    if (!target) return;

    target.hidden = missing;
    target.setAttribute("data-cariana-variant-visuals-option-missing", missing ? "true" : "false");

    if (missing) {
      target.style.setProperty("display", "none", "important");
      target.style.setProperty("visibility", "hidden", "important");
    } else {
      target.style.removeProperty("display");
      target.style.removeProperty("visibility");
    }
  }

  function setOptionControlStatus(control, status, hideMissing) {
    if (!control || !control.node) return;

    var exists = !status || status.exists !== false;
    var available = !status || status.available !== false;
    var unavailable = !exists;
    var soldout = exists && !available;
    var missing = Boolean(hideMissing && !exists);

    control.node.disabled = unavailable;
    control.node.setAttribute("aria-disabled", unavailable ? "true" : "false");
    control.node.setAttribute("data-cariana-variant-visuals-option-unavailable", unavailable ? "true" : "false");
    control.node.setAttribute("data-cariana-variant-visuals-option-soldout", soldout ? "true" : "false");
    control.node.setAttribute("data-cariana-variant-visuals-option-missing", missing ? "true" : "false");
    control.node.setAttribute("title", soldout ? "Agotado" : "");

    if (control.wrapper) {
      control.wrapper.setAttribute("aria-disabled", unavailable ? "true" : "false");
      control.wrapper.setAttribute("data-cariana-variant-visuals-option-unavailable", unavailable ? "true" : "false");
      control.wrapper.setAttribute("data-cariana-variant-visuals-option-soldout", soldout ? "true" : "false");
      control.wrapper.setAttribute("data-cariana-variant-visuals-option-missing", missing ? "true" : "false");
      control.wrapper.setAttribute("title", soldout ? "Agotado" : "");
    }

    if (hideMissing) {
      setMissingVisualState(control.wrapper || control.node, missing);
    }
  }

  function forceHideMissingNativeColorOptions(colorOptionName, config, colorStatuses) {
    optionControls(colorOptionName).forEach(function (control) {
      var node = control && control.node;
      if (!node || node.tagName !== "INPUT" || !node.hasAttribute("data-option-available")) return;

      var status = config && colorStatuses ? colorControlStatus(config, colorStatuses, control) : null;
      var nativeMissing = node.getAttribute("data-option-available") === "false" && !numericId(node.getAttribute("data-variant-id"));
      var missing = status ? status.exists === false : nativeMissing;

      setMissingVisualState(control.wrapper || node, missing);
      node.setAttribute("data-cariana-variant-visuals-option-missing", missing ? "true" : "false");
      if (missing && node.checked) node.checked = false;
    });
  }

  function scheduleNativeColorOptionRefresh(colorOptionName, config, colorStatuses) {
    window.clearTimeout(window.CarianaVariantVisualsColorOptionTimer);
    window.CarianaVariantVisualsColorOptionTimer = window.setTimeout(function () {
      forceHideMissingNativeColorOptions(colorOptionName, config, colorStatuses);
    }, 90);
  }

  function markOptionControlKind(control, kind, group) {
    if (!control || !kind) return;
    var attribute = "data-cariana-variant-visuals-" + kind + "-option";
    if (control.node) control.node.setAttribute(attribute, "true");
    if (control.wrapper) control.wrapper.setAttribute(attribute, "true");

    if (kind === "color") {
      var hex = validHex(group && group.hex);

      if (control.wrapper) {
        control.wrapper.classList.add("cariana-variant-visuals-color-button");
        control.wrapper.style.setProperty("position", "relative", "important");
        control.wrapper.style.setProperty("overflow", "visible", "important");
        control.wrapper.style.setProperty("box-sizing", "border-box", "important");
        control.wrapper.style.setProperty("display", "inline-flex", "important");
        control.wrapper.style.setProperty("align-items", "center", "important");
        control.wrapper.style.setProperty("justify-content", "center", "important");
        control.wrapper.style.setProperty("width", "38px", "important");
        control.wrapper.style.setProperty("height", "38px", "important");
        control.wrapper.style.setProperty("min-width", "38px", "important");
        control.wrapper.style.setProperty("min-height", "38px", "important");
        control.wrapper.style.setProperty("padding", "4px", "important");
        control.wrapper.style.setProperty("border", "2px solid #8f98a8", "important");
        control.wrapper.style.setProperty("border-radius", "999px", "important");
        control.wrapper.style.setProperty("background", "#fff", "important");
        control.wrapper.style.setProperty("box-shadow", "0 1px 3px rgba(17,24,39,.22)", "important");
        if (!control.wrapper.querySelector(".cariana-variant-visuals-swatch-ring")) {
          var ring = document.createElement("span");
          ring.className = "cariana-variant-visuals-swatch-ring";
          ring.setAttribute("aria-hidden", "true");
          control.wrapper.appendChild(ring);
        }
      }

      var visualNodes = [];
      if (control.wrapper) {
        visualNodes = Array.from(
          control.wrapper.querySelectorAll(
            ".swatch,.swatch-input__swatch,.color-swatch,[class*='swatch'],[style*='background']"
          )
        );
      }
      if (!visualNodes.length && control.wrapper) visualNodes = [control.wrapper];
      visualNodes.forEach(function (node) {
        node.setAttribute("data-cariana-variant-visuals-color-swatch", "true");
        node.style.setProperty("box-sizing", "border-box", "important");
        node.style.setProperty("width", "28px", "important");
        node.style.setProperty("height", "28px", "important");
        node.style.setProperty("border", "4px solid #fff", "important");
        node.style.setProperty("border-radius", "999px", "important");
        node.style.setProperty("box-shadow", "0 0 0 2px #8f98a8, inset 0 0 0 1px rgba(17,24,39,.18), 0 1px 3px rgba(17,24,39,.2)", "important");
        node.style.setProperty("outline", "0", "important");
        if (hex) {
          node.style.setProperty("background", hex, "important");
          node.style.setProperty("background-color", hex, "important");
          node.style.setProperty("background-image", "none", "important");
        }
      });
    }
  }

  function colorControlStatus(config, colorStatuses, control) {
    if (!control) return { exists: false, available: false };

    var group = (config.groups || {})[control.value] || groupForColorValue(config, control.value);
    var colorKey = normalize(control.value);
    var labelKey = group && group.label ? normalize(group.label) : "";
    return colorStatuses[colorKey] || colorStatuses[labelKey] || { exists: false, available: false };
  }

  function chooseOptionControl(controls, optionName) {
    var current = controls.find(controlIsSelected);
    if (current && current.node.disabled !== true) return false;

    var next = controls.find(function (control) {
      return control.node.disabled !== true;
    });
    if (!next) return false;

    rememberOptionSelection(optionName, next.value);

    if (next.node.tagName === "INPUT") {
      next.node.checked = true;
      next.node.dispatchEvent(new Event("input", { bubbles: true }));
      next.node.dispatchEvent(new Event("change", { bubbles: true }));
      if (next.wrapper && next.wrapper.click) next.wrapper.click();
      return true;
    }

    if (next.node.click) {
      next.node.click();
      return true;
    }

    return false;
  }

  function chooseColorControl(controls, optionName, config, colorStatuses) {
    var current = controls.find(controlIsSelected);
    var currentStatus = colorControlStatus(config, colorStatuses, current);
    if (current && currentStatus.exists !== false) return false;

    var next =
      controls.find(function (control) {
        return colorControlStatus(config, colorStatuses, control).available === true;
      }) ||
      controls.find(function (control) {
        return colorControlStatus(config, colorStatuses, control).exists !== false;
      });
    if (!next) return false;

    rememberOptionSelection(optionName, next.value);

    if (next.node.tagName === "INPUT") {
      next.node.checked = true;
      next.node.dispatchEvent(new Event("input", { bubbles: true }));
      next.node.dispatchEvent(new Event("change", { bubbles: true }));
      if (next.wrapper && next.wrapper.click) next.wrapper.click();
      return true;
    }

    if (next.node.click) {
      next.node.click();
      return true;
    }

    return false;
  }

  function applyVariantOptionAvailability(config, variants) {
    if (!config || !variants || !variants.length) return false;

    var colorOptionName = config.colorOptionName || "Color";
    var sizeOptionName = config.sizeOptionName || "Talla";
    var options = effectiveSelectedOptions(config, variants);
    var selectedSize = immediateOptionValue(sizeOptionName) || selectedControlValue(sizeOptionName);
    if (selectedSize) options[normalize(sizeOptionName)] = selectedSize;

    var colorFilterOptions = {};
    Object.keys(options).forEach(function (optionName) {
      if (optionName !== normalize(colorOptionName)) colorFilterOptions[optionName] = options[optionName];
    });

    var colorStatuses = optionStatusMap(variants, colorFilterOptions, colorOptionName, []);
    var colorControls = optionControls(colorOptionName);
    var sizeStatuses = optionStatusMap(variants, options, sizeOptionName, [colorOptionName]);
    var sizeControls = optionControls(sizeOptionName);

    colorControls.forEach(function (control) {
      var colorKey = normalize(control.value);
      var group = (config.groups || {})[control.value] || groupForColorValue(config, control.value);
      var labelKey = group && group.label ? normalize(group.label) : "";
      var status = colorStatuses[colorKey] || colorStatuses[labelKey] || { exists: false, available: false };
      markOptionControlKind(control, "color", group);
      setOptionControlStatus(control, status, true);
    });

    forceHideMissingNativeColorOptions(colorOptionName, config, colorStatuses);
    scheduleNativeColorOptionRefresh(colorOptionName, config, colorStatuses);

    sizeControls.forEach(function (control) {
      var sizeKey = normalize(control.value);
      markOptionControlKind(control, "size");
      setOptionControlStatus(control, sizeStatuses[sizeKey] || { exists: false, available: false });
    });

    return chooseColorControl(colorControls, colorOptionName, config, colorStatuses) || chooseOptionControl(sizeControls, sizeOptionName);
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
    if (wrapper.matches && wrapper.matches(".product-information__media")) {
      wrapper =
        wrapper.querySelector(".rio-media-gallery") ||
        wrapper.querySelector("media-gallery") ||
        wrapper.querySelector("[data-testid='media-gallery-grid']") ||
        wrapper.querySelector(".media-gallery__grid") ||
        wrapper.querySelector(".product__media-list") ||
        wrapper.querySelector(".product-media-gallery") ||
        wrapper.querySelector(".product__media-wrapper") ||
        wrapper;
    }

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

  function rememberGalleryHeight(gallery) {
    if (!gallery) return;
    var height = Math.ceil(gallery.getBoundingClientRect().height || 0);
    if (height > 20) {
      gallery.style.setProperty("--cariana-variant-visuals-min-height", height + "px");
    }
  }

  function releaseGalleryHeight(gallery) {
    if (!gallery) return;
    window.setTimeout(function () {
      gallery.style.removeProperty("--cariana-variant-visuals-min-height");
    }, 220);
  }

  function imageIsReady(src) {
    if (!src) return true;
    if (preloadedImageUrls[src] === true) return true;
    return Array.from(document.images || []).some(function (image) {
      return (image.currentSrc === src || image.src === src) && image.complete && image.naturalWidth > 0;
    });
  }

  function preloadImageResource(src, highPriority) {
    if (!src || preloadLinkUrls[src] || !document.head) return;
    preloadLinkUrls[src] = true;

    var link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = src;
    if (highPriority && "fetchPriority" in link) link.fetchPriority = "high";
    document.head.appendChild(link);
  }

  function ensurePreloadBank(urls) {
    if (!urls || !urls.length) return;
    if (!document.body) {
      window.setTimeout(function () {
        ensurePreloadBank(urls);
      }, 40);
      return;
    }

    var bank = document.querySelector(".cariana-variant-visuals-preload-bank");
    if (!bank) {
      bank = document.createElement("div");
      bank.className = "cariana-variant-visuals-preload-bank";
      bank.setAttribute("aria-hidden", "true");
      document.body.appendChild(bank);
    }

    urls.forEach(function (src, index) {
      if (!src || preloadBankUrls[src]) return;
      preloadBankUrls[src] = true;

      var image = document.createElement("img");
      image.alt = "";
      image.decoding = "async";
      image.loading = "eager";
      if (index < 10 && "fetchPriority" in image) image.fetchPriority = "high";
      image.onload = function () {
        if (image.naturalWidth > 0) preloadedImageUrls[src] = true;
      };
      image.onerror = function () {
        preloadBankUrls[src] = false;
      };
      image.src = src;
      bank.appendChild(image);
    });
  }

  function preloadImage(src, callback, holdUntilLoaded, highPriority) {
    if (!src || imageIsReady(src)) {
      preloadedImageUrls[src] = true;
      if (callback) callback();
      return;
    }

    preloadImageResource(src, highPriority);

    var image = new Image();
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      if (image.naturalWidth > 0) preloadedImageUrls[src] = true;
      if (callback) callback();
    };

    image.decoding = "async";
    image.loading = "eager";
    if (highPriority && "fetchPriority" in image) image.fetchPriority = "high";
    image.onload = finish;
    image.onerror = finish;
    image.src = src;
    if (!holdUntilLoaded) window.setTimeout(finish, 700);
  }

  function mediaByNumericId(media) {
    var mediaById = {};
    media.forEach(function (item) {
      mediaById[numericId(item.id || item.gid)] = item;
    });
    return mediaById;
  }

  function mediaForGroup(media, group) {
    var mediaById = mediaByNumericId(media);
    return (group.mediaIds || [])
      .map(function (id) {
        return mediaById[numericId(id)];
      })
      .filter(Boolean);
  }

  function mediaRenderKey(mediaItems) {
    return (mediaItems || [])
      .map(function (item) {
        return numericId(item.id || item.gid);
      })
      .join(",");
  }

  function warmVariantVisualImages(config, media) {
    var groups = (config && config.groups) || {};
    var mediaKey = media
      .map(function (item) {
        return String(item.src || "");
      })
      .filter(Boolean)
      .join("|");

    if (!mediaKey || warmedProductMediaKey === mediaKey) return;
    warmedProductMediaKey = mediaKey;

    var priorityUrls = [];
    var secondaryUrls = [];
    var restUrls = [];
    var seenUrls = {};
    var addMediaTo = function (list, item) {
      if (!item || !item.src || seenUrls[item.src]) return;
      seenUrls[item.src] = true;
      list.push(item.src);
    };
    var groupedMedia = Object.keys(groups).map(function (colorName) {
      return mediaForGroup(media, groups[colorName] || {});
    });

    groupedMedia.forEach(function (groupMedia) {
      addMediaTo(priorityUrls, groupMedia[0]);
    });

    groupedMedia.forEach(function (groupMedia) {
      addMediaTo(secondaryUrls, groupMedia[1]);
    });

    groupedMedia.forEach(function (groupMedia) {
      groupMedia.slice(2).forEach(function (item) {
        addMediaTo(restUrls, item);
      });
    });

    media.forEach(function (item) {
      addMediaTo(restUrls, item);
    });

    ensurePreloadBank(priorityUrls.concat(secondaryUrls));

    priorityUrls.forEach(function (src) {
      preloadImage(src, null, false, true);
    });

    window.setTimeout(function () {
      secondaryUrls.forEach(function (src) {
        preloadImage(src, null, false, false);
      });
    }, 350);

    window.setTimeout(function () {
      restUrls.forEach(function (src) {
        preloadImage(src, null, false, false);
      });
    }, 1400);
  }

  function cssImageUrl(src) {
    if (!src) return "none";
    return "url(" + JSON.stringify(src) + ")";
  }

  function mediaAspectRatio(item) {
    var ratio = Number(item && item.aspectRatio);
    if (ratio > 0) return ratio;

    var width = Number(item && item.width);
    var height = Number(item && item.height);
    if (width > 0 && height > 0) return width / height;

    return 0.75;
  }

  function renderReplacementGallery(media, group) {
    var nativeWrapper = commonGalleryWrapper(media);
    if (!nativeWrapper || !nativeWrapper.parentElement) return false;

    var allowed = {};
    (group.mediaIds || []).forEach(function (id) {
      allowed[numericId(id)] = true;
    });

    var selectedMedia = mediaForGroup(media, group);

    if (!selectedMedia.length) return false;

    var renderKey = mediaRenderKey(selectedMedia);

    var gallery = document.querySelector(".cariana-variant-visuals-gallery");
    if (!gallery) {
      gallery = document.createElement("div");
      gallery.className = "cariana-variant-visuals-gallery";
    }

    if (gallery.parentElement !== nativeWrapper.parentElement || gallery.nextSibling !== nativeWrapper) {
      nativeWrapper.parentElement.insertBefore(gallery, nativeWrapper);
    }

    if (gallery.getAttribute("data-cariana-render-key") !== renderKey) {
      var firstImageSrc = selectedMedia[0] && selectedMedia[0].src;
      var currentRenderKey = gallery.getAttribute("data-cariana-render-key");

      if (currentRenderKey && firstImageSrc && !imageIsReady(firstImageSrc)) {
        if (gallery.getAttribute("data-cariana-pending-key") !== renderKey) {
          gallery.setAttribute("data-cariana-pending-key", renderKey);
          gallery.setAttribute("data-cariana-updating", "true");
          rememberGalleryHeight(gallery);
          preloadImage(firstImageSrc, function () {
            var activeGroup = findActiveGroup(parseJson("[data-cariana-variant-visuals-config]") || {});
            if (!activeGroup || mediaRenderKey(mediaForGroup(media, activeGroup)) !== renderKey) return;
            renderReplacementGallery(media, activeGroup);
          }, true);
        }

        gallery.hidden = false;
        gallery.style.removeProperty("display");
        hideNativeGallery(media, true);
        syncReplacementCarouselDots(gallery);
        return true;
      }

      var track = document.createElement("div");
      var dots = document.createElement("div");

      selectedMedia.slice(1, 3).forEach(function (item) {
        if (item && item.src) preloadImage(item.src);
      });
      rememberGalleryHeight(gallery);
      gallery.innerHTML = "";
      gallery.setAttribute("data-cariana-render-key", renderKey);
      gallery.removeAttribute("data-cariana-pending-key");
      track.className = "cariana-variant-visuals-gallery__track";
      dots.className = "cariana-variant-visuals-gallery__dots";

      selectedMedia.forEach(function (item, index) {
        var figure = document.createElement("figure");
        var image = document.createElement("img");
        var dot = document.createElement("button");

        figure.className = "cariana-variant-visuals-gallery__item";
        figure.style.setProperty("--cariana-variant-visuals-image", cssImageUrl(item.src));
        figure.style.setProperty("--cariana-variant-visuals-ratio", String(mediaAspectRatio(item)));
        image.className = "cariana-variant-visuals-gallery__image";
        image.src = item.src;
        image.alt = item.alt || "";
        image.loading = index === 0 ? "eager" : "lazy";
        if (index === 0 && "fetchPriority" in image) image.fetchPriority = "high";
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
      track.scrollLeft = 0;
      gallery.removeAttribute("data-cariana-updating");
      releaseGalleryHeight(gallery);
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
        ".rio-media-gallery, media-gallery, slideshow-component, .product-media-gallery, .product__media-wrapper, .product__media-list, [data-testid='media-gallery-grid'], .media-gallery__grid"
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
    var variants = parseJson("[data-cariana-variant-visuals-variants]") || [];
    if (!config || !media.length) {
      markReady();
      return;
    }

    warmVariantVisualImages(config, media);

    applyVariantOptionAvailability(config, variants);
    var group = findActiveGroup(config);
    if (!group || !group.mediaIds || !group.mediaIds.length) {
      markReady();
      return;
    }

    var allowed = {};
    group.mediaIds.forEach(function (id) {
      allowed[numericId(id)] = true;
    });

    var replacementRendered = renderReplacementGallery(media, group);
    if (replacementRendered) {
      setOriginalGalleryHidden(true);
      keepReplacementGalleryVisible();
      markReady();
      return;
    }

    var nativeFilterResult = applyNativeGalleryFilter(allowed);
    var imageKeyNodeCount = applyImageKeyFilter(media, Object.keys(allowed));
    var result = replacementRendered || nativeFilterResult || imageKeyNodeCount > 0;

    if (result) {
      setOriginalGalleryHidden(false);
      markReady();
      return;
    }

    setOriginalGalleryHidden(false);
    markReady();
  }

  function scheduleFilter() {
    window.clearTimeout(window.CarianaVariantVisualsTimer);
    window.CarianaVariantVisualsTimer = window.setTimeout(applyFilter, 32);
  }

  function targetMatchesControl(target, control) {
    if (!target || !control) return false;
    if (target === control.node || target === control.wrapper) return true;
    if (control.node && control.node.contains && control.node.contains(target)) return true;
    if (control.wrapper && control.wrapper.contains && control.wrapper.contains(target)) return true;
    return false;
  }

  function rememberImmediateSelection(target) {
    var config = parseJson("[data-cariana-variant-visuals-config]");
    if (!config) return false;

    var colorOptionName = config.colorOptionName || "Color";
    var sizeOptionName = config.sizeOptionName || "Talla";
    var candidates = optionControls(colorOptionName)
      .map(function (control) {
        return { optionName: colorOptionName, control: control };
      })
      .concat(
        optionControls(sizeOptionName).map(function (control) {
          return { optionName: sizeOptionName, control: control };
        })
      );

    var match = candidates.find(function (candidate) {
      return targetMatchesControl(target, candidate.control);
    });

    if (!match || !match.control || !match.control.value) return false;
    if (match.control.node && match.control.node.disabled) return false;

    ensurePersistentSelectionScope(config);
    rememberOptionSelection(match.optionName, match.control.value);
    return true;
  }

  function applyFilterImmediatelyFromEvent(event) {
    if (!rememberImmediateSelection(event.target)) return;
    window.clearTimeout(window.CarianaVariantVisualsTimer);
    applyFilter();
  }

  function isOwnGalleryMutation(mutation) {
    var target = mutation && mutation.target;
    if (target && target.closest && target.closest(".cariana-variant-visuals-gallery")) return true;

    var nodes = Array.from(mutation.addedNodes || []).concat(Array.from(mutation.removedNodes || []));
    return nodes.length > 0 && nodes.every(function (node) {
      if (node.nodeType !== 1) return true;
      return (
        node.classList.contains("cariana-variant-visuals-gallery") ||
        Boolean(node.closest && node.closest(".cariana-variant-visuals-gallery")) ||
        Boolean(node.querySelector && node.querySelector(".cariana-variant-visuals-gallery"))
      );
    });
  }

  function handleDomMutations(mutations) {
    if (mutations && mutations.length && mutations.every(isOwnGalleryMutation)) return;
    scheduleFilter();
  }

  document.addEventListener("pointerdown", applyFilterImmediatelyFromEvent, true);
  document.addEventListener("input", applyFilterImmediatelyFromEvent, true);
  document.addEventListener("change", scheduleFilter, true);
  document.addEventListener("click", scheduleFilter, true);
  document.addEventListener("variant:change", scheduleFilter, true);
  document.addEventListener("shopify:section:load", scheduleFilter, true);
  window.addEventListener("popstate", scheduleFilter);
  new MutationObserver(handleDomMutations).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "checked",
      "data-current-checked",
      "data-option-available",
      "data-variant-id",
      "aria-pressed",
      "aria-selected",
      "hidden",
      "style",
      "class"
    ]
  });
  scheduleFilter();
})();
