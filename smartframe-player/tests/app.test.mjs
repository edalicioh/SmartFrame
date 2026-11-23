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

test("pages preserve all fifteen supported widgets", () => {
  const window = {};
  runInNewContext(configSource, { window, Intl });
  const keys = Object.keys(window.SmartFrame.defaults.widgets);
  assert.equal(keys.length, 15);
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

function setupInteractive(
  preview = true,
  nativeTasks = undefined,
  nativeControlDeck = undefined,
  storage = new Map(),
) {
  const listeners = {},
    documentListeners = {},
    timers = [],
    activeTimers = new Map(),
    intervals = new Map(),
    localCalls = {},
    timezoneWidgetUpdates = { clock: [], calendar: [] };
  let nextIntervalId = 0;
  let nextTimeoutId = 0;
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
      "notification-toast",
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
      "controlDeck",
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
    elements.controlDeck,
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
        "controlDeck",
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
    SmartFrameControlDeck: nativeControlDeck,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
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
      const id = ++nextTimeoutId;
      activeTimers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => {
      activeTimers.delete(id);
    },
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
    document,
    listeners,
    documentListeners,
    elements,
    intervals,
    activeTimers,
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

test("player exibe fila de toasts com textContent, deduplicação e auto-dismiss seguro", () => {
  const h = setupInteractive(false);
  const notificationMessages = [];
  h.window.SmartFrameNotifications = {
    postMessage: (message) => notificationMessages.push(JSON.parse(message)),
  };
  const alertsConfig = {
    ...h.app.defaults,
    revision: "online:v5",
    notifications: [
      {
        id: "n-1",
        title: "<b>CI</b>",
        message: "<script>alert(1)</script> Falha no build",
        severity: "alert",
        durationSeconds: 5,
      },
      {
        id: "n-2",
        title: "Deploy",
        message: "Publicado com sucesso",
        severity: "success",
        durationSeconds: 10,
      },
    ],
  };
  h.app.applyConfig(alertsConfig);

  const toast = h.elements["notification-toast"];
  assert.equal(toast.hidden, false);
  assert.equal(toast.className, "notification-toast severity-alert");
  assert.equal(toast.children[0].children[0].textContent, "<b>CI</b>");
  assert.equal(toast.children[1].textContent, "<script>alert(1)</script> Falha no build");
  assert.equal(h.app.getState().activeNotification, "n-1");

  // Reenviar n-1 no próximo polling não duplica na fila.
  h.app.applyConfig({ ...alertsConfig, notifications: [alertsConfig.notifications[0]] });

  // Timer de auto-dismiss de 5s dispara n-2 da fila.
  const fiveSecTimer = [...h.timers].reverse().find((fn) => fn.delay === 5000);
  assert.ok(fiveSecTimer);
  fiveSecTimer();

  assert.equal(toast.hidden, false);
  assert.equal(toast.className, "notification-toast severity-success");
  assert.equal(toast.children[1].textContent, "Publicado com sucesso");
  assert.equal(h.app.getState().activeNotification, "n-2");

  // Fechar manualmente oculta o toast e libera o estado.
  const closeButton = toast.children[0].children[1];
  closeButton.click();
  assert.equal(toast.hidden, true);
  assert.equal(h.app.getState().activeNotification, null);
  assert.deepEqual(notificationMessages, [{ notificationId: "n-2" }]);

  // Chamar timer antigo não fecha nem causa erro em estado posterior.
  fiveSecTimer();
  assert.equal(toast.hidden, true);
});

test("player aplica pageDirective remoto sem sobrescrever navegação manual posterior", () => {
  const h = setupInteractive(false);
  const pages = [
    { id: "p1", title: "Principal", enabledWidgets: ["photos", "clock"] },
    { id: "p2", title: "Alertas", enabledWidgets: ["devMonitor"] },
  ];

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v5",
    pages,
    pageDirective: { id: "goto:nonce-1", pageId: "p2", source: "goto", durationSeconds: 30 },
  });
  assert.equal(h.app.getState().activePageId, "p2");

  // Mesmo polling repetindo o mesmo directive ID não sobrescreve mudança manual.
  h.app.setPage("p1");
  assert.equal(h.app.getState().activePageId, "p1");
  const thirtySecRevert = h.timers.find((fn) => fn.delay === 30000);
  assert.ok(thirtySecRevert);

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v5",
    pages,
    pageDirective: { id: "goto:nonce-1", pageId: "p2", source: "goto", durationSeconds: 30 },
  });
  assert.equal(h.app.getState().activePageId, "p1");

  // Timer de reversão antigo invalidado pela troca manual não interfere.
  thirtySecRevert();
  assert.equal(h.app.getState().activePageId, "p1");

  // Nova diretiva com "next" e duração temporária reverte automaticamente no vencimento.
  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v5",
    pages,
    pageDirective: { id: "goto:nonce-2", pageId: "next", source: "goto", durationSeconds: 45 },
  });
  assert.equal(h.app.getState().activePageId, "p2");
  const revert45 = [...h.timers].reverse().find((fn) => fn.delay === 45000);
  assert.ok(revert45);
  revert45();
  assert.equal(h.app.getState().activePageId, "p1");
});

