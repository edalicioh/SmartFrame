import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const configSource = readFileSync(new URL("../js/config.js", import.meta.url), "utf8");

test("page IDs matching object property names are accepted", () => {
  const window = {};
  runInNewContext(configSource, { window });
  const config = window.SmartFrame.normalizeConfig({
    pages: [
      { id: "constructor", enabledWidgets: ["photos"] },
      { id: "toString", enabledWidgets: ["photos"] },
    ],
  });
  assert.equal(config.pages.length, 2);
  assert.equal(config.pages[0].id, "constructor");
  assert.equal(config.pages[1].id, "toString");
});

test("pages preserve all fourteen supported widgets", () => {
  const window = {};
  runInNewContext(configSource, { window, Intl });
  const keys = Object.keys(window.SmartFrame.defaults.widgets);
  assert.equal(keys.length, 14);
  const config = window.SmartFrame.normalizeConfig({
    pages: [{ id: "all", title: "Todos", enabledWidgets: keys }],
  });
  assert.deepEqual(Array.from(config.pages[0].enabledWidgets), keys);
});

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
    setInterval: (fn, delay) => {
      fn.delay = delay;
      timers.push(fn);
      return timers.length;
    },
    clearInterval() {},
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

test("renderers receive the active page's enabled state when switching pages", () => {
  const h = setup(true);
  const enabledStates = [];
  h.app.carousel.update = (value) => enabledStates.push(value.enabled);
  h.app.applyConfig({
    ...h.app.defaults,
    widgets: { ...h.app.defaults.widgets, photos: { enabled: true, items: [] } },
    pages: [
      { id: "without-photos", enabledWidgets: [] },
      { id: "with-photos", enabledWidgets: ["photos"] },
    ],
  });

  assert.equal(enabledStates.at(-1), false);
  h.app.setPage("with-photos");
  assert.equal(enabledStates.at(-1), true);
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

test("polls pending quotes for currencies enabled on any page", async () => {
  const h = setup(false, {
    layout: "photo-dashboard",
    revision: "online:page-quotes",
    refreshSeconds: 3600,
    widgets: { photos: { items: [] }, currencies: { enabled: false } },
    pages: [
      { id: "home", enabledWidgets: ["photos"] },
      { id: "markets", enabledWidgets: ["currencies"] },
    ],
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

function setupInteractive(preview = true, nativeTasks = undefined) {
  const listeners = {},
    documentListeners = {},
    timers = [],
    intervals = new Map(),
    localCalls = {},
    timezoneWidgetUpdates = { clock: [], calendar: [] };
  let nextIntervalId = 0;
  function createNode(tag = "div") {
    const attrs = {};
    const eventMap = {};
    const node = {
      tagName: tag.toUpperCase(),
      hidden: false,
      className: "",
      textContent: "",
      children: [],
      attributes: attrs,
      events: eventMap,
      setAttribute(name, value) {
        attrs[name] = String(value);
      },
      appendChild(child) {
        node.children.push(child);
        return child;
      },
      replaceChildren(...items) {
        node.children = [...items];
      },
      contains(target) {
        if (target === node) return true;
        return node.children.some((child) =>
          typeof child.contains === "function" ? child.contains(target) : child === target,
        );
      },
      addEventListener(name, fn) {
        eventMap[name] = fn;
      },
      click() {
        if (typeof eventMap.click === "function") {
          eventMap.click({ stopPropagation() {}, preventDefault() {} });
        }
      },
    };
    styleProps(node);
    return node;
  }

  const elements = Object.fromEntries(
    [
      "dashboard",
      "widget-stack",
      "connection-status",
      "smart-stack-nav",
      "page-nav",
      "page-overview",
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
      "system",
      "worldClock",
      "rss",
      "devMonitor",
    ].map((id) => [id, createNode("div")]),
  );
  elements["widget-stack"].children = [
    elements.clock,
    elements.weather,
    elements.currencies,
    elements.calendar,
    elements.notes,
    elements.countdown,
    elements.birthdays,
    elements.tasks,
    elements.pomodoro,
    elements.system,
    elements.worldClock,
    elements.rss,
    elements.devMonitor,
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
      [
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
        "system",
        "worldClock",
        "rss",
        "devMonitor",
      ].map((name) => [name, { enabled: name === "photos" || name === "clock", items: [] }]),
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
    clock: {
      update(value) {
        timezoneWidgetUpdates.clock.push(value);
      },
      pause() {},
      resume() {},
    },
    calendar: {
      update(value) {
        timezoneWidgetUpdates.calendar.push(value);
      },
      pause() {},
      resume() {},
    },
    weather: { update() {}, setData() {} },
    currencies: { update() {}, setData() {}, relayout() {}, pause() {}, resume() {} },
    localWidgets: {
      create: (name, _root, context) => {
        const calls = { update: [], setData: [], pause: 0, resume: 0, context };
        localCalls[name] = calls;
        return {
          update: (value) => {
            calls.update.push(value);
          },
          setData: (data) => {
            calls.setData.push(data);
          },
          pause: () => {
            calls.pause++;
          },
          resume: () => {
            calls.resume++;
          },
        };
      },
    },
  };
  const fetches = [];
  let fetchOk = true;
  const parent = { postMessage() {} };
  const window = {
    SmartFrame: app,
    SmartFrameTasks: nativeTasks,
    parent,
    addEventListener(name, fn) {
      listeners[name] = fn;
    },
    postMessage() {},
  };
  const document = {
    hidden: false,
    documentElement: createNode("html"),
    body: createNode("body"),
    createElement: (tag) => createNode(tag),
    getElementById: (id) => elements[id],
    addEventListener(name, fn) {
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
      return Promise.resolve({
        ok: fetchOk,
        json: async () => ({ layout: "photo-dashboard" }),
      });
    },
    AbortController,
    setTimeout: (fn, delay) => {
      fn.delay = delay;
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    setInterval: (fn, delay) => {
      fn.delay = delay;
      timers.push(fn);
      const id = ++nextIntervalId;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  });
  return {
    app,
    window,
    listeners,
    elements,
    intervals,
    localCalls,
    timezoneWidgetUpdates,
    fetches,
    timers,
    setFetchOk: (value) => {
      fetchOk = value;
    },
  };
}

test("player navega entre múltiplas páginas por controles, visão geral, swipe e preview", () => {
  const h = setupInteractive(true);
  const multiConfig = {
    ...h.app.defaults,
    pageSettings: { autoRotateSeconds: 0, showIndicators: true, swipeEnabled: true },
    pages: [
      {
        id: "p1",
        title: "Principal",
        enabledWidgets: ["photos", "clock"],
        layoutOptions: { photoPosition: "left", photoWidthPercent: 62 },
      },
      {
        id: "p2",
        title: "Agenda",
        enabledWidgets: ["weather", "calendar"],
        layoutOptions: { photoPosition: "right", photoWidthPercent: 50 },
      },
    ],
  };

  h.app.applyConfig(multiConfig);
  assert.equal(h.app.getState().activePageId, "p1");
  assert.equal(h.elements.photos.hidden, false);
  assert.equal(h.elements.clock.hidden, false);
  assert.equal(h.elements.weather.hidden, true);
  assert.equal(h.elements.calendar.hidden, true);
  assert.equal(h.elements["page-nav"].hidden, false);
  assert.equal(h.elements["page-overview"].hidden, true);

  // Troca de página pelo deslize horizontal no painel.
  h.elements.dashboard.events.pointerdown({
    pointerId: 1,
    clientX: 300,
    clientY: 120,
    target: h.elements.dashboard,
  });
  h.elements.dashboard.events.pointerup({
    pointerId: 1,
    clientX: 160,
    clientY: 130,
  });
  assert.equal(h.app.getState().activePageId, "p2");
  assert.equal(h.elements.photos.hidden, true);
  assert.equal(h.elements.weather.hidden, false);
  assert.equal(h.elements.calendar.hidden, false);

  // Mensagem de preview permite selecionar a página em edição no editor.
  h.listeners.message({
    origin: "https://same",
    source: h.window.parent,
    data: { type: "smartframe:online-preview", config: multiConfig, activePageId: "p1" },
  });
  assert.equal(h.app.getState().activePageId, "p1");
  h.app.toggleOverview(true);
  assert.equal(h.elements["page-overview"].hidden, false);
  const overviewCards = h.elements["page-overview"].children[1].children;
  assert.equal(overviewCards.length, 2);
  overviewCards[1].click();
  assert.equal(h.app.getState().activePageId, "p2");
  assert.equal(h.elements["page-overview"].hidden, true);
});

test("swipes sobre fotos e seus filhos não trocam a página", () => {
  const h = setupInteractive(true);
  h.app.applyConfig({
    ...h.app.defaults,
    pages: [
      { id: "first", title: "Primeira", enabledWidgets: ["photos", "clock"] },
      { id: "second", title: "Segunda", enabledWidgets: ["photos", "clock"] },
    ],
  });
  const photoImage = {};
  h.elements.photos.children.push(photoImage);
  function swipe(target) {
    h.elements.dashboard.events.pointerdown({ clientX: 300, clientY: 120, target });
    h.elements.dashboard.events.pointerup({ clientX: 160, clientY: 120 });
  }

  swipe(h.elements.photos);
  assert.equal(h.app.getState().activePageId, "first");
  swipe(photoImage);
  assert.equal(h.app.getState().activePageId, "first");
  swipe(h.elements.clock);
  assert.equal(h.app.getState().activePageId, "second");
});

test("player alterna widgets no Smart Stack e compartilha coordenadas na grade", () => {
  const h = setupInteractive(true);
  h.app.applyConfig({
    ...h.app.defaults,
    widgets: {
      ...h.app.defaults.widgets,
      photos: { enabled: true, items: [] },
      clock: { enabled: true, items: [] },
      weather: { enabled: true, items: [] },
    },
    smartStack: {
      enabled: true,
      title: "Pilha Rápida",
      widgets: ["clock", "weather"],
      intervalSeconds: 0,
      showIndicators: true,
    },
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
        { widgetId: "clock", x: 14, y: 0, w: 10, h: 12 },
        { widgetId: "weather", x: 14, y: 0, w: 10, h: 12 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
        { widgetId: "clock", x: 0, y: 20, w: 12, h: 10 },
        { widgetId: "weather", x: 0, y: 20, w: 12, h: 10 },
      ],
    },
  });

  assert.equal(h.elements["smart-stack-nav"].hidden, false);
  assert.equal(h.elements.photos.hidden, false);
  assert.equal(h.elements.clock.hidden, false);
  assert.equal(h.elements.weather.hidden, true);
  assert.equal(h.elements.clock.style.values["--grid-col-landscape"], "15 / span 10");
  assert.equal(h.elements.weather.style.values["--grid-col-landscape"], "15 / span 10");
  assert.equal(h.elements["smart-stack-nav"].style.values["--grid-col-landscape"], "15 / span 10");
  assert.equal(h.elements["smart-stack-nav"].style.values["--grid-row-landscape"], "1 / span 12");

  // Gesto vertical sobre o card da pilha alterna para o próximo widget empilhado.
  h.elements.dashboard.events.pointerdown({
    pointerId: 2,
    clientX: 500,
    clientY: 220,
    target: h.elements.clock,
  });
  h.elements.dashboard.events.pointerup({
    pointerId: 2,
    clientX: 505,
    clientY: 120,
  });
  assert.equal(h.app.getState().activeStackIndex, 1);
  assert.equal(h.elements.clock.hidden, true);
  assert.equal(h.elements.weather.hidden, false);

  h.app.stepSmartStack(1);
  assert.equal(h.app.getState().activeStackIndex, 0);
  assert.equal(h.elements.clock.hidden, false);
  assert.equal(h.elements.weather.hidden, true);
});

test("widget local oculto no Smart Stack é inicializado e sincronizado antes de aparecer", () => {
  const h = setupInteractive(true);
  const stackConfig = {
    ...h.app.defaults,
    widgets: {
      ...h.app.defaults.widgets,
      notes: {
        enabled: true,
        title: "Recados",
        messages: [{ id: "m1", text: "Primeiro" }],
        intervalSeconds: 15,
      },
      countdown: {
        enabled: true,
        title: "Contagem",
        target: { kind: "date", date: "2026-01-01" },
        display: "days",
        completedText: "Chegou",
      },
    },
    smartStack: {
      enabled: true,
      title: "Pilha",
      widgets: ["notes", "countdown"],
      intervalSeconds: 0,
      showIndicators: true,
    },
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
        { widgetId: "notes", x: 14, y: 0, w: 10, h: 12 },
        { widgetId: "countdown", x: 14, y: 0, w: 10, h: 12 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
        { widgetId: "notes", x: 0, y: 20, w: 12, h: 10 },
        { widgetId: "countdown", x: 0, y: 20, w: 12, h: 10 },
      ],
    },
  };

  h.app.applyConfig(stackConfig);
  assert.equal(h.elements.notes.hidden, false);
  assert.equal(h.elements.countdown.hidden, true);
  assert.equal(h.localCalls.countdown.update.length, 1);
  assert.equal(h.localCalls.countdown.update[0].title, "Contagem");
  assert.equal(h.localCalls.countdown.resume, 0);

  const changed = {
    ...stackConfig,
    widgets: {
      ...stackConfig.widgets,
      countdown: { ...stackConfig.widgets.countdown, title: "Contagem nova" },
    },
  };
  h.app.applyConfig(changed);
  assert.equal(h.elements.countdown.hidden, true);
  assert.equal(h.localCalls.countdown.update.length, 2);
  assert.equal(h.localCalls.countdown.update[1].title, "Contagem nova");
  assert.equal(h.localCalls.countdown.resume, 0);

  h.app.stepSmartStack(1);
  assert.equal(h.app.getState().activeStackIndex, 1);
  assert.equal(h.elements.notes.hidden, true);
  assert.equal(h.elements.countdown.hidden, false);
  assert.equal(h.localCalls.countdown.update.length, 2);
  assert.equal(h.localCalls.countdown.resume, 1);
});

test("selecionar um indicador da pilha preserva o estado dos widgets", () => {
  const h = setupInteractive(true);
  let carouselUpdates = 0;
  h.app.carousel.update = () => {
    carouselUpdates++;
  };
  h.app.applyConfig({
    ...h.app.defaults,
    widgets: {
      ...h.app.defaults.widgets,
      notes: {
        enabled: true,
        title: "Recados",
        messages: [{ id: "m1", text: "Primeiro" }],
        intervalSeconds: 15,
      },
    },
    smartStack: {
      enabled: true,
      title: "Pilha",
      widgets: ["notes", "clock"],
      intervalSeconds: 0,
      showIndicators: true,
    },
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
        { widgetId: "notes", x: 14, y: 0, w: 10, h: 12 },
        { widgetId: "clock", x: 14, y: 0, w: 10, h: 12 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
        { widgetId: "notes", x: 0, y: 20, w: 12, h: 10 },
        { widgetId: "clock", x: 0, y: 20, w: 12, h: 10 },
      ],
    },
  });

  const carouselBefore = carouselUpdates;
  const notesUpdatesBefore = h.localCalls.notes.update.length;
  const dots = h.elements["smart-stack-nav"].children[1].children;
  assert.equal(dots.length, 2);
  dots[1].click();

  assert.equal(h.app.getState().activeStackIndex, 1);
  assert.equal(h.elements.notes.hidden, true);
  assert.equal(h.elements.clock.hidden, false);
  assert.equal(carouselUpdates, carouselBefore);
  assert.equal(h.localCalls.notes.update.length, notesUpdatesBefore);
});

test("timers de rotação sobrevivem a atualizações e transições não relacionadas", () => {
  const h = setupInteractive(true);
  const multiConfig = {
    ...h.app.defaults,
    pageSettings: { autoRotateSeconds: 20, showIndicators: true, swipeEnabled: true },
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
        { widgetId: "clock", x: 14, y: 0, w: 10, h: 12 },
        { widgetId: "weather", x: 14, y: 0, w: 10, h: 12 },
        { widgetId: "calendar", x: 14, y: 12, w: 10, h: 12 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
        { widgetId: "clock", x: 0, y: 20, w: 12, h: 10 },
        { widgetId: "weather", x: 0, y: 20, w: 12, h: 10 },
        { widgetId: "calendar", x: 0, y: 30, w: 12, h: 10 },
      ],
    },
    pages: [
      {
        id: "p1",
        title: "Principal",
        enabledWidgets: ["photos", "clock", "weather"],
        smartStack: {
          enabled: true,
          title: "Pilha",
          widgets: ["clock", "weather"],
          intervalSeconds: 10,
          showIndicators: true,
        },
      },
      {
        id: "p2",
        title: "Agenda",
        enabledWidgets: ["weather", "calendar"],
      },
    ],
  };

  h.app.applyConfig(multiConfig);
  const findTimer = (delay) =>
    [...h.intervals.values()].find((callback) => callback.delay === delay);
  const firstPageTimer = findTimer(20000);
  const firstStackTimer = findTimer(10000);
  assert.ok(firstPageTimer);
  assert.ok(firstStackTimer);

  // Uma nova configuração idêntica (como o polling periódico) não reinicia os timers.
  h.app.applyConfig(multiConfig);
  assert.equal(findTimer(20000), firstPageTimer);
  assert.equal(findTimer(10000), firstStackTimer);

  // Uma transição do Smart Stack não reinicia a rotação da página nem da pilha.
  h.app.stepSmartStack(1);
  assert.equal(h.app.getState().activeStackIndex, 1);
  assert.equal(findTimer(20000), firstPageTimer);
  assert.equal(findTimer(10000), firstStackTimer);
});

test("Smart Stack com um único membro ativo mantém esse widget visível", () => {
  const h = setupInteractive(true);
  h.app.applyConfig({
    ...h.app.defaults,
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
        { widgetId: "clock", x: 14, y: 0, w: 10, h: 12 },
        { widgetId: "weather", x: 14, y: 0, w: 10, h: 12 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
        { widgetId: "clock", x: 0, y: 20, w: 12, h: 10 },
        { widgetId: "weather", x: 0, y: 20, w: 12, h: 10 },
      ],
    },
    pageSettings: { autoRotateSeconds: 0, showIndicators: true, swipeEnabled: true },
    pages: [
      {
        id: "p1",
        title: "Principal",
        enabledWidgets: ["photos", "clock"],
        smartStack: {
          enabled: true,
          title: "Pilha",
          widgets: ["clock", "weather"],
          intervalSeconds: 10,
          showIndicators: true,
        },
      },
    ],
  });

  assert.equal(h.app.getState().stackWidgets.join(","), "clock");
  assert.equal(h.elements.clock.hidden, false);
  assert.equal(h.elements.weather.hidden, true);
  assert.equal(h.elements["smart-stack-nav"].hidden, true);
});

test("atualização de fuso preserva relógio e calendário habilitados pela página", () => {
  const h = setupInteractive(true);
  const pageConfig = {
    ...h.app.defaults,
    widgets: {
      ...h.app.defaults.widgets,
      clock: { ...h.app.defaults.widgets.clock, enabled: false },
      calendar: { ...h.app.defaults.widgets.calendar, enabled: false },
    },
    pages: [
      {
        id: "page-one",
        title: "Principal",
        enabledWidgets: ["photos", "clock", "calendar"],
      },
    ],
  };

  h.app.applyConfig(pageConfig);
  h.app.applyConfig({ ...pageConfig, timezone: "America/Manaus" });

  assert.equal(h.timezoneWidgetUpdates.clock.at(-1).enabled, true);
  assert.equal(h.timezoneWidgetUpdates.calendar.at(-1).enabled, true);
});

test("mantém navegação por setas quando indicadores e swipe estão desativados", () => {
  const h = setupInteractive(true);
  h.app.applyConfig({
    ...h.app.defaults,
    pageSettings: { autoRotateSeconds: 0, showIndicators: false, swipeEnabled: false },
    pages: [
      { id: "first", title: "Primeira", enabledWidgets: ["photos"] },
      { id: "second", title: "Segunda", enabledWidgets: ["clock"] },
    ],
  });

  const nav = h.elements["page-nav"];
  assert.equal(nav.hidden, false);
  assert.equal(
    nav.children.some((child) => child.className === "page-nav-dots"),
    false,
  );
  const nextButton = nav.children.find(
    (child) => child.attributes["aria-label"] === "Próxima página",
  );
  assert.ok(nextButton);
  nextButton.click();
  assert.equal(h.app.getState().activePageId, "second");
});

test("player repassa widgetData da Fase 4 no modo online", () => {
  const h = setupInteractive(false);
  h.app.applyConfig({
    ...h.app.defaults,
    widgets: {
      ...h.app.defaults.widgets,
      system: { enabled: true, title: "Sistema" },
      rss: { enabled: true, title: "RSS", feedUrl: "https://feeds.example.com/news.xml" },
      devMonitor: { enabled: true, title: "Dev/IA", showServerMetrics: true, items: [] },
    },
    widgetData: {
      system: { cpuUsagePercent: 18, cpuCores: 4, memoryUsedPercent: 40 },
      rss: { title: "Feed", items: [{ title: "Item 1" }] },
      devMonitor: {
        nodeVersion: "v24.0.0",
        rssMemoryMb: 90,
        activeDevicesCount: 1,
        readyPhotosCount: 3,
      },
    },
  });

  assert.equal(h.elements.system.hidden, false);
  assert.equal(h.elements.rss.hidden, false);
  assert.equal(h.elements.devMonitor.hidden, false);
  assert.equal(h.localCalls.system.setData.at(-1).cpuUsagePercent, 18);
  assert.equal(h.localCalls.rss.setData.at(-1).title, "Feed");
  assert.equal(h.localCalls.devMonitor.setData.at(-1).nodeVersion, "v24.0.0");
});

test("task interaction is disabled without a supported native transport", () => {
  const h = setupInteractive(false);
  assert.equal(h.localCalls.tasks.context.canToggleTasks, false);
  let rolledBack = false;
  h.localCalls.tasks.context.onToggleTask("t1", true, () => {
    rolledBack = true;
  });
  assert.equal(
    h.fetches.some(([url]) => String(url).includes("/api/player/tasks")),
    false,
  );
  assert.equal(rolledBack, true);
});

test("Android task writes use the scoped native bridge and acknowledge success or rollback", () => {
  const messages = [];
  const bridge = { postMessage: (data) => messages.push(JSON.parse(data)) };
  const h = setupInteractive(false, bridge);
  h.app.applyConfig({ ...h.app.defaults, revision: "online:shown" });
  assert.equal(h.localCalls.tasks.context.canToggleTasks, true);
  let rollbacks = 0;
  const settled = [];
  h.localCalls.tasks.context.onToggleTask(
    "t1",
    true,
    () => rollbacks++,
    (ok) => settled.push(ok),
  );
  assert.deepEqual(messages[0], {
    requestId: "task-1",
    revision: "online:shown",
    taskId: "t1",
    completed: true,
  });
  assert.equal(
    h.fetches.some(([url]) => String(url).includes("/api/player/tasks")),
    false,
  );
  bridge.onmessage({ data: JSON.stringify({ requestId: "task-1", ok: true }) });
  assert.equal(rollbacks, 0);
  assert.deepEqual(settled, [true]);
  assert.equal(h.timers.at(-1).delay, 0);
  h.localCalls.tasks.context.onToggleTask("t1", false, () => rollbacks++);
  bridge.onmessage({ data: JSON.stringify({ requestId: "task-2", ok: false }) });
  bridge.onmessage({ data: JSON.stringify({ requestId: "task-2", ok: false }) });
  assert.equal(rollbacks, 1);
  h.localCalls.tasks.context.onToggleTask("t1", true, () => rollbacks++);
  h.timers.at(-1)();
  assert.equal(rollbacks, 2);
  assert.equal(h.timers.at(-1).delay, 0);
});

test("task bridge never writes before a valid publication is displayed", () => {
  const messages = [];
  const h = setupInteractive(false, { postMessage: (data) => messages.push(data) });
  const settled = [];
  h.localCalls.tasks.context.onToggleTask(
    "t1",
    true,
    () => {},
    (ok) => settled.push(ok),
  );
  assert.deepEqual(settled, [false]);
  assert.equal(messages.length, 0);
});

test("changing publication refreshes tasks even when their settings are identical", () => {
  const h = setupInteractive(true);
  const widgets = { ...h.app.defaults.widgets, tasks: { enabled: true, items: [] } };
  h.app.applyConfig({ ...h.app.defaults, revision: "online:first", widgets });
  const updates = h.localCalls.tasks.update.length;
  h.app.applyConfig({ ...h.app.defaults, revision: "online:second", widgets });
  assert.equal(h.localCalls.tasks.update.length, updates + 1);
  assert.equal(h.localCalls.tasks.context.revision, "online:second");
  h.app.applyConfig({ ...h.app.defaults, revision: "online:second", widgets });
  assert.equal(h.localCalls.tasks.update.length, updates + 2);
});

test("preview never writes tasks even when a native bridge is available", () => {
  const messages = [];
  const h = setupInteractive(true, { postMessage: (data) => messages.push(data) });
  h.localCalls.tasks.context.onToggleTask("t1", true, () => {});
  assert.equal(messages.length, 0);
  assert.equal(h.fetches.length, 0);
});
