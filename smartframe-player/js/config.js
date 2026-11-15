(function () {
  "use strict";
  var defaults = {
    revision: "",
    layout: "photo-dashboard",
    orientation: "landscape",
    theme: "light",
    refreshSeconds: 15,
    timezone: "",
    appearance: {
      backgroundColor: "",
      accentColor: "",
      textColor: "",
      preset: null,
      cornerRadius: null,
      widgetSpacing: null,
      innerPadding: null,
      pageEdgePadding: null,
      border: null,
      shadow: null,
    },
    layoutOptions: { photoPosition: "left", photoWidthPercent: 62 },
    gridLayout: null,
    widgets: {
      photos: {
        enabled: true,
        backgroundColor: "",
        appearance: null,
        intervalSeconds: 15,
        fit: "cover",
        items: [],
      },
      clock: {
        enabled: true,
        backgroundColor: "",
        cardSize: "normal",
        appearance: null,
        format: "24h",
        showDate: false,
        size: "normal",
        color: "",
      },
      weather: {
        enabled: true,
        backgroundColor: "",
        cardSize: "normal",
        appearance: null,
        city: "Camboriú",
      },
      currencies: {
        enabled: true,
        backgroundColor: "",
        cardSize: "normal",
        appearance: null,
        pairs: ["USD/BRL", "EUR/BRL", "BTC/BRL"],
        displayCount: 2,
        intervalSeconds: 10,
      },
      calendar: {
        enabled: true,
        backgroundColor: "",
        cardSize: "normal",
        appearance: null,
        highlightToday: true,
      },
      notes: {
        enabled: false,
        backgroundColor: "",
        appearance: null,
        title: "Recados",
        messages: [],
        intervalSeconds: 15,
      },
      countdown: {
        enabled: false,
        backgroundColor: "",
        appearance: null,
        title: "Contagem regressiva",
        target: { kind: "date", date: "2030-01-01" },
        display: "days",
        completedText: "Chegou o dia!",
      },
      birthdays: {
        enabled: false,
        backgroundColor: "",
        appearance: null,
        title: "Aniversários",
        people: [],
        displayCount: 3,
      },
      tasks: {
        enabled: false,
        backgroundColor: "",
        appearance: null,
        title: "Tarefas",
        items: [],
        showCompleted: false,
      },
      pomodoro: {
        enabled: false,
        backgroundColor: "",
        appearance: null,
        title: "Pomodoro",
        workMinutes: 25,
        breakMinutes: 5,
      },
    },
  };
  var presets = ["default", "cards", "flat", "borderless", "seamless"];
  var presetDefaults = {
    default: {
      preset: "default",
      surfaceMode: "default",
      cornerRadius: null,
      widgetSpacing: null,
      innerPadding: null,
      pageEdgePadding: null,
      border: null,
      shadow: null,
    },
    cards: {
      preset: "cards",
      surfaceMode: "cards",
      cornerRadius: 18,
      widgetSpacing: 12,
      innerPadding: 12,
      pageEdgePadding: 12,
      border: true,
      shadow: false,
    },
    flat: {
      preset: "flat",
      surfaceMode: "flat",
      cornerRadius: 12,
      widgetSpacing: 12,
      innerPadding: 12,
      pageEdgePadding: 12,
      border: false,
      shadow: false,
    },
    borderless: {
      preset: "borderless",
      surfaceMode: "borderless",
      cornerRadius: 0,
      widgetSpacing: 12,
      innerPadding: 12,
      pageEdgePadding: 12,
      border: false,
      shadow: false,
    },
    seamless: {
      preset: "seamless",
      surfaceMode: "seamless",
      cornerRadius: 0,
      widgetSpacing: 0,
      innerPadding: 12,
      pageEdgePadding: 0,
      border: true,
      shadow: false,
    },
  };
  function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target, key);
  }
  function bool(value, old) {
    return typeof value === "boolean" ? value : old;
  }
  function boolOrNull(value, fallback) {
    if (value === null) return null;
    return typeof value === "boolean" ? value : fallback;
  }
  function intOrNull(value, min, max, fallback) {
    if (value === null) return null;
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }
  function presetOrNull(value, fallback) {
    if (value === null) return null;
    return presets.indexOf(value) !== -1 ? value : fallback;
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
  function color(value, fallback) {
    return typeof value === "string" && /^(|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/.test(value)
      ? value
      : fallback;
  }
  function pickExplicit(override, fallback) {
    return override !== undefined && override !== null ? override : fallback;
  }
  function normalizeWidgetAppearance(rawValue, previous, isFull) {
    if (rawValue === null) return null;
    if (rawValue === undefined || typeof rawValue !== "object" || Array.isArray(rawValue))
      return isFull ? null : previous || null;
    var base = isFull ? null : previous || null;
    var next = {
      preset: hasOwn(rawValue, "preset")
        ? presetOrNull(rawValue.preset, base ? base.preset : null)
        : base
          ? base.preset
          : null,
      cornerRadius: hasOwn(rawValue, "cornerRadius")
        ? intOrNull(rawValue.cornerRadius, 0, 32, base ? base.cornerRadius : null)
        : base
          ? base.cornerRadius
          : null,
      innerPadding: hasOwn(rawValue, "innerPadding")
        ? intOrNull(rawValue.innerPadding, 0, 24, base ? base.innerPadding : null)
        : base
          ? base.innerPadding
          : null,
      border: hasOwn(rawValue, "border")
        ? boolOrNull(rawValue.border, base ? base.border : null)
        : base
          ? base.border
          : null,
      shadow: hasOwn(rawValue, "shadow")
        ? boolOrNull(rawValue.shadow, base ? base.shadow : null)
        : base
          ? base.shadow
          : null,
    };
    if (
      next.preset === null &&
      next.cornerRadius === null &&
      next.innerPadding === null &&
      next.border === null &&
      next.shadow === null
    )
      return null;
    return next;
  }
  function resolveAppearance(globalAppearance, widgetAppearance) {
    var g = object(globalAppearance);
    var globalPreset = presets.indexOf(g.preset) !== -1 ? g.preset : "default";
    var globalBase = presetDefaults[globalPreset];
    var resolvedGlobal = {
      preset: globalPreset,
      surfaceMode: globalBase.surfaceMode,
      cornerRadius: pickExplicit(intOrNull(g.cornerRadius, 0, 32, null), globalBase.cornerRadius),
      widgetSpacing: pickExplicit(
        intOrNull(g.widgetSpacing, 0, 24, null),
        globalBase.widgetSpacing,
      ),
      innerPadding: pickExplicit(intOrNull(g.innerPadding, 0, 24, null), globalBase.innerPadding),
      pageEdgePadding: pickExplicit(
        intOrNull(g.pageEdgePadding, 0, 32, null),
        globalBase.pageEdgePadding,
      ),
      border: pickExplicit(boolOrNull(g.border, null), globalBase.border),
      shadow: pickExplicit(boolOrNull(g.shadow, null), globalBase.shadow),
    };
    if (
      !widgetAppearance ||
      typeof widgetAppearance !== "object" ||
      Array.isArray(widgetAppearance)
    )
      return resolvedGlobal;
    var hasWidgetPreset = presets.indexOf(widgetAppearance.preset) !== -1;
    var widgetBase = hasWidgetPreset ? presetDefaults[widgetAppearance.preset] : resolvedGlobal;
    return {
      preset: hasWidgetPreset ? widgetAppearance.preset : resolvedGlobal.preset,
      surfaceMode: widgetBase.surfaceMode,
      cornerRadius: pickExplicit(
        intOrNull(widgetAppearance.cornerRadius, 0, 32, null),
        widgetBase.cornerRadius,
      ),
      widgetSpacing: resolvedGlobal.widgetSpacing,
      innerPadding: pickExplicit(
        intOrNull(widgetAppearance.innerPadding, 0, 24, null),
        widgetBase.innerPadding,
      ),
      pageEdgePadding: resolvedGlobal.pageEdgePadding,
      border: pickExplicit(boolOrNull(widgetAppearance.border, null), widgetBase.border),
      shadow: pickExplicit(boolOrNull(widgetAppearance.shadow, null), widgetBase.shadow),
    };
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
  var gridDims = {
    landscape: { columns: 24, rows: 24 },
    portrait: { columns: 12, rows: 40 },
  };
  var widgetMinSizes = {
    photos: [4, 4],
    clock: [3, 2],
    weather: [3, 2],
    currencies: [3, 2],
    calendar: [4, 4],
    notes: [3, 2],
    countdown: [3, 2],
    birthdays: [3, 2],
    tasks: [3, 2],
    pomodoro: [3, 3],
  };
  function normalizeGridItems(list, orientation) {
    if (!Array.isArray(list)) return [];
    var dims = gridDims[orientation];
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      var id = item.widgetId;
      if (!hasOwn(widgetMinSizes, id) || seen[id]) continue;
      var min = widgetMinSizes[id];
      var x = item.x,
        y = item.y,
        w = item.w,
        h = item.h;
      if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        !Number.isInteger(w) ||
        !Number.isInteger(h)
      )
        continue;
      if (x < 0 || y < 0 || w < min[0] || h < min[1]) continue;
      if (x + w > dims.columns || y + h > dims.rows) continue;
      seen[id] = true;
      out.push({ widgetId: id, x: x, y: y, w: w, h: h });
    }
    return out;
  }
  function normalizeGridLayout(raw, previousGrid, fullConfig) {
    if (raw === undefined || raw === null) {
      return !fullConfig && previousGrid ? previousGrid : null;
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return !fullConfig && previousGrid ? previousGrid : null;
    }
    var fallback = previousGrid || { enabled: false, landscape: [], portrait: [] };
    return {
      enabled: bool(raw.enabled, fallback.enabled),
      landscape: hasOwn(raw, "landscape")
        ? normalizeGridItems(raw.landscape, "landscape")
        : fallback.landscape.slice(),
      portrait: hasOwn(raw, "portrait")
        ? normalizeGridItems(raw.portrait, "portrait")
        : fallback.portrait.slice(),
    };
  }
  function normalize(input, previous) {
    var old = previous || defaults,
      data = object(input),
      fullConfig = typeof data.layout === "string",
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
    var hasAppearanceObj =
      data.appearance && typeof data.appearance === "object" && !Array.isArray(data.appearance);
    var appearance = object(data.appearance);
    var oldApp = old.appearance || defaults.appearance;
    var scopedFallback = function (key) {
      if (!hasAppearanceObj || !fullConfig) return oldApp[key] !== undefined ? oldApp[key] : null;
      return null;
    };
    function local(name) {
      var hasWidget = hasOwn(widgets, name) && widgets[name] && typeof widgets[name] === "object";
      var value = object(widgets[name]),
        fallback = defaults.widgets[name],
        prevLocal = (w && w[name]) || fallback;
      var result = Object.assign({}, fallback, value);
      result.enabled = bool(value.enabled, hasWidget ? fallback.enabled : prevLocal.enabled);
      result.backgroundColor = color(
        value.backgroundColor,
        hasWidget ? fallback.backgroundColor : prevLocal.backgroundColor || "",
      );
      result.appearance = normalizeWidgetAppearance(
        value.appearance,
        prevLocal.appearance || null,
        fullConfig || hasWidget,
      );
      result.title = text(value.title, fallback.title, 80);
      if (name === "notes") {
        result.messages = Array.isArray(value.messages)
          ? value.messages
              .filter(function (item) {
                return item && typeof item.text === "string" && item.text.length <= 500;
              })
              .slice(0, 20)
          : [];
        result.intervalSeconds = seconds(value.intervalSeconds, 15, 5);
      } else if (name === "countdown") {
        var target = object(value.target);
        result.target =
          target.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(target.date)
            ? target
            : target.kind === "datetime" &&
                typeof target.dateTime === "string" &&
                Number.isFinite(Date.parse(target.dateTime))
              ? target
              : fallback.target;
        result.display = choice(value.display, ["days", "detailed"], "days");
        result.completedText = text(value.completedText, fallback.completedText, 100);
      } else if (name === "birthdays") {
        result.people = Array.isArray(value.people)
          ? value.people
              .filter(function (item) {
                return (
                  item &&
                  typeof item.name === "string" &&
                  Number.isInteger(item.month) &&
                  item.month >= 1 &&
                  item.month <= 12 &&
                  Number.isInteger(item.day) &&
                  item.day >= 1 &&
                  item.day <= new Date(Date.UTC(2000, item.month, 0)).getUTCDate()
                );
              })
              .slice(0, 50)
          : [];
        result.displayCount =
          Number.isInteger(value.displayCount) &&
          value.displayCount >= 1 &&
          value.displayCount <= 10
            ? value.displayCount
            : 3;
      } else if (name === "tasks") {
        result.items = Array.isArray(value.items)
          ? value.items
              .filter(function (item) {
                return item && typeof item.text === "string" && typeof item.completed === "boolean";
              })
              .slice(0, 50)
          : [];
        result.showCompleted = bool(value.showCompleted, false);
      } else {
        result.workMinutes =
          Number.isInteger(value.workMinutes) && value.workMinutes >= 1 && value.workMinutes <= 180
            ? value.workMinutes
            : 25;
        result.breakMinutes =
          Number.isInteger(value.breakMinutes) &&
          value.breakMinutes >= 1 &&
          value.breakMinutes <= 60
            ? value.breakMinutes
            : 5;
      }
      return result;
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
        backgroundColor: color(appearance.backgroundColor, oldApp.backgroundColor),
        accentColor: color(appearance.accentColor, oldApp.accentColor),
        textColor: color(appearance.textColor, oldApp.textColor),
        preset: hasOwn(appearance, "preset")
          ? presetOrNull(appearance.preset, oldApp.preset !== undefined ? oldApp.preset : null)
          : scopedFallback("preset"),
        cornerRadius: hasOwn(appearance, "cornerRadius")
          ? intOrNull(
              appearance.cornerRadius,
              0,
              32,
              oldApp.cornerRadius !== undefined ? oldApp.cornerRadius : null,
            )
          : scopedFallback("cornerRadius"),
        widgetSpacing: hasOwn(appearance, "widgetSpacing")
          ? intOrNull(
              appearance.widgetSpacing,
              0,
              24,
              oldApp.widgetSpacing !== undefined ? oldApp.widgetSpacing : null,
            )
          : scopedFallback("widgetSpacing"),
        innerPadding: hasOwn(appearance, "innerPadding")
          ? intOrNull(
              appearance.innerPadding,
              0,
              24,
              oldApp.innerPadding !== undefined ? oldApp.innerPadding : null,
            )
          : scopedFallback("innerPadding"),
        pageEdgePadding: hasOwn(appearance, "pageEdgePadding")
          ? intOrNull(
              appearance.pageEdgePadding,
              0,
              32,
              oldApp.pageEdgePadding !== undefined ? oldApp.pageEdgePadding : null,
            )
          : scopedFallback("pageEdgePadding"),
        border: hasOwn(appearance, "border")
          ? boolOrNull(appearance.border, oldApp.border !== undefined ? oldApp.border : null)
          : scopedFallback("border"),
        shadow: hasOwn(appearance, "shadow")
          ? boolOrNull(appearance.shadow, oldApp.shadow !== undefined ? oldApp.shadow : null)
          : scopedFallback("shadow"),
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
      gridLayout: normalizeGridLayout(data.gridLayout, old.gridLayout || null, fullConfig),
      widgets: {
        photos: {
          enabled: bool(p.enabled, w.photos.enabled),
          backgroundColor: color(p.backgroundColor, w.photos.backgroundColor),
          appearance: normalizeWidgetAppearance(
            p.appearance,
            w.photos.appearance || null,
            fullConfig,
          ),
          intervalSeconds: seconds(p.intervalSeconds, w.photos.intervalSeconds, 5),
          fit: choice(p.fit, ["cover", "contain"], w.photos.fit),
          items: photos(p.items, w.photos.items),
        },
        clock: {
          enabled: bool(c.enabled, w.clock.enabled),
          backgroundColor: color(c.backgroundColor, w.clock.backgroundColor),
          cardSize: choice(c.cardSize, ["small", "normal", "large"], w.clock.cardSize),
          appearance: normalizeWidgetAppearance(
            c.appearance,
            w.clock.appearance || null,
            fullConfig,
          ),
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
          backgroundColor: color(weather.backgroundColor, w.weather.backgroundColor),
          cardSize: choice(weather.cardSize, ["small", "normal", "large"], w.weather.cardSize),
          appearance: normalizeWidgetAppearance(
            weather.appearance,
            w.weather.appearance || null,
            fullConfig,
          ),
          city: text(weather.city, w.weather.city, 80),
        },
        currencies: {
          enabled: bool(money.enabled, w.currencies.enabled),
          backgroundColor: color(money.backgroundColor, w.currencies.backgroundColor),
          cardSize: choice(money.cardSize, ["small", "normal", "large"], w.currencies.cardSize),
          appearance: normalizeWidgetAppearance(
            money.appearance,
            w.currencies.appearance || null,
            fullConfig,
          ),
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
          backgroundColor: color(cal.backgroundColor, w.calendar.backgroundColor),
          cardSize: choice(cal.cardSize, ["small", "normal", "large"], w.calendar.cardSize),
          appearance: normalizeWidgetAppearance(
            cal.appearance,
            w.calendar.appearance || null,
            fullConfig,
          ),
          highlightToday: bool(cal.highlightToday, w.calendar.highlightToday),
        },
        notes: local("notes"),
        countdown: local("countdown"),
        birthdays: local("birthdays"),
        tasks: local("tasks"),
        pomodoro: local("pomodoro"),
      },
    };
  }
  window.SmartFrame = {
    normalizeConfig: normalize,
    resolveAppearance: resolveAppearance,
    defaults: defaults,
  };
})();
