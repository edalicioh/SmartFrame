import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

function setup(
  preview = false,
  responseData = {
    layout: "photo-dashboard",
    revision: "online:v4",
    widgets: { photos: { items: [] } },
  },
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
    body: { classList: classes() },
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
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
  });
  return { app, window, fetches, listeners, documentListeners, timers };
}

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
