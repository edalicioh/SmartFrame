import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/local-widgets.js", import.meta.url), "utf8");

function setup(type, time = "2027-03-01T02:00:00Z", options = {}) {
  const app = {};
  const timers = new Map();
  let nextId = 0;
  let current = Date.parse(time);
  const createNode = () => ({
    textContent: "",
    className: "",
    children: [],
    get nextSibling() {
      const siblings = this.parentNode?.children;
      return siblings?.[siblings.indexOf(this) + 1] ?? null;
    },
    attributes: {},
    style: { setProperty() {} },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(name, callback) {
      this[name] = callback;
    },
  });
  const document = {
    createElement: () => createNode(),
  };
  const root = {
    ownerDocument: document,
    children: [],
    set textContent(value) {
      this.children.forEach((child) => {
        child.parentNode = null;
      });
      this.children = [];
    },
    appendChild(child) {
      return this.insertBefore(child, null);
    },
    insertBefore(child, next) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const at = next === null ? this.children.length : this.children.indexOf(next);
      assert.notEqual(at, -1);
      this.children.splice(at, 0, child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child);
      assert.notEqual(at, -1);
      this.children.splice(at, 1);
      child.parentNode = null;
      return child;
    },
  };
  runInNewContext(source, { window: { SmartFrame: app }, Intl, Date, setTimeout, clearTimeout });
  const context = {
    timezone: "America/Sao_Paulo",
    now: () => current,
    setTimeout: (callback, delay) => {
      const id = ++nextId;
      callback.delay = delay;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    ...options,
  };
  const widget = app.localWidgets.create(type, root, context);
  const texts = () => root.children.map((child) => child.textContent);
  const tick = () => {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };
  return {
    widget,
    context,
    timers,
    texts,
    tick,
    root,
    advance: (ms) => {
      current += ms;
    },
  };
}

test("recados alternam com texto literal e param ao descartar", () => {
  const { widget, timers, texts, tick } = setup("notes");
  widget.update({
    title: "Casa",
    messages: [{ text: "<script>" }, { text: "Outro" }],
    intervalSeconds: 10,
  });
  assert.deepEqual(texts(), ["Casa", "<script>"]);
  assert.equal(timers.size, 1);
  tick();
  assert.deepEqual(texts(), ["Casa", "Outro"]);
  widget.pause();
  assert.equal(timers.size, 0);
  widget.resume();
  assert.equal(timers.size, 1);
  widget.destroy();
  widget.resume();
  assert.equal(timers.size, 0);
  assert.deepEqual(texts(), []);
});

test("pomodoro inicia, pausa, retoma e passa para a pausa sem reiniciar automaticamente", () => {
  const { widget, timers, texts, tick, root, advance } = setup("pomodoro");
  widget.update({ title: "Pomodoro", workMinutes: 1, breakMinutes: 1 });
  assert.deepEqual(texts(), ["Pomodoro", "Foco", "01:00", "Iniciar", "Reiniciar"]);
  root.children[3].click();
  advance(15000);
  tick();
  assert.equal(texts()[2], "00:45");
  root.children[3].click();
  assert.equal(timers.size, 0);
  advance(90000);
  root.children[3].click();
  advance(45000);
  tick();
  assert.deepEqual(texts(), ["Pomodoro", "Pausa", "01:00", "Iniciar", "Reiniciar"]);
  assert.equal(timers.size, 0);
  root.children[4].click();
  assert.equal(texts()[1], "Foco");
  widget.destroy();
});

test("pomodoro mantém os mesmos controles entre ticks, atualizações e retomadas", () => {
  const { widget, root, advance, tick, texts } = setup("pomodoro");
  const settings = { title: "Pomodoro", workMinutes: 1, breakMinutes: 1 };
  widget.update(settings);
  const start = root.children[3];
  const reset = root.children[4];
  start.click();
  for (let i = 0; i < 4; i++) {
    advance(250);
    tick();
    assert.equal(root.children[3], start);
    assert.equal(root.children[4], reset);
  }
  assert.equal(texts()[2], "00:59");
  widget.pause();
  widget.resume();
  widget.update({ ...settings, title: "Estudar" });
  assert.equal(root.children[3], start);
  assert.equal(root.children[4], reset);
  assert.equal(texts()[0], "Estudar");
  start.click();
  assert.equal(texts()[3], "Iniciar");
  reset.click();
  assert.equal(texts()[2], "01:00");
  widget.destroy();
});

test("contagem de data respeita a data local e não o dia UTC", () => {
  const { widget, texts } = setup("countdown");
  widget.update({
    title: "Viagem",
    target: { kind: "date", date: "2027-03-01" },
    display: "days",
    completedText: "Fim",
  });
  assert.deepEqual(texts(), ["Viagem", "1 dia"]);
  widget.update({
    title: "Evento",
    target: { kind: "date", date: "2027-02-28" },
    display: "days",
    completedText: "Fim",
  });
  assert.deepEqual(texts(), ["Evento", "Hoje!"]);
});

