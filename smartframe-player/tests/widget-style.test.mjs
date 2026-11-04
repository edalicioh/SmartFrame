import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/config.js", import.meta.url), "utf8");

test("widget styles retain defaults and support partial updates and resets", () => {
  const window = {};
  runInNewContext(source, { window, Intl });
  const normalize = window.SmartFrame.normalizeConfig;
  const original = normalize({});
  assert.equal(original.widgets.clock.backgroundColor, "");
  assert.equal(original.widgets.calendar.cardSize, "normal");
  const styled = normalize(
    {
      widgets: {
        clock: { backgroundColor: "#abc", cardSize: "large" },
        currencies: { backgroundColor: "#123456", cardSize: "small" },
        photos: { backgroundColor: "#112233" },
      },
    },
    original,
  );
  const partial = normalize(
    {
      widgets: {
        clock: { backgroundColor: "red", cardSize: "huge" },
        currencies: { backgroundColor: "" },
      },
    },
    styled,
  );
  assert.equal(partial.widgets.clock.backgroundColor, "#abc");
  assert.equal(partial.widgets.clock.cardSize, "large");
  assert.equal(partial.widgets.currencies.backgroundColor, "");
  assert.equal(partial.widgets.currencies.cardSize, "small");
  assert.equal(partial.widgets.photos.backgroundColor, "#112233");
});