test("auto-rotação não interrompe pageDirective temporário antes do término da duração", () => {
  const h = setupInteractive(true);
  const pages = [
    { id: "p1", title: "Principal", enabledWidgets: ["photos", "clock"] },
    { id: "p2", title: "Alertas", enabledWidgets: ["devMonitor"] },
  ];

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v5",
    pageSettings: { autoRotateSeconds: 10, showIndicators: true, swipeEnabled: true },
    pages,
    pageDirective: { id: "goto:timed-1", pageId: "p2", source: "goto", durationSeconds: 45 },
  });
  assert.equal(h.app.getState().activePageId, "p2");

  const rotateInterval = [...h.intervals.values()].find((fn) => fn.delay === 10000);
  assert.ok(rotateInterval);
  // Disparos de auto-rotação durante a vigência da diretiva temporária não trocam a página nem cancelam a reversão.
  rotateInterval();
  rotateInterval();
  assert.equal(h.app.getState().activePageId, "p2");

  const revert45 = [...h.timers].reverse().find((fn) => fn.delay === 45000);
  assert.ok(revert45);
  revert45();
  assert.equal(h.app.getState().activePageId, "p1");

  // Após o término da diretiva temporária, a auto-rotação volta a avançar normalmente.
  const resumedRotate = [...h.intervals.values()].find((fn) => fn.delay === 10000);
  assert.ok(resumedRotate);
  resumedRotate();
  assert.equal(h.app.getState().activePageId, "p2");
});

test("mudança de revisão cancela reversão temporária mesmo se a página de retorno permanece", () => {
  const h = setupInteractive(true);
  const pages = [
    { id: "p1", title: "Principal", enabledWidgets: ["photos", "clock"] },
    { id: "p2", title: "Alertas", enabledWidgets: ["devMonitor"] },
  ];

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v1",
    pages,
    pageDirective: { id: "goto:revision-1", pageId: "p2", source: "goto", durationSeconds: 30 },
  });
  assert.equal(h.app.getState().activePageId, "p2");
  const oldRevert = [...h.timers].reverse().find((fn) => fn.delay === 30000);
  assert.ok(oldRevert);
  assert.ok([...h.activeTimers.values()].includes(oldRevert));

  // A nova revisão mantém p1, mas não deve herdar o timer temporário de navegação.
  h.app.applyConfig({ ...h.app.defaults, revision: "online:v2", pages });
  assert.equal(h.app.getState().activePageId, "p2");
  assert.equal([...h.activeTimers.values()].includes(oldRevert), false);

  // Mesmo que um callback já enfileirado rode, ele não reverte para p1.
  oldRevert();
  assert.equal(h.app.getState().activePageId, "p2");
});

