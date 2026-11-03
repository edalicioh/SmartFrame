import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/currencies.js", import.meta.url), "utf8");
const configSource = readFileSync(new URL("../js/config.js", import.meta.url), "utf8");
const now = Date.parse("2026-11-03T12:00:00Z");
const quote = (value, overrides = {}) => ({
  value,
  source: "Coinbase",
  updatedAt: new Date(now).toISOString(),
  stale: false,
  ...overrides,
});

function setup(width = 400) {
  const timers = new Map();
  let id = 0;
  function element() {
    return {
      children: [],
      style: {},
      clientWidth: width,
      set textContent(value) {
        this.text = value;
        this.children = [];
      },
      get textContent() {
        return this.text || "";
      },
      appendChild(child) {
        this.children.push(child);
      },
    };
  }
  const elements = { "currency-list": element() };
  const app = { timezone: "UTC" };
  const listeners = {};
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  runInNewContext(source, {
    window: {
      SmartFrame: app,
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
    },
    document: { getElementById: (key) => elements[key], createElement: element },
    Intl,
    Date: Clock,
    setTimeout: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
  });
  const config = {
    enabled: true,
    pairs: ["USD/BRL", "BTC/USD", "ETH/BTC"],
    displayCount: 2,
    intervalSeconds: 10,
  };
  app.currencies.update(config);
  return {
    app,
    config,
    elements,
    timers,
    listeners,
    items: () => elements["currency-list"].children,
  };
}

test("renders only the pair and its value, with details in the tooltip", () => {
  const h = setup();
  h.app.currencies.setData({ "USD/BRL": quote(5.4), "BTC/USD": quote(65000) });
  assert.equal(h.items()[0].children[0].textContent, "USD/BRL");
  assert.match(h.items()[0].children[1].textContent, /R\$\s*5,40/);
  assert.equal(h.items()[1].children[0].textContent, "BTC/USD");
  assert.match(h.items()[1].children[1].textContent, /US\$\s*65\.000,00/);
  assert.equal(h.items()[0].children.length, 2);
  assert.equal(h.items()[1].children.length, 2);
  assert.match(h.items()[0].title, /Coinbase · consultado em/);
});

test("adapts the count to available space and rotates all configured pairs", () => {
  const h = setup(180);
  h.app.currencies.setData({ "ETH/BTC": quote(0.03456789) });
  assert.equal(h.items().length, 1);
  let next = h.timers.values().next().value;
  h.timers.clear();
  next();
  assert.equal(h.items()[0].children[0].textContent, "BTC/USD");
  next = h.timers.values().next().value;
  h.timers.clear();
  next();
  assert.equal(h.items()[0].children[0].textContent, "ETH/BTC");
  assert.equal(h.items()[0].children[1].textContent, "0,03456789 BTC");
  h.elements["currency-list"].clientWidth = 900;
  h.app.currencies.update({ ...h.config, displayCount: 4 });
  assert.equal(h.items().length, 3);
});

test("missing quotes show a dash and stale details stay in the tooltip", () => {
  const h = setup();
  h.app.currencies.setData({ "USD/BRL": quote(5.4, { stale: true }), "BTC/USD": quote(NaN) });
  assert.match(h.items()[0].title, /Dados anteriores/);
  assert.equal(h.items()[1].children[1].textContent, "—");
  assert.equal(h.items()[1].children.length, 2);
  assert.equal(h.items()[1].title, "Cotação indisponível");
  h.app.currencies.setData({
    "USD/BRL": quote(5.3, { updatedAt: new Date(now - 60000).toISOString() }),
  });
  assert.doesNotMatch(h.items()[0].title, /Dados anteriores/);
  h.app.currencies.setData({
    "USD/BRL": quote(5.3, { updatedAt: new Date(now - 30 * 60000).toISOString() }),
  });
  assert.match(h.items()[0].title, /Dados anteriores/);
  h.app.currencies.pause();
  assert.equal(h.timers.size, 0);
  h.app.currencies.resume();
  assert.equal(h.timers.size, 1);
});

test("configuration migrates legacy symbols and rejects invalid pairs and counts", () => {
  const window = {};
  runInNewContext(configSource, { window, Intl });
  const normalize = (currencies) =>
    window.SmartFrame.normalizeConfig({ widgets: { currencies } }).widgets.currencies;
  assert.deepEqual(Array.from(normalize({ symbols: ["BTC", "USD"] }).pairs), [
    "BTC/BRL",
    "USD/BRL",
  ]);
  const custom = normalize({
    pairs: ["BTC/USD", "ETH/EUR", "GBP/JPY", "BRL/CHF"],
    displayCount: 4,
  });
  assert.equal(custom.pairs.length, 4);
  assert.equal(custom.displayCount, 4);
  for (const pairs of [[], ["BTC/BTC"], ["USD/BRL", "USD/BRL"], ["XYZ/USD"], [1]])
    assert.deepEqual(Array.from(normalize({ pairs, displayCount: 9 }).pairs), [
      "USD/BRL",
      "EUR/BRL",
      "BTC/BRL",
    ]);
});
