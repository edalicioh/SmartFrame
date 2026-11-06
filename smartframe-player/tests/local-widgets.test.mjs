import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/local-widgets.js", import.meta.url), "utf8");

function setup(type, time = "2027-03-01T02:00:00Z") {
  const app = {};
  const timers = new Map();
  let nextId = 0;
  let current = Date.parse(time);
  const document = {
    createElement: () => ({
      textContent: "",
      className: "",
      addEventListener(name, callback) {
        this[name] = callback;
      },
    }),
  };
  const root = {
    ownerDocument: document,
    children: [],
    set textContent(value) {
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
    },
  };
  runInNewContext(source, { window: { SmartFrame: app }, Intl, Date, setTimeout, clearTimeout });
  const widget = app.localWidgets.create(type, root, {
    timezone: "America/Sao_Paulo",
    now: () => current,
    setTimeout: (callback) => {
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const texts = () => root.children.map((child) => child.textContent);
  const tick = () => {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };
  return {
    widget,
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
      { text: "Feito", completed: true },
      { text: "Pendente", completed: false },
    ],
    showCompleted: false,
  });
  assert.deepEqual(texts(), ["Tarefas", "○ Pendente"]);
  assert.equal(timers.size, 0);
});