test("pageDirective temporário restaura reversão após ocultar e reexibir o player", () => {
  const h = setupInteractive(true);
  const pages = [
    { id: "p1", title: "Principal", enabledWidgets: ["photos", "clock"] },
    { id: "p2", title: "Alertas", enabledWidgets: ["devMonitor"] },
  ];

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v5",
    pages,
    pageDirective: { id: "goto:vis-1", pageId: "p2", source: "goto", durationSeconds: 30 },
  });
  assert.equal(h.app.getState().activePageId, "p2");
  const initialRevert = [...h.timers].reverse().find((fn) => fn.delay === 30000);
  assert.ok(initialRevert);

  // Ocultar invalida o timer antigo; reexibir agenda um novo timer e ignora a mesma diretiva repetida no poll.
  h.document.hidden = true;
  h.documentListeners.visibilitychange();
  initialRevert();
  assert.equal(h.app.getState().activePageId, "p2");

  h.document.hidden = false;
  h.documentListeners.visibilitychange();
  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v5",
    pages,
    pageDirective: { id: "goto:vis-1", pageId: "p2", source: "goto", durationSeconds: 30 },
  });
  assert.equal(h.app.getState().activePageId, "p2");

  const restoredRevert = h.timers.at(-1);
  assert.ok(restoredRevert);
  assert.notEqual(restoredRevert, initialRevert);
  restoredRevert();
  assert.equal(h.app.getState().activePageId, "p1");
});

test("goto temporário mantém o hold na página alvo e republicação aplica o destino novo", () => {
  const h = setupInteractive(true);
  const pages = [
    { id: "p1", title: "Principal", enabledWidgets: ["photos"] },
    { id: "p2", title: "Alertas", enabledWidgets: ["clock"] },
  ];
  h.app.applyConfig({ ...h.app.defaults, revision: "online:v1", pages, activePageId: "p2" });
  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v1",
    pages,
    pageDirective: { id: "same-target", pageId: "p2", source: "goto", durationSeconds: 30 },
  });
  assert.ok([...h.activeTimers.values()].some((fn) => fn.delay === 30000));

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v2",
    pages,
    pageDirective: { id: "same-target", pageId: "p1", source: "schedule", durationSeconds: 0 },
  });
  assert.equal(h.app.getState().activePageId, "p1");
});

test("goto relativo consome nonce uma vez por dispositivo e publicação mesmo após reload", () => {
  const storage = new Map();
  const pages = [
    { id: "p1", title: "Um", enabledWidgets: ["photos"] },
    { id: "p2", title: "Dois", enabledWidgets: ["clock"] },
  ];
  const directiveConfig = {
    revision: "online:v-relative",
    pages,
    pageDirective: { id: "relative-nonce", pageId: "next", source: "goto", durationSeconds: 0 },
  };
  const first = setupInteractive(true, undefined, undefined, storage);
  first.app.applyConfig({ ...first.app.defaults, ...directiveConfig });
  assert.equal(first.app.getState().activePageId, "p2");

  const reloaded = setupInteractive(true, undefined, undefined, storage);
  reloaded.app.applyConfig({ ...reloaded.app.defaults, ...directiveConfig });
  assert.equal(reloaded.app.getState().activePageId, "p1");
});

