import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/clock.js", import.meta.url), "utf8");

function setup(legacyDate = false) {
  const classes = new Set();
  const time = { textContent: "", className: "", style: {} };
  const date = legacyDate ? { hidden: false, textContent: "terça-feira, 3 de novembro" } : null;
  const card = { classList: { add: (value) => classes.add(value) } };
  const app = { timezone: "America/Sao_Paulo" };
  runInNewContext(source, {
    window: { SmartFrame: app },
    document: {
      hidden: false,
      getElementById: (id) => ({ "clock-time": time, "clock-date": date, clock: card })[id],
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });
  return { clock: app.clock, time, date, classes };
}

test("clock renders time only when an old configuration requests a date", () => {
  const { clock, time, date, classes } = setup(true);
  clock.update({ enabled: true, format: "24h", size: "large", color: "", showDate: true });
  assert.match(time.textContent, /^\d{2}:\d{2}$/);
  assert.equal(date.hidden, true);
  assert.equal(date.textContent, "");
  assert.equal(classes.has("clock-time-only"), true);
});

test("clock works without a date element in the new player document", () => {
  const { clock, time, classes } = setup();
  clock.update({ enabled: true, format: "24h", size: "normal", color: "#ffffff", showDate: true });
  clock.resume();
  assert.match(time.textContent, /^\d{2}:\d{2}$/);
  assert.equal(time.style.color, "#ffffff");
  assert.equal(classes.has("clock-time-only"), true);
});