test("datas com horário exibem tempo restante e evento concluído", () => {
  const { widget, texts } = setup("countdown");
  widget.update({
    title: "Viagem",
    target: { kind: "datetime", dateTime: "2027-03-01T04:30:00Z" },
    display: "detailed",
    completedText: "Fim",
  });
  assert.deepEqual(texts(), ["Viagem", "0d 2h 30min"]);
  widget.update({
    title: "Viagem",
    target: { kind: "datetime", dateTime: "2027-03-01T01:00:00Z" },
    display: "days",
    completedText: "Fim",
  });
  assert.deepEqual(texts(), ["Viagem", "Fim"]);
});

test("aniversários consideram 29 de fevereiro em 28 em anos comuns", () => {
  const { widget, texts } = setup("birthdays");
  widget.update({
    title: "Aniversários",
    people: [
      { name: "Março", day: 1, month: 3 },
      { name: "Fevereiro", day: 29, month: 2 },
    ],
    displayCount: 2,
  });
  assert.deepEqual(texts(), ["Aniversários", "Fevereiro · Hoje!", "Março · em 1 dia"]);
});

test("tarefas ocultam concluídas e não mantêm timer ativo", () => {
  const { widget, texts, timers } = setup("tasks");
  widget.update({
    title: "Tarefas",
    items: [
      { id: "1", text: "Feito", completed: true },
      { id: "2", text: "Pendente", completed: false },
    ],
    showCompleted: false,
    interactive: false,
  });
  assert.deepEqual(texts(), ["Tarefas", "○ Pendente"]);
  assert.equal(timers.size, 0);
});

test("tarefas interativas alternam estado no clique e aceitam rollback em falha", () => {
  const calls = [];
  let rollbackFn = null;
  const { widget, root, texts } = setup("tasks", undefined, {
    onToggleTask: (id, completed, rollback) => {
      calls.push({ id, completed });
      rollbackFn = rollback;
    },
  });
  widget.update({
    title: "Casa",
    items: [{ id: "t1", text: "Água", completed: false }],
    showCompleted: true,
    interactive: true,
  });
  assert.deepEqual(texts(), ["Casa", "○ Água"]);
  assert.equal(root.children[1].attributes["aria-pressed"], "false");
  root.children[1].click();
  assert.deepEqual(calls, [{ id: "t1", completed: true }]);
  assert.deepEqual(texts(), ["Casa", "✓ Água"]);
  rollbackFn();
  assert.deepEqual(texts(), ["Casa", "○ Água"]);
});

test("tarefas permanecem somente leitura quando o contexto não oferece transporte", () => {
  const { widget, root, texts } = setup("tasks", undefined, { canToggleTasks: false });
  const items = [{ id: "t1", text: "Água", completed: false }];
  widget.update({ title: "Casa", items, showCompleted: true, interactive: true });
  assert.deepEqual(texts(), ["Casa", "○ Água"]);
  assert.equal(root.children[1].click, undefined);
  assert.equal(items[0].completed, false);
  widget.destroy();
});

test("tarefas bloqueiam cliques repetidos até a resposta, sem modificar a configuração", () => {
  const requests = [];
  const h = setup("tasks", undefined, {
    onToggleTask: (id, completed, rollback, settle) =>
      requests.push({ id, completed, rollback, settle }),
  });
  const settings = {
    title: "Casa",
    items: [{ id: "t1", text: "Água", completed: false }],
    showCompleted: true,
    interactive: true,
  };
  h.widget.update(settings);
  const oldButton = h.root.children[1];
  oldButton.click();
  h.root.children[1].click();
  oldButton.click();
  assert.equal(requests.length, 1);
  assert.equal(oldButton.attributes["aria-disabled"], "true");
  assert.equal(settings.items[0].completed, false);
  // Polls do not unlock or discard an optimistic operation in flight.
  h.widget.update(structuredClone(settings));
  assert.equal(h.root.children[1], oldButton);
  assert.equal(oldButton.attributes["aria-disabled"], "true");
  assert.deepEqual(h.texts(), ["Casa", "✓ Água"]);
  requests[0].rollback();
  assert.equal(oldButton.attributes["aria-disabled"], "false");
  assert.deepEqual(h.texts(), ["Casa", "○ Água"]);
  h.root.children[1].click();
  requests[1].rollback();
  assert.deepEqual(h.texts(), ["Casa", "○ Água"]);
  requests[0].settle(true); // An obsolete reply cannot override the newer result.
  assert.deepEqual(h.texts(), ["Casa", "○ Água"]);
  h.widget.destroy();
});

test("uma resposta bem-sucedida libera a tarefa para desmarcar e reconciliar com o polling", () => {
  const requests = [];
  const h = setup("tasks", undefined, {
    onToggleTask: (_id, _completed, rollback, settle) => requests.push({ rollback, settle }),
  });
  const settings = {
    title: "Casa",
    items: [{ id: "t1", text: "Água", completed: false }],
    showCompleted: true,
    interactive: true,
  };
  h.widget.update(settings);
  h.root.children[1].click();
  requests[0].settle(true);
  assert.equal(h.root.children[1].attributes["aria-disabled"], "false");
  assert.deepEqual(h.texts(), ["Casa", "✓ Água"]);
  h.root.children[1].click();
  requests[1].settle(true);
  assert.deepEqual(h.texts(), ["Casa", "○ Água"]);
  h.widget.update({ ...settings, items: [{ ...settings.items[0], completed: true }] });
  assert.deepEqual(h.texts(), ["Casa", "✓ Água"]);
  h.widget.destroy();
});