test("pageDirective resolve IDs numéricos de página antes de interpretar como índice", () => {
  const h = setupInteractive(true);
  const pages = [
    { id: "1", title: "Página ID 1 na posição 0", enabledWidgets: ["photos"] },
    { id: "0", title: "Página ID 0 na posição 1", enabledWidgets: ["clock"] },
    { id: "extra", title: "Página Extra na posição 2", enabledWidgets: ["weather"] },
  ];

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v5",
    pages,
    pageDirective: { id: "goto:num-0", pageId: "0", source: "goto", durationSeconds: 0 },
  });
  assert.equal(h.app.getState().activePageId, "0");
  assert.equal(h.app.getState().activePageIndex, 1);

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v5",
    pages,
    pageDirective: { id: "goto:num-1", pageId: "1", source: "goto", durationSeconds: 0 },
  });
  assert.equal(h.app.getState().activePageId, "1");
  assert.equal(h.app.getState().activePageIndex, 0);

  // Índices numéricos que não colidem com IDs continuam funcionando como fallback.
  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v5",
    pages,
    pageDirective: { id: "goto:idx-2", pageId: "2", source: "goto", durationSeconds: 0 },
  });
  assert.equal(h.app.getState().activePageId, "extra");
  assert.equal(h.app.getState().activePageIndex, 2);
});

test("visibilitychange retoma fila de notificações, swipe sobre toast não troca página e remoção da página de retorno libera auto-rotação", () => {
  const h = setupInteractive(true);
  const pages = [
    { id: "p1", title: "Principal", enabledWidgets: ["photos", "clock"] },
    { id: "p2", title: "Alertas", enabledWidgets: ["devMonitor"] },
    { id: "p3", title: "Extra", enabledWidgets: ["notes"] },
  ];

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v6",
    pageSettings: { autoRotateSeconds: 10, showIndicators: true, swipeEnabled: true },
    pages,
    pageDirective: { id: "rule:sched-1", pageId: "p2", source: "rule", durationSeconds: 30 },
    notifications: [
      { id: "q1", title: "Primeiro", message: "Msg 1", durationSeconds: 5 },
      { id: "q2", title: "Segundo", message: "Msg 2", durationSeconds: 5 },
    ],
  });
  assert.equal(h.app.getState().activePageId, "p2");
  assert.equal(h.app.getState().activeNotification, "q1");

  // Swipe iniciado sobre o toast não troca de página.
  const toastSwipe = setupInteractive(true);
  toastSwipe.app.applyConfig({
    ...toastSwipe.app.defaults,
    revision: "online:v6-swipe",
    pages,
    notifications: [{ id: "q-swipe", title: "Toast", message: "Msg", durationSeconds: 5 }],
  });
  toastSwipe.elements.dashboard.events.pointerdown({
    pointerId: 2,
    clientX: 300,
    clientY: 20,
    target: toastSwipe.elements["notification-toast"],
  });
  toastSwipe.elements.dashboard.events.pointerup({
    pointerId: 2,
    clientX: 100,
    clientY: 20,
  });
  assert.equal(toastSwipe.app.getState().activePageId, "p1");

  // Ocultar limpa toastTimer e revertPageTimer; reexibir mostra o próximo item da fila (q2).
  h.document.hidden = true;
  h.documentListeners.visibilitychange();
  assert.equal(h.activeTimers.size, 0);
  h.document.hidden = false;
  h.documentListeners.visibilitychange();
  assert.equal(h.app.getState().activeNotification, "q2");

  // Remover p1 (página de retorno) limpa revertTargetPageId e destrava auto-rotação.
  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:v7",
    pageSettings: { autoRotateSeconds: 10, showIndicators: true, swipeEnabled: true },
    pages: [
      { id: "p2", title: "Alertas", enabledWidgets: ["devMonitor"] },
      { id: "p3", title: "Extra", enabledWidgets: ["notes"] },
    ],
    pageDirective: { id: "goto:prev-1", pageId: "prev", source: "goto", durationSeconds: 0 },
  });
  assert.equal(h.app.getState().activePageId, "p3");
  const rotateInterval = [...h.intervals.values()].find((fn) => fn.delay === 10000);
  assert.ok(rotateInterval);
  rotateInterval();
  assert.equal(h.app.getState().activePageId, "p2");
});

