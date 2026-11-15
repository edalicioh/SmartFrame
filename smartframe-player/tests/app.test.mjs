import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

function styleProps(target) {
  const map = {};
  target.style = {
    setProperty: (key, value) => {
      map[key] = String(value);
    },
    removeProperty: (key) => {
      delete map[key];
    },
    values: map,
  };
  const classes = new Set();
  target.classList = {
    toggle: (name, force) => {
      if (force === undefined) {
        if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      } else if (force) classes.add(name);
      else classes.delete(name);
    },
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
    has: (name) => classes.has(name),
  };
}

function setup(
  preview = false,
  responseData = {
    layout: "photo-dashboard",
    revision: "online:v4",
    widgets: { photos: { items: [] } },
  },
  withLocalWidgets = false,
) {
  const listeners = {},
    documentListeners = {},
    fetches = [],
    timers = [];
  const classes = () => ({ toggle() {}, add() {}, remove() {} });
  function element() {
    return {
      hidden: false,
      children: [],
      style: { setProperty() {}, removeProperty() {} },
      classList: classes(),
    };
  }
  const elements = Object.fromEntries(
    [
      "dashboard",
      "widget-stack",
      "connection-status",
      "photos",
      "clock",
      "weather",
      "currencies",
      "calendar",
      "notes",
      "countdown",
      "birthdays",
      "tasks",
      "pomodoro",
    ].map((id) => [id, element()]),
  );
  elements["widget-stack"].children = [
    elements.clock,
    elements.weather,
    elements.currencies,
    elements.calendar,
  ];
  const defaults = {
    revision: "",
    layout: "photo-dashboard",
    orientation: "landscape",
    theme: "light",
    refreshSeconds: 15,
    timezone: "",
    appearance: { backgroundColor: "", accentColor: "", textColor: "" },
    layoutOptions: { photoPosition: "left", photoWidthPercent: 62 },
    widgets: Object.fromEntries(
      ["photos", "clock", "weather", "currencies", "calendar"].map((name) => [
        name,
        { enabled: true, items: [] },
      ]),
    ),
  };
  const app = {
    defaults,
    normalizeConfig: (input) => ({
      ...structuredClone(defaults),
      ...input,
      widgets: { ...structuredClone(defaults.widgets), ...input.widgets },
    }),
    carousel: { update() {}, pause() {}, resume() {} },
    clock: { update() {}, pause() {}, resume() {} },
    calendar: { update() {}, pause() {}, resume() {} },
    weather: { update() {}, setData() {} },
    currencies: { update() {}, setData() {}, relayout() {}, pause() {}, resume() {} },
  };
  if (withLocalWidgets) {
    for (const name of ["notes", "countdown", "birthdays", "tasks", "pomodoro"]) {
      defaults.widgets[name] = { enabled: false, title: name };
      elements["widget-stack"].children.push(elements[name]);
    }
    app.localWidgets = { create: () => ({ update() {}, pause() {}, resume() {} }) };
  }
  const parent = { postMessage() {} };
  const window = {
    SmartFrame: app,
    parent,
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    postMessage() {},
  };
  const document = {
    hidden: false,
    documentElement: element(),
    body: element(),
    getElementById: (id) => elements[id],
    addEventListener: (name, fn) => {
      documentListeners[name] = fn;
    },
  };
  runInNewContext(source, {
    window,
    document,
    location: {
      search: preview ? "?preview=1" : "",
      pathname: "/player/id",
      origin: "https://same",
    },
    URLSearchParams,
    URL,
    fetch: (...args) => {
      fetches.push(args);
      return Promise.resolve({ ok: true, json: async () => responseData });
    },
    AbortController,
    setTimeout: (fn, delay) => {
      fn.delay = delay;
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
  });
  return { app, window, fetches, listeners, documentListeners, timers, elements };
}

test("os cartões adicionais aparecem e desaparecem conforme a configuração", () => {
  const h = setup(true, undefined, true);
  assert.equal(h.elements.notes.hidden, true);
  h.app.applyConfig({
    ...h.app.defaults,
    widgets: { ...h.app.defaults.widgets, notes: { enabled: true, title: "Casa" } },
  });
  assert.equal(h.elements.notes.hidden, false);
  h.app.applyConfig({ ...h.app.defaults });
  assert.equal(h.elements.notes.hidden, true);
});

test("preview never fetches on init, refresh apply, visibility restore, or online", async () => {
  const h = setup(true);
  h.app.applyConfig({ ...h.app.defaults, refreshSeconds: 20 });
  h.listeners.online();
  h.documentListeners.visibilitychange();
  await Promise.resolve();
  assert.equal(h.fetches.length, 0);
});

test("preview accepts only messages from its same-origin parent frame", () => {
  const h = setup(true);
  let updates = 0;
  h.app.carousel.update = () => {
    updates++;
  };
  const message = {
    type: "smartframe:online-preview",
    config: { layout: "photo-dashboard", widgets: { photos: { enabled: false, items: [] } } },
  };
  h.listeners.message({ origin: "https://same", source: {}, data: message });
  assert.equal(updates, 0);
  h.listeners.message({ origin: "https://other", source: h.window.parent, data: message });
  assert.equal(updates, 0);
  h.listeners.message({ origin: "https://same", source: h.window.parent, data: message });
  assert.equal(updates, 1);
});

test("production acknowledges only a successfully applied revision on the next request", async () => {
  const h = setup(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.fetches.length, 1);
  assert.equal(h.fetches[0][0], "/api/player/config?deviceId=id");
  h.listeners.online();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(h.fetches[1][0], /appliedRevision=online%3Av4/);
});

test("malformed server payload is not acknowledged", async () => {
  const h = setup(false, { revision: "online:bad" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.fetches.length, 1);
  h.listeners.online();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.fetches[1][0], "/api/player/config?deviceId=id");
});

test("first uncached quotes are polled soon without waiting for the layout interval", async () => {
  const h = setup(false, {
    layout: "photo-dashboard",
    revision: "online:quotes",
    refreshSeconds: 3600,
    widgets: { photos: { items: [] } },
    widgetData: { currenciesPending: true, currencies: {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.timers.at(-1).delay, 2000);
});

test("quote polling is capped at thirty minutes even when layout polling is slower", async () => {
  const h = setup(false, {
    layout: "photo-dashboard",
    revision: "online:quotes",
    refreshSeconds: 3600,
    widgets: { photos: { items: [] } },
    widgetData: { currenciesPending: false, currencies: {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.timers.at(-1).delay, 1800000);
});

test("applies scoped appearance CSS variables and surface classes per widget", () => {
  const h = setup(true, undefined, true);
  const props = styleProps;
  props(h.elements.dashboard);
  props(h.elements.photos);
  props(h.elements.clock);
  props(h.elements.notes);
  h.elements.dashboard.dataset = {};

  h.app.resolveAppearance = (globalAppearance, widgetAppearance) => {
    if (widgetAppearance && widgetAppearance.preset === "borderless") {
      return {
        preset: "borderless",
        surfaceMode: "borderless",
        cornerRadius: 0,
        widgetSpacing: 12,
        innerPadding: 10,
        pageEdgePadding: 16,
        border: false,
        shadow: false,
      };
    }
    if (globalAppearance && globalAppearance.preset === "flat") {
      return {
        preset: "flat",
        surfaceMode: "flat",
        cornerRadius: 12,
        widgetSpacing: 12,
        innerPadding: 14,
        pageEdgePadding: 16,
        border: false,
        shadow: false,
      };
    }
    return {
      preset: "default",
      surfaceMode: "default",
      cornerRadius: null,
      widgetSpacing: null,
      innerPadding: null,
      pageEdgePadding: null,
      border: null,
      shadow: null,
    };
  };

  h.app.applyConfig({
    ...h.app.defaults,
    appearance: { backgroundColor: "", accentColor: "", textColor: "", preset: "flat" },
    widgets: {
      ...h.app.defaults.widgets,
      clock: { enabled: true, backgroundColor: "", appearance: { preset: "borderless" } },
      notes: { enabled: true, title: "Casa", backgroundColor: "#112233" },
    },
  });

  assert.equal(h.elements.dashboard.style.values["--page-edge-padding"], "16px");
  assert.equal(h.elements.dashboard.style.values["--widget-spacing"], "12px");
  assert.equal(h.elements.dashboard.dataset.surfaceMode, "flat");
  assert.equal(h.elements.photos.style.values["--widget-radius"], "12px");
  assert.equal(h.elements.photos.style.values["--widget-padding"], undefined);
  assert.equal(h.elements.photos.classList.has("surface-flat"), true);
  assert.equal(h.elements.clock.style.values["--widget-radius"], "0px");
  assert.equal(h.elements.clock.style.values["--widget-padding"], "10px");
  assert.equal(h.elements.clock.style.values["--widget-border"], "0px solid transparent");
  assert.equal(h.elements.clock.style.values["--widget-shadow"], "none");
  assert.equal(h.elements.clock.classList.has("surface-borderless"), true);
  assert.equal(h.elements.notes.classList.has("surface-flat"), true);
  assert.equal(h.elements.notes.classList.has("has-custom-bg"), true);
});

test("player aplica e limpa variáveis da grade livre modular", () => {
  const h = setup(true, undefined, true);
  const props = styleProps;
  props(h.elements.dashboard);
  props(h.elements.photos);
  props(h.elements.clock);
  props(h.elements.pomodoro);
  let relayouts = 0;
  h.app.currencies.relayout = () => {
    relayouts++;
  };

  h.app.applyConfig({
    ...h.app.defaults,
    orientation: "portrait",
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
        { widgetId: "clock", x: 14, y: 0, w: 10, h: 6 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
        { widgetId: "pomodoro", x: 0, y: 20, w: 6, h: 6 },
      ],
    },
    widgets: {
      ...h.app.defaults.widgets,
      pomodoro: { enabled: true, title: "Foco", backgroundColor: "" },
    },
  });

  assert.equal(h.elements.dashboard.classList.has("grid-mode"), true);
  assert.equal(h.elements.dashboard.classList.has("orientation-portrait"), true);
  assert.equal(h.elements.photos.style.values["--grid-col-landscape"], "1 / span 14");
  assert.equal(h.elements.photos.style.values["--grid-row-landscape"], "1 / span 24");
  assert.equal(h.elements.photos.style.values["--grid-col-portrait"], "1 / span 12");
  assert.equal(h.elements.photos.style.values["--grid-row-portrait"], "1 / span 20");
  assert.equal(h.elements.clock.style.values["--grid-col-landscape"], "15 / span 10");
  assert.equal(h.elements.pomodoro.style.values["--grid-row-portrait"], "21 / span 6");
  assert.equal(relayouts, 1);

  // Margens externas: meia lacuna nas divisas internas e zero nas bordas do painel.
  assert.equal(h.elements.photos.style.values["--grid-margin-top-landscape"], "0");
  assert.equal(h.elements.photos.style.values["--grid-margin-left-landscape"], "0");
  assert.equal(h.elements.photos.style.values["--grid-margin-right-landscape"], "0.5");
  assert.equal(h.elements.photos.style.values["--grid-margin-bottom-landscape"], "0");
  assert.equal(h.elements.clock.style.values["--grid-margin-top-landscape"], "0");
  assert.equal(h.elements.clock.style.values["--grid-margin-left-landscape"], "0.5");
  assert.equal(h.elements.clock.style.values["--grid-margin-right-landscape"], "0");
  assert.equal(h.elements.clock.style.values["--grid-margin-bottom-landscape"], "0.5");
  assert.equal(h.elements.photos.style.values["--grid-margin-right-portrait"], "0");
  assert.equal(h.elements.photos.style.values["--grid-margin-bottom-portrait"], "0.5");
  assert.equal(h.elements.pomodoro.style.values["--grid-margin-top-portrait"], "0.5");
  assert.equal(h.elements.pomodoro.style.values["--grid-margin-left-portrait"], "0");
  assert.equal(h.elements.clock.style.values["--grid-row-portrait"], undefined);
  assert.equal(h.elements.clock.style.values["--grid-margin-top-portrait"], undefined);

  h.app.applyConfig({
    ...h.app.defaults,
    orientation: "landscape",
    gridLayout: { enabled: false, landscape: [], portrait: [] },
  });

  assert.equal(h.elements.dashboard.classList.has("grid-mode"), false);
  assert.equal(h.elements.dashboard.classList.has("orientation-portrait"), false);
  assert.equal(h.elements.photos.style.values["--grid-col-landscape"], undefined);
  assert.equal(h.elements.photos.style.values["--grid-margin-right-landscape"], undefined);
  assert.equal(h.elements.pomodoro.style.values["--grid-row-portrait"], undefined);
  assert.equal(h.elements.pomodoro.style.values["--grid-margin-top-portrait"], undefined);
  assert.equal(relayouts, 2);
});

test("player recalcula as margens da grade ao mover um widget para a borda", () => {
  const h = setup(true, undefined, true);
  Object.values(h.elements).forEach(styleProps);
  h.app.applyConfig({
    ...h.app.defaults,
    gridLayout: {
      enabled: true,
      landscape: [{ widgetId: "clock", x: 5, y: 5, w: 4, h: 4 }],
      portrait: [],
    },
  });
  assert.equal(h.elements.clock.style.values["--grid-margin-left-landscape"], "0.5");
  assert.equal(h.elements.clock.style.values["--grid-margin-top-landscape"], "0.5");

  h.app.applyConfig({
    ...h.app.defaults,
    gridLayout: {
      enabled: true,
      landscape: [{ widgetId: "clock", x: 20, y: 20, w: 4, h: 4 }],
      portrait: [],
    },
  });
  assert.equal(h.elements.clock.style.values["--grid-col-landscape"], "21 / span 4");
  assert.equal(h.elements.clock.style.values["--grid-margin-left-landscape"], "0.5");
  assert.equal(h.elements.clock.style.values["--grid-margin-right-landscape"], "0");
  assert.equal(h.elements.clock.style.values["--grid-margin-bottom-landscape"], "0");
});
