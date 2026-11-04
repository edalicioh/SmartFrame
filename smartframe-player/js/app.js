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
  function changed(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  function styleWidget(name, value) {
    var element = document.getElementById(name),
      background = value.backgroundColor || "";
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
    if (name !== "photos") {
      var rows = {
        clock: [14, 18, 23],
        weather: [13, 16, 20],
        currencies: [15, 19, 24],
        calendar: [38, 47, 59],
      };
      var size = value.cardSize === "small" ? 0 : value.cardSize === "large" ? 2 : 1;
      element.style.setProperty("--widget-rows", rows[name][size]);
    }
  }
  function applyConfig(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return config;
    var old = config,
      next = app.normalizeConfig(input, old);
    config = next;
    var appearance = next.appearance || {};
    app.timezone = next.timezone || "";
    [
      ["--background", appearance.backgroundColor],
      ["--primary", appearance.accentColor],
      ["--weather-bg", appearance.accentColor],
      ["--text", appearance.textColor],
    ].forEach(function (entry) {
      if (entry[1]) document.body.style.setProperty(entry[0], entry[1]);
      else document.body.style.removeProperty(entry[0]);
    });
    if (!old || old.theme !== next.theme)
      document.body.classList.toggle("theme-dark", next.theme === "dark");
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
    names.forEach(function (name) {
      var value = next.widgets[name];
      if (!old || changed(old.widgets[name], value)) {
        document.getElementById(name).hidden = !value.enabled;
        styleWidget(name, value);
        app[name === "photos" ? "carousel" : name].update(value);
      }
    });
    if (old && old.timezone !== next.timezone) {
      app.clock.update(next.widgets.clock);
      app.calendar.update(next.widgets.calendar);
    }
    var anyWidgets = names.slice(1).some(function (name) {
      return next.widgets[name].enabled;
    });
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
    } else {
      app.carousel.resume();
      app.currencies.resume();
      app.clock.resume();
      app.calendar.resume();
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
