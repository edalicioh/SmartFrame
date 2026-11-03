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
  var names = ["photos", "clock", "weather", "currencies", "calendar"];
  function changed(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  function applyConfig(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return config;
    var old = config,
      next = app.normalizeConfig(input, old);
    config = next;
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
      var response = await fetch("/api/player/config", {
        cache: "no-store",
        credentials: "same-origin",
        signal: requestController.signal,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Configuração inválida");
      if (!document.hidden && !requestController.signal.aborted) {
        applyConfig(data);
        failures = 0;
        status.hidden = true;
      }
    } catch {
      if (!document.hidden && !refreshRequested) {
        failures++;
        status.hidden = false;
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
  if (document.hidden) {
    app.carousel.pause();
    app.currencies.pause();
    app.clock.pause();
    app.calendar.pause();
  } else poll();
})(window.SmartFrame);