test("config normaliza devMonitor pushKey com trim e rejeita ids inválidos", () => {
  const window = {};
  runInNewContext(configSource, { window, Intl });
  const cfg = window.SmartFrame.normalizeConfig({
    widgets: {
      devMonitor: {
        enabled: true,
        items: [
          { id: "d1", name: "CI", pushKey: "  ci-main  " },
          { id: "d2", name: "Inv", pushKey: "invalid key!" },
        ],
      },
    },
  });
  assert.equal(cfg.widgets.devMonitor.items[0].pushKey, "ci-main");
  assert.equal(cfg.widgets.devMonitor.items[1].pushKey, "");
});

test("config normaliza controlDeck estritamente sem propagar caminho, args, script ou target", () => {
  const window = {};
  runInNewContext(configSource, { window, Intl });
  const rawTiles = Array.from({ length: 18 }, (_, i) => ({
    id: i === 0 ? "constructor" : i === 1 ? "constructor" : "tile-" + i,
    bindingId: "bind-" + i,
    label: "  Botão \x00" + i + "  ",
    icon: i === 0 ? "terminal" : i === 2 ? "invalid-icon" : "mic",
    path: "/usr/bin/rm",
    args: ["-rf"],
    script: "echo pwn",
    target: { shortcutId: "secret" },
  }));
  const cfg = window.SmartFrame.normalizeConfig({
    widgets: {
      controlDeck: {
        enabled: true,
        title: "Deck",
        columns: 99,
        path: "/etc/passwd",
        target: { host: "evil" },
        script: "bad",
        args: ["--bad"],
        tiles: rawTiles,
      },
    },
  });

  const deck = cfg.widgets.controlDeck;
  assert.equal(deck.enabled, true);
  assert.equal(deck.columns, 3);
  assert.equal("path" in deck, false);
  assert.equal("target" in deck, false);
  assert.equal("script" in deck, false);
  assert.equal("args" in deck, false);
  // Tile 1 duplicated "constructor" and is skipped; remaining valid tiles capped at 16.
  assert.equal(deck.tiles.length, 16);
  assert.deepEqual(JSON.parse(JSON.stringify(deck.tiles[0])), {
    id: "constructor",
    bindingId: "bind-0",
    label: "Botão 0",
    icon: "terminal",
  });
  assert.equal(deck.tiles[1].id, "tile-2");
  assert.equal(deck.tiles[1].icon, "bolt");
  for (const tile of deck.tiles) {
    assert.deepEqual(Object.keys(tile).sort(), ["bindingId", "icon", "id", "label"]);
  }
});

