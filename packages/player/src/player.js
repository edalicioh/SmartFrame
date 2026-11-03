(function () {
  "use strict";
  var state = {
    schemaVersion: 1,
    orientation: "landscape",
    timezone: "America/Sao_Paulo",
    background: { color: "#233e31", gradient: true, photoId: null, fit: "cover", shade: 0.2 },
    clock: {
      enabled: true,
      showDate: true,
      hourFormat: "24",
      position: "bottom-left",
      fontSize: 76,
      color: "#fffdf0",
      font: "system",
    },
    caption: "Suas memórias, sempre por perto.",
  };
  var frame = document.getElementById("frame");
  var photo = document.getElementById("photo");
  var information = document.getElementById("information");
  var clock = document.getElementById("clock");
  var date = document.getElementById("date");
  var caption = document.getElementById("caption");
  var currentPhoto = "";
  var widgetData = {};
  var widgets = document.getElementById("widgets");
  var lastWidgetMinute = -1;

  function condition(code) {
    if (code === 0) return "☀️ Céu limpo";
    if (code === 1) return "🌤️ Predominantemente limpo";
    if (code === 2) return "⛅ Parcialmente nublado";
    if (code === 3) return "☁️ Nublado";
    if (code === 45 || code === 48) return "🌫️ Neblina";
    if (code >= 51 && code <= 57) return "🌦️ Garoa";
    if (code >= 61 && code <= 67) return "🌧️ Chuva";
    if (code >= 71 && code <= 77) return "🌨️ Neve";
    if (code >= 80 && code <= 82) return "🌧️ Pancadas de chuva";
    if (code >= 85 && code <= 86) return "🌨️ Pancadas de neve";
    if (code >= 95) return "⛈️ Trovoadas";
    return "Condição indisponível";
  }
  function decimal(value, digits) {
    return typeof value === "number" && isFinite(value)
      ? value.toFixed(digits).replace(".", ",")
      : "—";
  }
  function text(id, value) {
    document.getElementById(id).textContent = value;
  }
  function timestamp(value) {
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        timeZone: state.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value));
    } catch (error) {
      void error;
      return "—";
    }
  }
  function old(value) {
    return (
      !value || !isFinite(Date.parse(value)) || Date.now() - Date.parse(value) > 30 * 60 * 1000
    );
  }
  function renderWidgets() {
    var settings = state.widgets || {};
    var weatherEnabled = !!(settings.weather && settings.weather.enabled);
    var currenciesEnabled = !!(settings.currencies && settings.currencies.enabled);
    widgets.hidden = !weatherEnabled && !currenciesEnabled;
    var position =
      ["top-left", "top-right", "bottom-left", "bottom-right"].indexOf(settings.position) >= 0
        ? settings.position
        : "top-left";
    widgets.className = "widget-" + position;
    document.getElementById("weather-card").hidden = !weatherEnabled;
    document.getElementById("currencies-card").hidden = !currenciesEnabled;
    var weather = widgetData.weather;
    if (weatherEnabled) {
      text("weather-city", settings.weather.city || "");
      text(
        "weather-now",
        weather ? "🌡️ Agora: " + decimal(weather.temperature, 1) + "°C" : "Dados indisponíveis",
      );
      text(
        "weather-range",
        weather
          ? "📈 " + decimal(weather.maximum, 1) + "°C / " + decimal(weather.minimum, 1) + "°C"
          : "",
      );
      text(
        "weather-condition",
        weather ? condition(weather.weatherCode) : "Aguardando atualização do servidor",
      );
      var weatherStale = !weather || weather.stale || old(weather.updatedAt);
      text(
        "weather-updated",
        weather
          ? (weatherStale ? "Dados anteriores · " : "Atualizado ") +
              timestamp(weather.updatedAt) +
              " · Open-Meteo"
          : "Fonte: Open-Meteo",
      );
      document.getElementById("weather-updated").className = weatherStale ? "stale" : "";
    }
    if (currenciesEnabled) {
      var rates = widgetData.currencies || {};
      text("usd-brl", "💵 USD/BRL: " + (rates.usdBrl ? "R$ " + decimal(rates.usdBrl, 4) : "—"));
      text("eur-brl", "💶 EUR/BRL: " + (rates.eurBrl ? "R$ " + decimal(rates.eurBrl, 4) : "—"));
      text(
        "btc-usd",
        "₿ BTC/USD: " + (rates.btcUsd ? "$ " + decimal(rates.btcUsd, 2).replace(",", ".") : "—"),
      );
      var stale = rates.stale || old(rates.fiatUpdatedAt) || old(rates.btcUpdatedAt);
      text(
        "currencies-updated",
        !rates.usdBrl && !rates.btcUsd
          ? "Dados indisponíveis · Frankfurter/Coinbase"
          : (stale ? "Dados anteriores · " : "") +
              "BRL: " +
              (rates.fiatDate || "—") +
              " · BTC: " +
              (rates.btcUpdatedAt ? timestamp(rates.btcUpdatedAt) : "—") +
              " · Frankfurter/Coinbase",
      );
      document.getElementById("currencies-updated").className = stale ? "stale" : "";
    }
  }

  function updateClock() {
    var now = new Date();
    try {
      clock.textContent = state.clock.enabled
        ? new Intl.DateTimeFormat("pt-BR", {
            timeZone: state.timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: state.clock.hourFormat === "12",
          }).format(now)
        : "";
      clock.setAttribute("data-updated-at", now.toISOString());
      date.textContent = state.clock.showDate
        ? new Intl.DateTimeFormat("pt-BR", {
            timeZone: state.timezone,
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(now)
        : "";
    } catch (error) {
      void error;
      clock.textContent = "--:--";
      date.textContent = "";
    }
    var minute = Math.floor(now.getTime() / 60000);
    if (minute !== lastWidgetMinute) {
      lastWidgetMinute = minute;
      renderWidgets();
    }
  }
  function resize() {
    var scale = Math.min(
      innerWidth / (state.orientation === "portrait" ? 600 : 1024),
      innerHeight / (state.orientation === "portrait" ? 1024 : 600),
    );
    clock.style.fontSize = state.clock.fontSize * scale + "px";
    date.style.fontSize = Math.max(16, state.clock.fontSize * 0.26) * scale + "px";
    caption.style.fontSize = 24 * scale + "px";
    widgets.style.fontSize = 14 * scale + "px";
  }
  function apply(config, photoUrl, data) {
    if (!config || config.schemaVersion !== 1 || !config.background || !config.clock) return false;
    if (
      !/^#[a-f0-9]{6}$/i.test(config.background.color) ||
      !/^#[a-f0-9]{6}$/i.test(config.clock.color)
    )
      return false;
    if (
      ["landscape", "portrait"].indexOf(config.orientation) < 0 ||
      ["top-left", "top-right", "bottom-left", "bottom-right", "center"].indexOf(
        config.clock.position,
      ) < 0
    )
      return false;
    if (
      typeof config.clock.fontSize !== "number" ||
      config.clock.fontSize < 32 ||
      config.clock.fontSize > 128 ||
      typeof config.background.shade !== "number" ||
      config.background.shade < 0 ||
      config.background.shade > 0.85
    )
      return false;
    if (typeof config.caption !== "string" || config.caption.length > 120) return false;
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: config.timezone });
    } catch (error) {
      void error;
      return false;
    }
    state = config;
    widgetData = data && typeof data === "object" ? data : {};
    lastWidgetMinute = -1;
    frame.style.background = config.background.gradient
      ? "linear-gradient(145deg, " + config.background.color + ", #0e1b17)"
      : config.background.color;
    information.style.color = config.clock.color;
    information.style.fontFamily = config.clock.font === "serif" ? "Georgia, serif" : "sans-serif";
    information.className = config.clock.position;
    document.getElementById("shade").style.opacity = String(config.background.shade);
    caption.textContent = config.caption;
    photo.style.objectFit = config.background.fit === "contain" ? "contain" : "cover";
    var allowedPhoto =
      typeof photoUrl === "string" &&
      (/^\/api\/photos\/[A-Za-z0-9_-]+\/image$/.test(photoUrl) ||
        /^\/photos\/[a-f0-9]{64}\.webp$/.test(photoUrl));
    if (!config.background.photoId || !allowedPhoto) {
      photo.hidden = true;
      photo.removeAttribute("src");
      currentPhoto = "";
    } else if (currentPhoto !== photoUrl) {
      currentPhoto = photoUrl;
      photo.onload = function () {
        photo.hidden = false;
      };
      photo.onerror = function () {
        photo.hidden = true;
      };
      photo.src = photoUrl;
    }
    resize();
    updateClock();
    return true;
  }
  window.SmartFrame = { apply: apply };
  window.addEventListener("message", function (event) {
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      !event.data ||
      event.data.type !== "smartframe:preview"
    )
      return;
    apply(event.data.config, event.data.photoUrl, event.data.widgetData);
  });
  window.addEventListener("resize", resize);
  apply(state, null);
  window.setInterval(updateClock, 1000);
})();
