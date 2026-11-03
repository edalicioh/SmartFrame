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
    failures = 0;
  var preview = new URLSearchParams(location.search).get("preview") === "1",
    deviceMatch = location.pathname.match(/^\/player\/([A-Za-z0-9_-]+)$/),
    appliedRevision = "";
  var names = ["photos", "clock", "weather", "currencies", "calendar"];
  function changed(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  function applyConfig(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return config;
    var old = config,
      next = app.normalizeConfig(input, old);
    config = next;
    var appearance = next.appearance || {};
    app.timezone = next.timezone || "";
    document.documentElement.style.setProperty("--appearance-background", appearance.backgroundColor || "");
    document.documentElement.style.setProperty("--appearance-accent", appearance.accentColor || "");
    document.documentElement.style.setProperty("--appearance-text", appearance.textColor || "");
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
        app[name === "photos" ? "carousel" : name].update(value);
      }
    });
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
      app.weather.setData(input.widgetData.weather);
      app.currencies.setData(input.widgetData.currencies);
    }
    return config;
  }
  function schedule(delay) {
    clearTimeout(pollTimer);
    if (!document.hidden) pollTimer = setTimeout(poll, delay);
  }
  async function poll() {
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
      var response = await fetch("/api/player/config" + (query.size ? "?" + query : ""), {
        cache: "no-store",
        credentials: "same-origin",
        signal: requestController.signal,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data))
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
        status.textContent = failures === 1
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
              : config.refreshSeconds * 1000,
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
      poll();
    }
  });
  window.applyConfig = applyConfig;
  app.applyConfig = applyConfig;
  applyConfig(app.defaults);
  if (preview) {
    window.addEventListener("message", function (event) {
      if (event.origin !== location.origin || !event.data || event.data.type !== "smartframe:online-preview") return;
      var input = event.data.config;
      if (!input || typeof input !== "object") return;
      var items = input.widgets && input.widgets.photos && input.widgets.photos.items;
      if (Array.isArray(items)) input.widgets.photos.items = items.map(function (item) {
        if (!item || typeof item.id !== "string") return item;
        return Object.assign({}, item, { src: "/api/photos/" + encodeURIComponent(item.id) + "/image" });
      });
      applyConfig(input);
    });
    if (window.parent !== window) window.parent.postMessage({ type: "smartframe:online-preview-ready" }, location.origin);
    return;
  }
  if (document.hidden) {
    app.carousel.pause();
    app.currencies.pause();
    app.clock.pause();
    app.calendar.pause();
  } else poll();
})(window.SmartFrame);
