(function () {
  "use strict";
  var defaults = {
    revision: "",
    layout: "photo-dashboard",
    orientation: "landscape",
    theme: "light",
    refreshSeconds: 15,
    timezone: "",
    appearance: { backgroundColor: "", accentColor: "", textColor: "" },
    layoutOptions: { photoPosition: "left", photoWidthPercent: 62 },
    widgets: {
      photos: { enabled: true, intervalSeconds: 15, fit: "cover", items: [] },
      clock: { enabled: true, format: "24h", showDate: false, size: "normal", color: "" },
      weather: { enabled: true, city: "Camboriú" },
      currencies: {
        enabled: true,
        pairs: ["USD/BRL", "EUR/BRL", "BTC/BRL"],
        displayCount: 2,
        intervalSeconds: 10,
      },
      calendar: { enabled: true, highlightToday: true },
    },
  };
  function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function bool(value, old) {
    return typeof value === "boolean" ? value : old;
  }
  function choice(value, allowed, old) {
    return allowed.indexOf(value) !== -1 ? value : old;
  }
  function seconds(value, old, min) {
    return Number.isInteger(value) && value >= min && value <= 3600 ? value : old;
  }
  function text(value, old, max) {
    return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : old;
  }
  function photos(value, old) {
    if (!Array.isArray(value)) return old;
    return value
      .filter(function (item) {
        if (!item || typeof item.id !== "string" || !item.id || typeof item.src !== "string")
          return false;
        try {
          var url = new URL(item.src, location.href);
          return url.origin === location.origin && /^https?:$/.test(url.protocol);
        } catch {
          return false;
        }
      })
      .map(function (item) {
        return {
          id: item.id,
          src: item.src,
          alt: typeof item.alt === "string" ? item.alt : "Foto",
        };
      });
  }
  function normalize(input, previous) {
    var old = previous || defaults,
      data = object(input),
      widgets = object(data.widgets),
      w = old.widgets;
    var p = object(widgets.photos),
      c = object(widgets.clock),
      weather = object(widgets.weather),
      money = object(widgets.currencies),
      cal = object(widgets.calendar),
      layout = object(data.layoutOptions);
    var codes = ["USD", "BRL", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "BTC", "ETH"];
    var incomingPairs = money.pairs;
    if (
      !incomingPairs &&
      Array.isArray(money.symbols) &&
      money.symbols.length <= 3 &&
      money.symbols.every(function (code) {
        return ["USD", "EUR", "BTC"].indexOf(code) >= 0;
      })
    )
      incomingPairs = money.symbols.map(function (code) {
        return code + "/BRL";
      });
    var pairs =
      Array.isArray(incomingPairs) &&
      incomingPairs.length > 0 &&
      incomingPairs.length <= 20 &&
      incomingPairs.every(function (pair, i, arr) {
        if (typeof pair !== "string") return false;
        var parts = pair.split("/");
        return (
          parts.length === 2 &&
          parts[0] !== parts[1] &&
          codes.indexOf(parts[0]) >= 0 &&
          codes.indexOf(parts[1]) >= 0 &&
          arr.indexOf(pair) === i
        );
      })
        ? incomingPairs.slice()
        : w.currencies.pairs;
    var appearance = object(data.appearance);
    function color(value, fallback) {
      return typeof value === "string" && /^(|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/.test(value)
        ? value
        : fallback;
    }
    var timezone =
      typeof data.timezone === "string" && data.timezone.length <= 80
        ? data.timezone
        : old.timezone;
    if (timezone) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone });
      } catch {
        timezone = old.timezone;
      }
    }
    return {
      revision: typeof data.revision === "string" ? data.revision : old.revision,
      layout: choice(data.layout, ["photo-dashboard"], old.layout),
      orientation: choice(data.orientation, ["landscape", "portrait"], old.orientation),
      theme: choice(data.theme, ["light", "dark"], old.theme),
      refreshSeconds: seconds(data.refreshSeconds, old.refreshSeconds, 10),
      timezone: timezone,
      appearance: {
        backgroundColor: color(appearance.backgroundColor, old.appearance.backgroundColor),
        accentColor: color(appearance.accentColor, old.appearance.accentColor),
        textColor: color(appearance.textColor, old.appearance.textColor),
      },
      layoutOptions: {
        photoPosition: choice(
          layout.photoPosition,
          ["left", "right"],
          old.layoutOptions.photoPosition,
        ),
        photoWidthPercent:
          Number.isInteger(layout.photoWidthPercent) &&
          layout.photoWidthPercent >= 40 &&
          layout.photoWidthPercent <= 75
            ? layout.photoWidthPercent
            : old.layoutOptions.photoWidthPercent,
      },
      widgets: {
        photos: {
          enabled: bool(p.enabled, w.photos.enabled),
          intervalSeconds: seconds(p.intervalSeconds, w.photos.intervalSeconds, 5),
          fit: choice(p.fit, ["cover", "contain"], w.photos.fit),
          items: photos(p.items, w.photos.items),
        },
        clock: {
          enabled: bool(c.enabled, w.clock.enabled),
          format: choice(c.format, ["12h", "24h"], w.clock.format),
          // Retain the legacy field for compatibility, but this player shows time only.
          showDate: false,
          size: choice(c.size, ["small", "normal", "large"], w.clock.size),
          color:
            typeof c.color === "string" && /^(|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/.test(c.color)
              ? c.color
              : w.clock.color,
        },
        weather: {
          enabled: bool(weather.enabled, w.weather.enabled),
          city: text(weather.city, w.weather.city, 80),
        },
        currencies: {
          enabled: bool(money.enabled, w.currencies.enabled),
          pairs: pairs,
          displayCount:
            Number.isInteger(money.displayCount) &&
            money.displayCount >= 1 &&
            money.displayCount <= 4
              ? money.displayCount
              : w.currencies.displayCount,
          intervalSeconds: seconds(money.intervalSeconds, w.currencies.intervalSeconds, 5),
        },
        calendar: {
          enabled: bool(cal.enabled, w.calendar.enabled),
          highlightToday: bool(cal.highlightToday, w.calendar.highlightToday),
        },
      },
    };
  }
  window.SmartFrame = { normalizeConfig: normalize, defaults: defaults };
})();
