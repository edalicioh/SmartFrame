(function (app) {
  "use strict";
  var dashboard = document.getElementById("dashboard"),
    stack = document.getElementById("widget-stack");
  var status = document.getElementById("connection-status"),
    config = null,
    pollTimer = null,
    controller = null,
    inFlight = false,
    refreshRequested = false,
    failures = 0,
    currenciesPending = false;
  var preview = new URLSearchParams(location.search).get("preview") === "1",
    deviceMatch = location.pathname.match(/^\/player\/([A-Za-z0-9_-]+)$/),
    appliedRevision = "";
  var names = ["photos", "clock", "weather", "currencies", "calendar"];
  var localNames = ["notes", "countdown", "birthdays", "tasks", "pomodoro"];
  var localContext = { timezone: "America/Sao_Paulo" },
    localRenderers = {};
  if (app.localWidgets)
    localNames.forEach(function (name) {
      localRenderers[name] = app.localWidgets.create(
        name,
        document.getElementById(name),
        localContext,
      );
    });
  function changed(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  function styleWidget(name, value, globalAppearance) {
    var element = document.getElementById(name);
    if (!element) return;
    var background = value.backgroundColor || "";
    element.classList.toggle("has-custom-bg", Boolean(background));
    if (background) {
      var hex = background.slice(1);
      if (hex.length === 3)
        hex = hex
          .split("")
          .map(function (part) {
            return part + part;
          })
          .join("");
      var channels = [0, 2, 4].map(function (offset) {
        var channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
      var light = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179;
      element.style.setProperty("--widget-background", background);
      element.style.setProperty("--widget-foreground", light ? "#172033" : "#ffffff");
      element.style.setProperty("--widget-muted", light ? "#4b5563" : "#d1d5db");
      element.style.setProperty("--widget-up", light ? "#06642e" : "#8dd6a3");
      element.style.setProperty("--widget-down", light ? "#a51f28" : "#ff999d");
      element.style.setProperty("--widget-flat", light ? "#4b5563" : "#bfc3ca");
    } else {
      ["background", "foreground", "muted", "up", "down", "flat"].forEach(function (key) {
        element.style.removeProperty("--widget-" + key);
      });
    }
    var resolved = app.resolveAppearance
      ? app.resolveAppearance(globalAppearance, value.appearance)
      : null;
    if (resolved) {
      if (resolved.cornerRadius !== null)
        element.style.setProperty("--widget-radius", resolved.cornerRadius + "px");
      else element.style.removeProperty("--widget-radius");
      if (name !== "photos" && resolved.innerPadding !== null)
        element.style.setProperty("--widget-padding", resolved.innerPadding + "px");
      else element.style.removeProperty("--widget-padding");
      if (resolved.border === true)
        element.style.setProperty(
          "--widget-border",
          "1px solid var(--widget-border-color, rgba(148, 163, 184, 0.38))",
        );
      else if (resolved.border === false)
        element.style.setProperty("--widget-border", "0px solid transparent");
      else element.style.removeProperty("--widget-border");
      if (resolved.shadow === true) element.style.setProperty("--widget-shadow", "var(--shadow)");
      else if (resolved.shadow === false) element.style.setProperty("--widget-shadow", "none");
      else element.style.removeProperty("--widget-shadow");
      element.classList.toggle("surface-flat", resolved.surfaceMode === "flat");
      element.classList.toggle("surface-borderless", resolved.surfaceMode === "borderless");
      element.classList.toggle("surface-seamless", resolved.surfaceMode === "seamless");
    } else {
      ["radius", "padding", "border", "shadow"].forEach(function (key) {
        element.style.removeProperty("--widget-" + key);
      });
      element.classList.remove("surface-flat", "surface-borderless", "surface-seamless");
    }
    if (name !== "photos") {
      var rows = {
        clock: [14, 18, 23],
        weather: [13, 16, 20],
        currencies: [15, 19, 24],
        calendar: [38, 47, 59],
      };
      if (rows[name]) {
        var size = value.cardSize === "small" ? 0 : value.cardSize === "large" ? 2 : 1;
        element.style.setProperty("--widget-rows", rows[name][size]);
      }
    }
  }
  function indexGridItems(items) {
    var map = {};
    if (!Array.isArray(items)) return map;
    items.forEach(function (item) {
      if (item && typeof item.widgetId === "string") map[item.widgetId] = item;
    });
    return map;
  }
  var gridTracks = {
      landscape: { columns: 24, rows: 24 },
      portrait: { columns: 12, rows: 40 },
    },
    gridSides = ["top", "right", "bottom", "left"];
  function gridMarginFactor(item, side, tracks) {
    if (side === "top") return item.y === 0 ? 0 : 0.5;
    if (side === "bottom") return item.y + item.h >= tracks.rows ? 0 : 0.5;
    if (side === "left") return item.x === 0 ? 0 : 0.5;
    return item.x + item.w >= tracks.columns ? 0 : 0.5;
  }
  function applyGridItem(element, orientation, item) {
    var suffix = "-" + orientation;
    if (!item) {
      element.style.removeProperty("--grid-col" + suffix);
      element.style.removeProperty("--grid-row" + suffix);
      gridSides.forEach(function (side) {
        element.style.removeProperty("--grid-margin-" + side + suffix);
      });
      return;
    }
    element.style.setProperty("--grid-col" + suffix, item.x + 1 + " / span " + item.w);
    element.style.setProperty("--grid-row" + suffix, item.y + 1 + " / span " + item.h);
    gridSides.forEach(function (side) {
      element.style.setProperty(
        "--grid-margin-" + side + suffix,
        gridMarginFactor(item, side, gridTracks[orientation]),
      );
    });
  }
  function applyGridLayout(gridLayout) {
    var enabled = Boolean(gridLayout && gridLayout.enabled);
    dashboard.classList.toggle("grid-mode", enabled);
    var maps = {
      landscape: enabled ? indexGridItems(gridLayout.landscape) : {},
      portrait: enabled ? indexGridItems(gridLayout.portrait) : {},
    };
    names.concat(localNames).forEach(function (name) {
      var element = document.getElementById(name);
      if (!element) return;
      ["landscape", "portrait"].forEach(function (orientation) {
        applyGridItem(element, orientation, maps[orientation][name]);
      });
    });
  }
  function applyConfig(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return config;
    var old = config,
      next = app.normalizeConfig(input, old);
    config = next;
    var appearance = next.appearance || {};
    app.timezone = next.timezone || "";
    localContext.timezone = next.timezone || "America/Sao_Paulo";
    [
      ["--background", appearance.backgroundColor],
      ["--primary", appearance.accentColor],
      ["--weather-bg", appearance.accentColor],
      ["--text", appearance.textColor],
    ].forEach(function (entry) {
      if (entry[1]) document.body.style.setProperty(entry[0], entry[1]);
      else document.body.style.removeProperty(entry[0]);
    });
    var globalResolved = app.resolveAppearance ? app.resolveAppearance(appearance, null) : null;
    if (globalResolved) {
      if (globalResolved.pageEdgePadding !== null)
        dashboard.style.setProperty("--page-edge-padding", globalResolved.pageEdgePadding + "px");
      else dashboard.style.removeProperty("--page-edge-padding");
      if (globalResolved.widgetSpacing !== null)
        dashboard.style.setProperty("--widget-spacing", globalResolved.widgetSpacing + "px");
      else dashboard.style.removeProperty("--widget-spacing");
      if (dashboard.dataset) dashboard.dataset.surfaceMode = globalResolved.surfaceMode;
      dashboard.classList.toggle("surface-seamless", globalResolved.surfaceMode === "seamless");
    } else {
      dashboard.style.removeProperty("--page-edge-padding");
      dashboard.style.removeProperty("--widget-spacing");
      if (dashboard.dataset) delete dashboard.dataset.surfaceMode;
      dashboard.classList.remove("surface-seamless");
    }
    if (!old || old.theme !== next.theme)
      document.body.classList.toggle("theme-dark", next.theme === "dark");
    if (!old || old.orientation !== next.orientation)
      dashboard.classList.toggle("orientation-portrait", next.orientation === "portrait");
    if (!old || changed(old.gridLayout, next.gridLayout)) applyGridLayout(next.gridLayout);
    if (!old || changed(old.layoutOptions, next.layoutOptions)) {
      dashboard.classList.toggle("photo-right", next.layoutOptions.photoPosition === "right");
      dashboard.style.setProperty("--photo-width", next.layoutOptions.photoWidthPercent + "fr");
      dashboard.style.setProperty(
        "--widget-width",
        100 - next.layoutOptions.photoWidthPercent + "fr",
      );
      dashboard.style.setProperty(
        "--clock-normal",
        (100 - next.layoutOptions.photoWidthPercent) * 0.13 + "vw",
      );
      dashboard.style.setProperty(
        "--clock-small",
        (100 - next.layoutOptions.photoWidthPercent) * 0.11 + "vw",
      );
      dashboard.style.setProperty(
        "--clock-large",
        (100 - next.layoutOptions.photoWidthPercent) * 0.15 + "vw",
      );
    }
    var appearanceChanged = !old || changed(old.appearance, next.appearance);
    names.forEach(function (name) {
      var value = next.widgets[name];
      var widgetChanged = !old || changed(old.widgets[name], value);
      if (widgetChanged || appearanceChanged) {
        document.getElementById(name).hidden = !value.enabled;
        styleWidget(name, value, appearance);
        if (widgetChanged) app[name === "photos" ? "carousel" : name].update(value);
      }
    });
    if (app.localWidgets)
      localNames.forEach(function (name) {
        var value = next.widgets[name];
        var widgetChanged =
          !old || changed(old.widgets[name], value) || old.timezone !== next.timezone;
        if (widgetChanged || appearanceChanged) {
          document.getElementById(name).hidden = !value.enabled;
          styleWidget(name, value, appearance);
          if (widgetChanged) {
            if (value.enabled) {
              localRenderers[name].update(value);
              localRenderers[name].resume();
            } else localRenderers[name].pause();
          }
        }
      });
    if (old && old.timezone !== next.timezone) {
      app.clock.update(next.widgets.clock);
      app.calendar.update(next.widgets.calendar);
    }
    var anyWidgets =
      names.slice(1).some(function (name) {
        return next.widgets[name].enabled;
      }) ||
      (app.localWidgets &&
        localNames.some(function (name) {
          return next.widgets[name].enabled;
        }));
    stack.hidden = !anyWidgets;
    dashboard.classList.toggle("no-photos", !next.widgets.photos.enabled);
    dashboard.classList.toggle("no-widgets", !anyWidgets);
    var visible = Array.prototype.filter.call(stack.children, function (element) {
      return !element.hidden;
    });
    Array.prototype.forEach.call(stack.children, function (element) {
      element.classList.remove("last-visible");
    });
    if (visible.length) visible[visible.length - 1].classList.add("last-visible");
    if (
      !old ||
      old.orientation !== next.orientation ||
      changed(old.gridLayout, next.gridLayout) ||
      changed(old.layoutOptions, next.layoutOptions) ||
      names.some(function (name) {
        return old.widgets[name].enabled !== next.widgets[name].enabled;
      })
    )
      app.currencies.relayout();
    if (old && old.refreshSeconds !== next.refreshSeconds && !inFlight)
      schedule(next.refreshSeconds * 1000);
    if (input.widgetData && typeof input.widgetData === "object") {
      currenciesPending = input.widgetData.currenciesPending === true;
      app.weather.setData(input.widgetData.weather);
      app.currencies.setData(input.widgetData.currencies);
    }
    return config;
  }
  function schedule(delay) {
    if (preview) return;
    clearTimeout(pollTimer);
    if (!document.hidden) pollTimer = setTimeout(poll, delay);
  }
  async function poll() {
    if (preview) return;
    clearTimeout(pollTimer);
    if (document.hidden) return;
    if (inFlight) {
      refreshRequested = true;
      return;
    }
    inFlight = true;
    controller = new AbortController();
    var requestController = controller,
      timeout = setTimeout(function () {
        requestController.abort();
      }, 10000);
    try {
      var query = new URLSearchParams();
      if (deviceMatch) query.set("deviceId", deviceMatch[1]);
      if (appliedRevision) query.set("appliedRevision", appliedRevision);
      var queryString = query.toString();
      var response = await fetch("/api/player/config" + (queryString ? "?" + queryString : ""), {
        cache: "no-store",
        credentials: "same-origin",
        signal: requestController.signal,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var data = await response.json();
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        data.layout !== "photo-dashboard" ||
        !data.widgets ||
        typeof data.widgets !== "object" ||
        !data.widgets.photos ||
        typeof data.widgets.photos !== "object" ||
        !/^online:[A-Za-z0-9_-]+$/.test(data.revision || "")
      )
        throw new Error("Configuração inválida");
      if (!document.hidden && !requestController.signal.aborted) {
        if (!applyConfig(data)) throw new Error("Configuração inválida");
        if (typeof data.revision === "string") appliedRevision = data.revision;
        failures = 0;
        status.hidden = true;
      }
    } catch {
      if (!document.hidden && !refreshRequested) {
        failures++;
        status.hidden = false;
        status.textContent =
          failures === 1
            ? "Player offline ou não publicado. Verifique a conexão e a publicação no painel."
            : "Reconectando ao SmartFrame… Verifique se este player continua publicado.";
      }
    } finally {
      clearTimeout(timeout);
      inFlight = false;
      controller = null;
      if (!document.hidden) {
        if (refreshRequested) {
          refreshRequested = false;
          schedule(0);
        } else
          schedule(
            failures
              ? Math.min(300000, 5000 * Math.pow(2, Math.min(failures - 1, 6)))
              : config.widgets.currencies.enabled && currenciesPending
                ? 2000
                : Math.min(config.refreshSeconds, config.widgets.currencies.enabled ? 1800 : 3600) *
                  1000,
          );
      }
    }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      clearTimeout(pollTimer);
      if (controller) controller.abort();
      app.carousel.pause();
      app.currencies.pause();
      app.clock.pause();
      app.calendar.pause();
      localNames.forEach(function (name) {
        if (localRenderers[name]) localRenderers[name].pause();
      });
    } else {
      app.carousel.resume();
      app.currencies.resume();
      app.clock.resume();
      app.calendar.resume();
      localNames.forEach(function (name) {
        if (localRenderers[name] && config.widgets[name].enabled) localRenderers[name].resume();
      });
      if (!preview) poll();
    }
  });
  window.addEventListener("online", function () {
    if (!preview) poll();
  });
  window.applyConfig = applyConfig;
  app.applyConfig = applyConfig;
  applyConfig(app.defaults);
  if (preview) {
    window.addEventListener("message", function (event) {
      if (
        window.parent === window ||
        event.source !== window.parent ||
        event.origin !== location.origin ||
        !event.data ||
        event.data.type !== "smartframe:online-preview"
      )
        return;
      var input = event.data.config;
      if (!input || typeof input !== "object") return;
      var items = input.widgets && input.widgets.photos && input.widgets.photos.items;
      if (Array.isArray(items))
        input.widgets.photos.items = items.map(function (item) {
          if (!item || typeof item.id !== "string") return item;
          return Object.assign({}, item, {
            src: "/api/photos/" + encodeURIComponent(item.id) + "/image",
          });
        });
      applyConfig(input);
    });
    if (window.parent !== window)
      window.parent.postMessage({ type: "smartframe:online-preview-ready" }, location.origin);
    return;
  }
  if (document.hidden) {
    app.carousel.pause();
    app.currencies.pause();
    app.clock.pause();
    app.calendar.pause();
  } else poll();
})(window.SmartFrame);
