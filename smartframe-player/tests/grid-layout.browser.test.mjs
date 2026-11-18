import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

/*
 * Renderiza o player real em um Chromium headless para conferir a cascata e a
 * geometria da grade modular, algo que os testes de unidade de `app.js` não
 * conseguem observar. Sem Chromium instalado a suíte é ignorada.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browserCandidates = [
  process.env.SMARTFRAME_BROWSER,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const browser = browserCandidates.find((candidate) => existsSync(candidate));
const skip = browser ? false : "Chromium/Chrome não encontrado para os testes de renderização";

const landscapeGrid = { columns: 24, rows: 24 };
const portraitGrid = { columns: 12, rows: 40 };
const pageEdge = 16;
const spacing = 24;

const landscapeItems = [
  { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
  { widgetId: "clock", x: 14, y: 0, w: 10, h: 6 },
  { widgetId: "weather", x: 14, y: 6, w: 5, h: 6 },
  { widgetId: "currencies", x: 19, y: 6, w: 5, h: 6 },
  { widgetId: "calendar", x: 14, y: 12, w: 10, h: 12 },
];
const portraitItems = [
  { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
  { widgetId: "clock", x: 0, y: 20, w: 6, h: 6 },
  { widgetId: "weather", x: 0, y: 26, w: 6, h: 7 },
  { widgetId: "currencies", x: 0, y: 33, w: 6, h: 7 },
  { widgetId: "calendar", x: 6, y: 20, w: 6, h: 20 },
];

function panelConfig({
  orientation = "landscape",
  widgetSpacing = spacing,
  photos = true,
  innerPadding,
  widgetInnerPadding,
} = {}) {
  const appearance = { widgetSpacing, pageEdgePadding: pageEdge };
  if (innerPadding !== undefined) appearance.innerPadding = innerPadding;
  return {
    layout: "photo-dashboard",
    orientation,
    appearance,
    gridLayout: { enabled: true, landscape: landscapeItems, portrait: portraitItems },
    widgets: {
      photos: { enabled: photos, items: [] },
      ...(widgetInnerPadding === undefined
        ? {}
        : { weather: { appearance: { innerPadding: widgetInnerPadding } } }),
    },
  };
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function harness(config, sizes, interaction) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
html, body { margin: 0; }
#frame { display: block; border: 0; background: #fff; }
</style>
</head>
<body>
<iframe id="frame" src="/player-dashboard/index.html?preview=1" title="player"></iframe>
<pre id="result">pending</pre>
<script>
const config = ${JSON.stringify(config)};
const sizes = ${JSON.stringify(sizes)};
const interaction = ${JSON.stringify(interaction)};
const frame = document.getElementById("frame");
const results = [];
let focusedTask;
function measure() {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const dash = doc.getElementById("dashboard");
  const dashStyle = win.getComputedStyle(dash);
  const origin = dash.getBoundingClientRect();
  const items = {};
  for (const element of doc.querySelectorAll("#dashboard > .photo-panel, #widget-stack > .card")) {
    const style = win.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    items[element.id] = {
      hidden: element.hidden,
      columnStart: style.gridColumnStart,
      columnEnd: style.gridColumnEnd,
      rowStart: style.gridRowStart,
      rowEnd: style.gridRowEnd,
      margins: ["Top", "Right", "Bottom", "Left"].map((side) =>
        parseFloat(style["margin" + side]),
      ),
      padding: ["Top", "Right", "Bottom", "Left"].map((side) =>
        parseFloat(style["padding" + side]),
      ),
      box: [box.left - origin.left, box.top - origin.top, box.width, box.height],
    };
  }
  results.push({
    size: [win.innerWidth, win.innerHeight],
    portrait: win.matchMedia("(orientation: portrait)").matches,
    className: dash.className,
    gap: parseFloat(dashStyle.gap) || 0,
    padding: parseFloat(dashStyle.paddingTop),
    columns: dashStyle.gridTemplateColumns.split(" ").length,
    client: [dash.clientWidth, dash.clientHeight],
    scroll: [dash.scrollWidth, dash.scrollHeight],
    playerState: win.SmartFrame.getState(),
    activePhoto: doc.querySelector("#photo-indicators .active")?.getAttribute("aria-label"),
    task: focusedTask && {
      focused: doc.activeElement === focusedTask,
      label: focusedTask.textContent,
      pressed: focusedTask.getAttribute("aria-pressed"),
    },
    items,
  });
  document.getElementById("result").textContent = JSON.stringify(results);
}
function apply(index) {
  frame.style.width = sizes[index][0] + "px";
  frame.style.height = sizes[index][1] + "px";
  setTimeout(() => {
    try {
      if (interaction === "refreshTasks") {
        const doc = frame.contentDocument;
        if (index === 0) {
          focusedTask = doc.querySelector("#tasks button");
          focusedTask.focus();
        } else {
          if (index === 2) {
            const items = config.widgets.tasks.items;
            items[0].completed = true;
            items.reverse();
          }
          frame.contentWindow.applyConfig(config);
        }
      }
      measure();
      if (interaction === "swipePhoto" && index === 0) {
        const win = frame.contentWindow;
        const photo = frame.contentDocument.querySelector(".photo-image.is-current");
        photo.dispatchEvent(new win.PointerEvent("pointerdown", {
          bubbles: true, clientX: 300, clientY: 120, pointerId: 1, pointerType: "touch",
        }));
        photo.dispatchEvent(Object.assign(new win.Event("touchstart", { bubbles: true }), {
          touches: [{ clientX: 300, clientY: 120 }],
        }));
        photo.dispatchEvent(new win.PointerEvent("pointerup", {
          bubbles: true, clientX: 160, clientY: 120, pointerId: 1, pointerType: "touch",
        }));
        photo.dispatchEvent(Object.assign(new win.Event("touchend", { bubbles: true }), {
          changedTouches: [{ clientX: 160, clientY: 120 }],
        }));
      }
    } catch (error) {
      document.getElementById("result").textContent = "ERROR " + error.message;
      return;
    }
    if (index + 1 < sizes.length) apply(index + 1);
  }, 200);
}
frame.addEventListener("load", () => {
  frame.contentWindow.postMessage({ type: "smartframe:online-preview", config }, location.origin);
  apply(0);
});
</script>
</body>
</html>`;
}

let server;
let origin;

before(async () => {
  if (!browser) return;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/harness") {
      const config = JSON.parse(url.searchParams.get("config"));
      const sizes = JSON.parse(url.searchParams.get("sizes"));
      response.writeHead(200, { "content-type": contentTypes[".html"] });
      response.end(harness(config, sizes, url.searchParams.get("interaction")));
      return;
    }
    if (/^\/api\/photos\/test-[ab]\/image$/.test(url.pathname)) {
      response.writeHead(200, { "content-type": contentTypes[".svg"] });
      response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>',
      );
      return;
    }
    const relative = normalize(url.pathname.replace(/^\/player-dashboard\/?/, "")).replace(
      /^[/\\]+/,
      "",
    );
    const file = join(root, relative);
    if (!file.startsWith(root) || !existsSync(file)) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": contentTypes[extname(file)] || "application/octet-stream",
    });
    response.end(await readFile(file));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = "http://127.0.0.1:" + server.address().port;
});

after(async () => {
  if (server) await new Promise((done) => server.close(done));
});

function render(config, sizes, interaction = "") {
  const profile = join(tmpdir(), "smartframe-grid-" + Math.random().toString(36).slice(2));
  const url =
    origin +
    "/harness?config=" +
    encodeURIComponent(JSON.stringify(config)) +
    "&sizes=" +
    encodeURIComponent(JSON.stringify(sizes)) +
    "&interaction=" +
    encodeURIComponent(interaction);
  return new Promise((done, fail) => {
    const child = spawn(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--user-data-dir=" + profile,
        "--window-size=1400,1000",
        "--virtual-time-budget=5000",
        "--dump-dom",
        url,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const timer = setTimeout(() => child.kill(), 45000);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      const match = output.match(/<pre id="result">([\s\S]*?)<\/pre>/);
      if (!match) return fail(new Error("Nenhuma medição renderizada (exit " + code + ")"));
      if (match[1] === "pending")
        return fail(new Error("O player não concluiu a medição (exit " + code + ")"));
      if (match[1].startsWith("ERROR")) return fail(new Error(match[1]));
      done(JSON.parse(match[1]));
    });
  });
}

function span(value) {
  const match = /span (\d+)/.exec(value || "");
  return match ? Number(match[1]) : null;
}

test(
  "gesto sobre a foto troca apenas o slide sem navegar para outra página",
  { skip, timeout: 90000 },
  async () => {
    const config = {
      layout: "photo-dashboard",
      widgets: {
        photos: {
          enabled: true,
          items: [
            { id: "test-a", src: "/api/photos/test-a/image", alt: "A" },
            { id: "test-b", src: "/api/photos/test-b/image", alt: "B" },
          ],
        },
      },
      pages: [
        { id: "first", title: "Primeira", enabledWidgets: ["photos", "clock"] },
        { id: "second", title: "Segunda", enabledWidgets: ["photos", "clock"] },
      ],
    };
    const [before, after] = await render(
      config,
      [
        [1024, 600],
        [1024, 600],
      ],
      "swipePhoto",
    );
    assert.equal(before.playerState.activePageId, "first");
    assert.equal(before.activePhoto, "Foto 1");
    assert.equal(after.playerState.activePageId, "first");
    assert.equal(after.activePhoto, "Foto 2");
  },
);

test(
  "tarefas mantêm o foco ao receber a mesma configuração e ao atualizar a lista",
  { skip, timeout: 90000 },
  async () => {
    const config = {
      layout: "photo-dashboard",
      revision: "online:test",
      widgets: {
        tasks: {
          enabled: true,
          showCompleted: true,
          items: [
            { id: "agua", text: "Água", completed: false },
            { id: "pao", text: "Pão", completed: false },
          ],
        },
      },
    };
    const measurements = await render(config, Array(3).fill([1024, 600]), "refreshTasks");
    assert.deepEqual(
      measurements.map(({ task }) => task),
      [
        { focused: true, label: "○ Água", pressed: "false" },
        { focused: true, label: "○ Água", pressed: "false" },
        { focused: true, label: "✓ Água", pressed: "true" },
      ],
    );
  },
);

function closeTo(actual, expected, tolerance = 0.75, label = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label || "medida"} esperada ${expected}, recebida ${actual}`,
  );
}

function expectedMargins(item, grid, gap) {
  const half = gap / 2;
  return [
    item.y === 0 ? 0 : half,
    item.x + item.w >= grid.columns ? 0 : half,
    item.y + item.h >= grid.rows ? 0 : half,
    item.x === 0 ? 0 : half,
  ];
}

function assertPlacement(measurement, items, grid, gap) {
  for (const item of items) {
    const rendered = measurement.items[item.widgetId];
    assert.ok(rendered, `widget ${item.widgetId} renderizado`);
    assert.equal(rendered.hidden, false, `widget ${item.widgetId} visível`);
    assert.equal(Number(rendered.columnStart), item.x + 1, `${item.widgetId} coluna inicial`);
    assert.equal(
      span(rendered.columnEnd),
      item.w,
      `${item.widgetId} largura em colunas (${rendered.columnEnd})`,
    );
    assert.equal(Number(rendered.rowStart), item.y + 1, `${item.widgetId} linha inicial`);
    assert.equal(
      span(rendered.rowEnd),
      item.h,
      `${item.widgetId} altura em linhas (${rendered.rowEnd})`,
    );
    assert.deepEqual(
      rendered.margins,
      expectedMargins(item, grid, gap),
      `${item.widgetId} margens externas`,
    );
  }
}

function assertInsidePanel(measurement, items, grid) {
  const [width, height] = measurement.client;
  for (const item of items) {
    const [left, top, boxWidth, boxHeight] = measurement.items[item.widgetId].box;
    assert.ok(left >= pageEdge - 0.75, `${item.widgetId} dentro da borda esquerda`);
    assert.ok(top >= pageEdge - 0.75, `${item.widgetId} dentro da borda superior`);
    assert.ok(
      left + boxWidth <= width - pageEdge + 0.75,
      `${item.widgetId} termina dentro da borda direita`,
    );
    assert.ok(
      top + boxHeight <= height - pageEdge + 0.75,
      `${item.widgetId} termina dentro da borda inferior`,
    );
    if (item.x === 0) closeTo(left, pageEdge, 0.75, `${item.widgetId} encosta na borda esquerda`);
    if (item.y === 0) closeTo(top, pageEdge, 0.75, `${item.widgetId} encosta na borda superior`);
    if (item.x + item.w >= grid.columns)
      closeTo(left + boxWidth, width - pageEdge, 0.75, `${item.widgetId} encosta na borda direita`);
    if (item.y + item.h >= grid.rows)
      closeTo(
        top + boxHeight,
        height - pageEdge,
        0.75,
        `${item.widgetId} encosta na borda inferior`,
      );
  }
  assert.ok(
    measurement.scroll[0] <= measurement.client[0],
    `painel sem estouro horizontal (${measurement.scroll[0]} > ${measurement.client[0]})`,
  );
  assert.ok(
    measurement.scroll[1] <= measurement.client[1],
    `painel sem estouro vertical (${measurement.scroll[1]} > ${measurement.client[1]})`,
  );
}

test(
  "grade modular em paisagem vence as regras clássicas de linha mesmo com configuração retrato",
  { skip, timeout: 90000 },
  async () => {
    const [measurement] = await render(panelConfig({ orientation: "portrait" }), [[1024, 600]]);
    assert.deepEqual(measurement.size, [1024, 600]);
    assert.equal(measurement.portrait, false);
    assert.match(measurement.className, /grid-mode/);
    assert.match(measurement.className, /orientation-portrait/);
    assert.equal(measurement.columns, landscapeGrid.columns);
    assert.equal(measurement.gap, 0);
    assert.equal(measurement.padding, pageEdge);
    assertPlacement(measurement, landscapeItems, landscapeGrid, spacing);
    assertInsidePanel(measurement, landscapeItems, landscapeGrid);

    const box = (id) => measurement.items[id].box;
    closeTo(
      box("clock")[0] - (box("photos")[0] + box("photos")[2]),
      spacing,
      0.75,
      "espaçamento horizontal entre fotos e relógio",
    );
    closeTo(
      box("weather")[1] - (box("clock")[1] + box("clock")[3]),
      spacing,
      0.75,
      "espaçamento vertical entre relógio e clima",
    );
    closeTo(
      box("currencies")[0] - (box("weather")[0] + box("weather")[2]),
      spacing,
      0.75,
      "espaçamento horizontal entre clima e moedas",
    );
    closeTo(box("photos")[0], pageEdge, 0.75, "fotos encostam apenas na margem da borda");
    closeTo(
      box("clock")[0] + box("clock")[2],
      1024 - pageEdge,
      0.75,
      "relógio termina na borda direita",
    );
    closeTo(
      box("calendar")[1] + box("calendar")[3],
      600 - pageEdge,
      0.75,
      "calendário termina na borda inferior",
    );
  },
);

test(
  "grade modular em retrato usa as posições retrato e não estoura com espaçamento de 24px",
  { skip, timeout: 90000 },
  async () => {
    const [measurement] = await render(panelConfig({ orientation: "landscape" }), [[360, 640]]);
    assert.deepEqual(measurement.size, [360, 640]);
    assert.equal(measurement.portrait, true);
    assert.match(measurement.className, /grid-mode/);
    assert.doesNotMatch(measurement.className, /orientation-portrait/);
    assert.equal(measurement.columns, portraitGrid.columns);
    assert.equal(measurement.gap, 0);
    assertPlacement(measurement, portraitItems, portraitGrid, spacing);
    assertInsidePanel(measurement, portraitItems, portraitGrid);

    const box = (id) => measurement.items[id].box;
    closeTo(
      box("clock")[1] - (box("photos")[1] + box("photos")[3]),
      spacing,
      0.75,
      "espaçamento vertical entre fotos e relógio",
    );
    closeTo(
      box("weather")[1] - (box("clock")[1] + box("clock")[3]),
      spacing,
      0.75,
      "espaçamento vertical entre relógio e clima",
    );
    closeTo(
      box("calendar")[0] - (box("clock")[0] + box("clock")[2]),
      spacing,
      0.75,
      "espaçamento horizontal entre relógio e calendário",
    );
  },
);

test(
  "giro do viewport troca grade e posições sem recarregar o player",
  { skip, timeout: 90000 },
  async () => {
    const [landscape, portrait] = await render(panelConfig(), [
      [1024, 600],
      [360, 640],
    ]);
    assert.equal(landscape.portrait, false);
    assert.equal(landscape.columns, landscapeGrid.columns);
    assertPlacement(landscape, landscapeItems, landscapeGrid, spacing);
    assert.equal(portrait.portrait, true);
    assert.equal(portrait.columns, portraitGrid.columns);
    assertPlacement(portrait, portraitItems, portraitGrid, spacing);
    assertInsidePanel(portrait, portraitItems, portraitGrid);
  },
);

test(
  "espaçamento zero mantém widgets contíguos e widgets ocultos não afetam as posições",
  { skip, timeout: 90000 },
  async () => {
    const [measurement] = await render(panelConfig({ widgetSpacing: 0, photos: false }), [
      [1024, 600],
    ]);
    const rendered = Object.values(measurement.items).filter((item) => !item.hidden);
    assert.ok(rendered.length > 0, "há widgets visíveis");
    for (const item of rendered) {
      assert.deepEqual(item.margins, [0, 0, 0, 0], "sem margens extras com espaçamento zero");
    }
    assert.equal(measurement.items.photos.hidden, true);
    assertPlacement(
      measurement,
      landscapeItems.filter((item) => item.widgetId !== "photos"),
      landscapeGrid,
      0,
    );
    const box = (id) => measurement.items[id].box;
    closeTo(
      box("weather")[1] - (box("clock")[1] + box("clock")[3]),
      0,
      0.75,
      "widgets contíguos sem espaçamento",
    );
    closeTo(
      box("clock")[0],
      pageEdge + ((measurement.client[0] - 2 * pageEdge) * 14) / landscapeGrid.columns,
      0.75,
      "relógio mantém a coluna configurada com as fotos desativadas",
    );
    assert.ok(measurement.scroll[0] <= measurement.client[0]);
    assert.ok(measurement.scroll[1] <= measurement.client[1]);
  },
);

test(
  "modo clássico preserva proporções, espaçamento e spans por tamanho de cartão",
  { skip, timeout: 90000 },
  async () => {
    const config = {
      layout: "photo-dashboard",
      orientation: "landscape",
      appearance: { widgetSpacing: 8, pageEdgePadding: 10 },
      gridLayout: { enabled: false, landscape: [], portrait: [] },
      widgets: { photos: { enabled: true, items: [] } },
    };
    const [measurement] = await render(config, [[1024, 600]]);
    assert.doesNotMatch(measurement.className, /grid-mode/);
    assert.equal(measurement.columns, 2);
    assert.equal(measurement.gap, 8);
    assert.equal(measurement.padding, 10);
    assert.equal(span(measurement.items.clock.rowEnd), 18);
    assert.equal(span(measurement.items.weather.rowEnd), 16);
    assert.equal(span(measurement.items.currencies.rowEnd), 19);
    assert.equal(span(measurement.items.calendar.rowEnd), 47);
    assert.deepEqual(measurement.items.clock.margins, [0, 0, 8, 0]);
    assert.deepEqual(measurement.items.calendar.margins, [0, 0, 0, 0]);
    const photoWidth = measurement.items.photos.box[2];
    const widgetWidth = measurement.items.clock.box[2];
    closeTo(widgetWidth / (photoWidth + widgetWidth), 0.38, 0.01, "proporção dos widgets");
    assert.ok(measurement.scroll[0] <= measurement.client[0]);
    assert.ok(measurement.scroll[1] <= measurement.client[1]);
  },
);

test(
  "preenchimento interno configurado vale nos quatro lados do cartão de clima",
  { skip, timeout: 90000 },
  async () => {
    const [measurement] = await render(panelConfig({ innerPadding: 14, widgetInnerPadding: 20 }), [
      [1024, 600],
    ]);
    assert.deepEqual(
      measurement.items.weather.padding,
      [20, 20, 20, 20],
      "clima usa o preenchimento específico em todos os lados",
    );
    assert.deepEqual(
      measurement.items.clock.padding,
      [14, 14, 14, 14],
      "demais widgets usam o preenchimento global",
    );
  },
);