test("respostas antigas não alteram uma nova publicação com o mesmo ID de tarefa", () => {
  const requests = [];
  const h = setup("tasks", undefined, {
    revision: "online:first",
    onToggleTask: (_id, _completed, rollback, settle) => requests.push({ rollback, settle }),
  });
  const settings = {
    title: "Casa",
    items: [{ id: "t1", text: "Água", completed: false }],
    showCompleted: true,
    interactive: true,
  };
  h.widget.update(settings);
  const firstButton = h.root.children[1];
  firstButton.click();
  h.context.revision = "online:second";
  h.widget.update(structuredClone(settings));
  assert.deepEqual(h.texts(), ["Casa", "○ Água"]);
  assert.equal(h.root.children[1].attributes["aria-disabled"], "false");
  firstButton.click();
  assert.equal(requests.length, 1);
  requests[0].settle(true);
  requests[0].rollback();
  assert.deepEqual(h.texts(), ["Casa", "○ Água"]);
  h.widget.destroy();
});

test("RSS mantém o prazo de rotação entre atualizações de dados", () => {
  const h = setup("rss");
  h.widget.update({
    title: "RSS",
    feedUrl: "https://feeds.example.com/rss.xml",
    maxItems: 5,
    rotateSeconds: 120,
  });
  const data = { title: "Feed", items: [{ title: "Primeira" }, { title: "Segunda" }] };
  h.widget.setData(data);
  assert.equal([...h.timers.values()][0].delay, 120000);
  h.advance(60000);
  h.widget.setData({ ...data, title: "Feed atualizado" });
  assert.equal([...h.timers.values()][0].delay, 60000);
  h.advance(60000);
  h.tick();
  assert.equal(h.root.children[2].children[0].textContent, "Segunda");
  assert.equal([...h.timers.values()][0].delay, 120000);
  h.widget.destroy();
});

test("novos widgets (system, worldClock, rss, devMonitor) renderizam dados sanitizados e timers", () => {
  const sys = setup("system");
  sys.widget.update({
    title: "Servidor",
    showCpu: true,
    showMemory: true,
    showDisk: true,
    showUptime: true,
  });
  assert.deepEqual(sys.texts(), ["Servidor", "Aguardando métricas do servidor…"]);
  sys.widget.setData({
    cpuUsagePercent: 28,
    cpuCores: 4,
    memoryUsedPercent: 52,
    memoryUsedGb: 4.2,
    memoryTotalGb: 8,
    diskUsedPercent: 61,
    uptimeSeconds: 3660,
  });
  assert.equal(sys.root.children[0].textContent, "Servidor");
  assert.equal(sys.root.children[1].children.length, 4);
  assert.equal(sys.timers.size, 0);

  const wc = setup("worldClock", "2026-11-16T22:00:00Z");
  wc.widget.update({
    title: "Fuso",
    format: "24h",
    zones: [{ id: "z1", label: "Tóquio", timezone: "Asia/Tokyo" }],
  });
  assert.equal(wc.root.children[0].textContent, "Fuso");
  assert.equal(wc.root.children[1].children[0].children[0].children[0].textContent, "Tóquio");
  assert.equal(wc.root.children[1].children[0].children[0].children[1].textContent, "+1d");
  assert.equal(wc.timers.size, 1);
  wc.widget.destroy();

  const rss = setup("rss");
  rss.widget.update({
    title: "RSS",
    feedUrl: "https://feeds.example.com/rss.xml",
    maxItems: 5,
    rotateSeconds: 10,
  });
  rss.widget.setData({
    title: "Jornal",
    items: [{ title: "Manchete 1" }, { title: "Manchete 2" }],
  });
  assert.equal(rss.root.children[1].textContent, "Jornal");
  assert.equal(rss.root.children[2].children[0].textContent, "Manchete 1");
  assert.equal(rss.timers.size, 1);
  rss.tick();
  assert.equal(rss.root.children[2].children[0].textContent, "Manchete 2");
  rss.widget.destroy();

  const dev = setup("devMonitor");
  dev.widget.update({
    title: "Dev/IA",
    showServerMetrics: true,
    items: [{ id: "d1", name: "Worker IA", category: "ai", status: "running", detail: "Ativo" }],
  });
  dev.widget.setData({
    nodeVersion: "v24.0.0",
    rssMemoryMb: 120.5,
    activeDevicesCount: 2,
    readyPhotosCount: 9,
  });
  assert.equal(dev.root.children[0].textContent, "Dev/IA");
  assert.equal(dev.root.children[1].children[0].textContent, "Node v24.0.0");
  assert.equal(dev.root.children[2].children[0].children[1].textContent, "Em execução");
});