test("Control Deck usa ponte nativa SmartFrameControlDeck, timeout 12s sem retry e respeita preview", () => {
  // Sem ponte nativa: execução desabilitada.
  const noBridge = setupInteractive(false);
  assert.equal(noBridge.localCalls.controlDeck.context.canExecuteControlDeck, false);
  const noBridgeResults = [];
  noBridge.localCalls.controlDeck.context.onControlDeckExecute(
    { bindingId: "b1", command: "trigger", idempotent: false },
    (res) => noBridgeResults.push(res),
  );
  assert.equal(noBridgeResults[0].status, "unavailable");

  // Em preview=1: sempre somente leitura mesmo com ponte nativa disponível.
  const previewMessages = [];
  const previewBridge = { postMessage: (d) => previewMessages.push(d) };
  const previewH = setupInteractive(true, undefined, previewBridge);
  previewH.app.applyConfig({ ...previewH.app.defaults, revision: "online:prev" });
  assert.equal(previewH.localCalls.controlDeck.context.canExecuteControlDeck, false);
  const previewResults = [];
  previewH.localCalls.controlDeck.context.onControlDeckExecute(
    { bindingId: "b1", command: "trigger", idempotent: false },
    (res) => previewResults.push(res),
  );
  assert.equal(previewMessages.length, 0);
  assert.equal(previewResults[0].status, "unavailable");

  // Online com ponte nativa: ok, unavailable, timeout não idempotente -> unknown sem retry, timeout idempotente -> unavailable.
  const sent = [];
  const bridge = { postMessage: (data) => sent.push(JSON.parse(data)) };
  const h = setupInteractive(false, undefined, bridge);
  assert.equal(h.localCalls.controlDeck.context.canExecuteControlDeck, true);

  // Antes de revisão online válida não envia.
  const beforeRev = [];
  h.localCalls.controlDeck.context.onControlDeckExecute(
    { bindingId: "b1", command: "trigger", idempotent: false },
    (res) => beforeRev.push(res),
  );
  assert.equal(sent.length, 0);
  assert.equal(beforeRev[0].status, "unavailable");

  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:deck-1",
    widgets: {
      ...h.app.defaults.widgets,
      controlDeck: { enabled: true, title: "Deck", columns: 3, tiles: [] },
    },
    widgetData: {
      controlDeck: {
        available: true,
        checkedAt: "2026-11-20T09:00:00Z",
        hostStatus: {},
        bindings: {},
      },
    },
  });
  assert.equal(h.localCalls.controlDeck.setData.at(-1).available, true);

  const results = [];
  h.localCalls.controlDeck.context.onControlDeckExecute(
    {
      executionId: "exec-ok-1",
      bindingId: "b-vol",
      command: "set_level",
      value: 75,
      idempotent: true,
    },
    (res) => results.push(res),
  );
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    requestId: "deck-1",
    executionId: "exec-ok-1",
    revision: "online:deck-1",
    bindingId: "b-vol",
    command: "set_level",
    value: 75,
    idempotent: true,
  });
  assert.equal("token" in sent[0], false);
  bridge.onmessage({
    data: JSON.stringify({
      requestId: "deck-1",
      status: "ok",
      idempotent: true,
      state: { level: 75 },
    }),
  });
  assert.equal(results[0].status, "ok");
  assert.equal(results[0].state.level, 75);

  // Resposta unavailable do host.
  h.localCalls.controlDeck.context.onControlDeckExecute(
    {
      executionId: "exec-unavail-2",
      bindingId: "b-ptt",
      command: "ptt_acquire",
      leaseSeconds: 10,
      idempotent: true,
    },
    (res) => results.push(res),
  );
  bridge.onmessage({
    data: JSON.stringify({
      requestId: "deck-2",
      status: "unavailable",
      idempotent: true,
      message: "Agente offline",
    }),
  });
  assert.equal(results[1].status, "unavailable");
  assert.equal(results[1].message, "Agente offline");

  // Watchdog de 12000ms em comando não idempotente -> unknown sem retry!
  h.localCalls.controlDeck.context.onControlDeckExecute(
    {
      executionId: "exec-nonidemp-3",
      bindingId: "b-short",
      command: "trigger",
      idempotent: false,
    },
    (res) => results.push(res),
  );
  const watchdogNonIdemp = [...h.activeTimers.values()].find((fn) => fn.delay === 12000);
  assert.ok(watchdogNonIdemp);
  watchdogNonIdemp();
  assert.equal(sent.length, 3); // Zero retries!
  assert.deepEqual(JSON.parse(JSON.stringify(results[2])), {
    status: "unknown",
    idempotent: false,
    message: "Sem resposta do host; resultado desconhecido (não reenviado).",
  });

  // Watchdog de 12000ms em comando idempotente -> unavailable.
  h.localCalls.controlDeck.context.onControlDeckExecute(
    {
      executionId: "exec-idemp-4",
      bindingId: "b-vol",
      command: "set_level",
      value: 40,
      idempotent: true,
    },
    (res) => results.push(res),
  );
  const watchdogIdemp = [...h.activeTimers.values()].find((fn) => fn.delay === 12000);
  assert.ok(watchdogIdemp);
  watchdogIdemp();
  assert.equal(sent.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(results[3])), {
    status: "unavailable",
    idempotent: true,
    message: "Sem resposta do host.",
  });
});

