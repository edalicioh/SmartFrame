import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/weather.js", import.meta.url), "utf8");

function setup() {
  const elements = Object.fromEntries(
    ["weather", "weather-temperature", "weather-range"].map((id) => [
      id,
      {
        textContent: "",
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      },
    ]),
  );
  const app = {};
  runInNewContext(source, {
    window: { SmartFrame: app },
    document: {
      getElementById: (id) => {
        assert.ok(elements[id], `Elemento inesperado: ${id}`);
        return elements[id];
      },
    },
  });
  app.weather.update({ enabled: true, city: "Camboriú" });
  return { weather: app.weather, elements };
}

const data = {
  city: "Camboriú",
  temperature: 26.6,
  maximum: 29.2,
  minimum: 19.8,
  updatedAt: "2026-11-03T12:00:00.000Z",
  stale: false,
};

test("weather displays only current, maximum and minimum temperatures", () => {
  const { weather, elements } = setup();
  weather.setData(data);
  assert.equal(elements["weather-temperature"].textContent, "27°");
  assert.equal(elements["weather-range"].textContent, "Máx. 29°  ·  Mín. 20°");
  weather.setData({ ...data, stale: true });
  assert.equal(elements["weather-temperature"].textContent, "27°");
  assert.match(elements.weather.attributes["aria-label"], /dados anteriores/);
});

test("missing, invalid or other-city weather uses temperature placeholders", () => {
  const { weather, elements } = setup();
  for (const input of [null, { ...data, temperature: NaN }, { ...data, city: "Outra cidade" }]) {
    weather.setData(input);
    assert.equal(elements["weather-temperature"].textContent, "—°");
    assert.equal(elements["weather-range"].textContent, "Máx. —° · Mín. —°");
  }
  weather.setData(data);
  weather.update({ enabled: true, city: "Outra cidade" });
  assert.equal(elements["weather-temperature"].textContent, "—°");
});
