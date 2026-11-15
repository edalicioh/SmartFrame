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

test("scoped appearance normalizes presets, bounds, resets and inheritance", () => {
  const window = {};
  runInNewContext(source, { window, Intl });
  const { normalizeConfig: normalize, resolveAppearance } = window.SmartFrame;
  const original = normalize({});
  assert.equal(original.appearance.preset, null);
  assert.equal(original.widgets.clock.appearance, null);

  const styled = normalize(
    {
      appearance: {
        preset: "cards",
        cornerRadius: 0,
        widgetSpacing: 24,
        innerPadding: 0,
        pageEdgePadding: 32,
        border: false,
        shadow: true,
      },
      widgets: {
        clock: {
          appearance: {
            preset: "flat",
            cornerRadius: 10,
            widgetSpacing: 18,
            pageEdgePadding: 14,
            border: true,
          },
        },
        notes: {
          enabled: true,
          backgroundColor: "#223344",
          appearance: { cornerRadius: 4 },
        },
      },
    },
    original,
  );
  assert.equal(styled.appearance.preset, "cards");
  assert.equal(styled.appearance.cornerRadius, 0);
  assert.equal(styled.appearance.widgetSpacing, 24);
  assert.equal(styled.appearance.border, false);
  assert.equal(styled.widgets.clock.appearance.preset, "flat");
  assert.equal(styled.widgets.clock.appearance.cornerRadius, 10);
  assert.equal("widgetSpacing" in styled.widgets.clock.appearance, false);
  assert.equal("pageEdgePadding" in styled.widgets.clock.appearance, false);
  assert.equal(styled.widgets.notes.backgroundColor, "#223344");
  assert.equal(styled.widgets.notes.appearance.cornerRadius, 4);

  const invalidPartial = normalize(
    {
      appearance: { cornerRadius: 99, preset: "unknown", widgetSpacing: -1 },
      widgets: { clock: { appearance: { innerPadding: 25 } } },
    },
    styled,
  );
  assert.equal(invalidPartial.appearance.cornerRadius, 0);
  assert.equal(invalidPartial.appearance.preset, "cards");
  assert.equal(invalidPartial.appearance.widgetSpacing, 24);
  assert.equal(invalidPartial.widgets.clock.appearance.innerPadding, null);

  const explicitReset = normalize(
    {
      appearance: { cornerRadius: null, border: null },
      widgets: { clock: { appearance: null } },
    },
    styled,
  );
  assert.equal(explicitReset.appearance.cornerRadius, null);
  assert.equal(explicitReset.appearance.border, null);
  assert.equal(explicitReset.widgets.clock.appearance, null);

  const fullConfigReset = normalize(
    {
      layout: "photo-dashboard",
      appearance: { backgroundColor: "#E8EEF5", accentColor: "#2563EB", textColor: "#172033" },
      widgets: { clock: { enabled: true } },
    },
    styled,
  );
  assert.equal(fullConfigReset.appearance.preset, null);
  assert.equal(fullConfigReset.appearance.widgetSpacing, null);
  assert.equal(fullConfigReset.widgets.clock.appearance, null);

  assert.deepEqual(JSON.parse(JSON.stringify(resolveAppearance({ preset: "seamless" }, null))), {
    preset: "seamless",
    surfaceMode: "seamless",
    cornerRadius: 0,
    widgetSpacing: 0,
    innerPadding: 12,
    pageEdgePadding: 0,
    border: true,
    shadow: false,
  });
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        resolveAppearance(
          { preset: "flat", cornerRadius: 20, widgetSpacing: 16, pageEdgePadding: 24 },
          { preset: "default" },
        ),
      ),
    ),
    {
      preset: "default",
      surfaceMode: "default",
      cornerRadius: null,
      widgetSpacing: 16,
      innerPadding: null,
      pageEdgePadding: 24,
      border: null,
      shadow: null,
    },
  );

  assert.equal(normalize({}).gridLayout, null);
  const gridNormalized = normalize({
    layout: "photo-dashboard",
    gridLayout: {
      enabled: true,
      landscape: [
        { widgetId: "photos", x: 0, y: 0, w: 15, h: 24 },
        { widgetId: "photos", x: 2, y: 2, w: 4, h: 4 },
        { widgetId: "clock", x: 15, y: 0, w: 9, h: 4 },
        { widgetId: "pomodoro", x: 15, y: 4, w: 3, h: 2 },
        { widgetId: "unknown", x: 0, y: 0, w: 4, h: 4 },
      ],
      portrait: [
        { widgetId: "photos", x: 0, y: 0, w: 12, h: 18 },
        { widgetId: "clock", x: 0, y: 39, w: 4, h: 2 },
      ],
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(gridNormalized.gridLayout)), {
    enabled: true,
    landscape: [
      { widgetId: "photos", x: 0, y: 0, w: 15, h: 24 },
      { widgetId: "clock", x: 15, y: 0, w: 9, h: 4 },
    ],
    portrait: [{ widgetId: "photos", x: 0, y: 0, w: 12, h: 18 }],
  });
});