test("swipes iniciados dentro de #controlDeck não trocam de página nem alternam Smart Stack", () => {
  const h = setupInteractive(true);
  h.app.applyConfig({
    ...h.app.defaults,
    widgets: {
      ...h.app.defaults.widgets,
      controlDeck: { enabled: true, title: "Deck", columns: 3, tiles: [] },
    },
    pages: [
      { id: "p1", title: "Deck", enabledWidgets: ["controlDeck"] },
      { id: "p2", title: "Fotos", enabledWidgets: ["photos"] },
    ],
  });
  const sliderChild = h.document.createElement("input");
  h.elements.controlDeck.appendChild(sliderChild);

  h.elements.dashboard.events.pointerdown({
    clientX: 300,
    clientY: 120,
    target: sliderChild,
  });
  h.elements.dashboard.events.pointerup({
    clientX: 100,
    clientY: 120,
  });
  assert.equal(h.app.getState().activePageId, "p1");

  h.elements.dashboard.events.pointerdown({
    clientX: 300,
    clientY: 120,
    target: h.elements.controlDeck,
  });
  h.elements.dashboard.events.pointerup({
    clientX: 100,
    clientY: 120,
  });
  assert.equal(h.app.getState().activePageId, "p1");
});

test("ptt_renew nao dispara schedule(0), e onmessage malformado ou comando invalido e ignorado", () => {
  const sent = [];
  const bridge = {
    postMessage(payload) {
      sent.push(JSON.parse(payload));
    },
    onmessage: null,
  };
  const h = setupInteractive(false, undefined, bridge);
  h.app.applyConfig({
    ...h.app.defaults,
    revision: "online:deck-ptt",
    widgets: {
      ...h.app.defaults.widgets,
      controlDeck: { enabled: true, title: "D", columns: 3, tiles: [] },
    },
  });
  const res = [];
  h.localCalls.controlDeck.context.onControlDeckExecute(
    { bindingId: "", command: "trigger" },
    (r) => res.push(r),
  );
  assert.equal(res[0].status, "unavailable");
  assert.equal(sent.length, 0);

  bridge.onmessage({ data: "{invalid-json" });
  const zeroTimersBefore = [...h.activeTimers.values()].filter((t) => t.delay === 0).length;
  h.localCalls.controlDeck.context.onControlDeckExecute(
    {
      executionId: "exec-ptt-renew-1",
      bindingId: "b-mic",
      command: "ptt_renew",
      leaseId: "lease-1",
      idempotent: true,
    },
    () => {},
  );
  bridge.onmessage({ data: JSON.stringify({ requestId: sent[0].requestId, status: "ok" }) });
  assert.equal([...h.activeTimers.values()].filter((t) => t.delay === 0).length, zeroTimersBefore);
});

test("regra agendada já aplicada não dispara novamente após /goto na mesma revisão e janela", () => {
  const h = setupInteractive(false);
  const base = {
    ...h.app.defaults,
    revision: "online:rev-sched-1",
    pages: [
      { id: "p1", title: "Principal", enabledWidgets: ["photos"] },
      { id: "p2", title: "Alertas", enabledWidgets: ["devMonitor"] },
    ],
  };
  const ruleDirective = {
    id: "schedule:r1:2026-11-21:09:00-18:00",
    pageId: "p2",
    source: "rule",
    durationSeconds: 30,
  };
  h.app.applyConfig({ ...base, pageDirective: ruleDirective });
  assert.equal(h.app.getState().activePageId, "p2");

  h.app.applyConfig({
    ...base,
    pageDirective: { id: "goto:g1", pageId: "p1", source: "goto", durationSeconds: 0 },
  });
  assert.equal(h.app.getState().activePageId, "p1");

  h.app.applyConfig({ ...base, pageDirective: ruleDirective });
  assert.equal(h.app.getState().activePageId, "p1");

  // Nova revisão volta a permitir aplicar a diretiva.
  h.app.applyConfig({ ...base, revision: "online:rev-sched-2", pageDirective: ruleDirective });
  assert.equal(h.app.getState().activePageId, "p2");
});
