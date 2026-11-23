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

  // Feeds recebidos via /api/push atualizam cartões vinculados e anexam novos feeds sanitizados.
  const devPush = setup("devMonitor");
  devPush.widget.update({
    title: "Monitoramento",
    showServerMetrics: false,
    items: [
      {
        id: "ci-local",
        name: "Pipeline CI",
        category: "ci",
        status: "idle",
        detail: "Sem execução",
        pushKey: "ci-main",
      },
    ],
  });
  devPush.widget.setData({
    pushedFeeds: [
      {
        key: "ci-main",
        name: "Ignorado",
        category: "ci",
        status: "failing",
        detail: "<script>3 falhas</script>",
        value: null,
      },
      {
        key: "coffee",
        name: "Cafeteira",
        category: "service",
        status: "healthy",
        detail: "",
        value: "Pronto",
      },
    ],
  });
  const rows = devPush.root.children[1].children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].children[0].textContent, "[CI] Pipeline CI");
  assert.equal(rows[0].children[0].children[1].textContent, "<script>3 falhas</script>");
  assert.equal(rows[0].children[1].textContent, "Falha");
  assert.equal(rows[1].children[0].children[0].textContent, "[SRV] Cafeteira");
  assert.equal(rows[1].children[0].children[1].textContent, "Pronto");

  // detail null e status desconhecido usam fallback seguro sem exibir "null".
  devPush.widget.setData({
    pushedFeeds: [
      {
        key: "ci-main",
        name: "Pipeline CI",
        category: "ci",
        status: "unknown-state",
        detail: null,
        value: null,
      },
    ],
  });
  const fallbackRow = devPush.root.children[1].children[0];
  assert.equal(fallbackRow.children[0].children[1].textContent, "Sem execução");
  assert.equal(fallbackRow.children[1].className, "dev-status-badge dev-status-healthy");
  devPush.widget.destroy();
});

test("controlDeck exibe estado indisponível e prévia sem valores fictícios", () => {
  const h = setup("controlDeck", undefined, { canExecuteControlDeck: false });
  h.widget.update({
    title: "Mesa de Controle",
    columns: 2,
    tiles: [
      { id: "t1", bindingId: "b-vol", label: "Volume", icon: "volume" },
      { id: "t2", bindingId: "b-term", label: "<script>Terminal</script>", icon: "terminal" },
    ],
  });

  const header = h.root.children[0];
  const notice = h.root.children[1];
  const grid = h.root.children[3];
  assert.equal(header.children[0].textContent, "Mesa de Controle");
  assert.equal(header.children[1].textContent, "Host indisponível");
  assert.equal(notice.hidden, false);
  assert.equal(grid.children.length, 2);
  assert.equal(grid.children[0].disabled, true);
  assert.equal(grid.children[0].children[1].textContent, "Indisponível");
  assert.equal(grid.children[1].children[0].children[1].textContent, "<script>Terminal</script>");

  // Mesmo recebendo bindings com valores reais, sliders em host indisponível mostram "—" e ficam disabled.
  h.widget.setData({
    available: false,
    bindings: {
      "b-vol": {
        bindingId: "b-vol",
        label: "Volume",
        kind: "volume",
        action: "set_level",
        idempotent: true,
        available: false,
        level: null,
        muted: null,
        leaseSeconds: null,
      },
      "b-term": {
        bindingId: "b-term",
        label: "Terminal",
        kind: "shortcut",
        action: "launch",
        idempotent: false,
        available: false,
        level: null,
        muted: null,
        leaseSeconds: null,
      },
    },
  });
  const updatedHeader = h.root.children[0];
  const updatedGrid = h.root.children[3];
  assert.equal(updatedHeader.children[1].textContent, "Host indisponível");
  assert.equal(updatedGrid.children[0].children[0].children[2].textContent, "—");
  assert.equal(updatedGrid.children[0].children[1].disabled, true);
  assert.equal(updatedGrid.children[1].disabled, true);
  h.widget.destroy();
});

test("controlDeck trava clique pendente e exibe feedback para unknown sem reenvio", () => {
  const sent = [];
  const h = setup("controlDeck", undefined, {
    canExecuteControlDeck: true,
    onControlDeckExecute: (payload, onDone) => sent.push({ payload, onDone }),
  });
  h.widget.update({
    title: "Atalhos",
    columns: 3,
    tiles: [{ id: "t-short", bindingId: "b-short", label: "Abrir App", icon: "bolt" }],
  });
  h.widget.setData({
    available: true,
    bindings: {
      "b-short": {
        bindingId: "b-short",
        label: "Abrir App",
        kind: "shortcut",
        action: "launch",
        idempotent: false,
        available: true,
        level: null,
        muted: null,
        leaseSeconds: null,
      },
    },
  });

  const feedback = h.root.children[2];
  const btn = h.root.children[3].children[0];
  assert.equal(h.root.children[0].children[1].textContent, "Conectado");
  assert.equal(h.root.children[1].hidden, true);
  assert.equal(btn.disabled, false);

  // Primeiro clique dispara; segundo clique enquanto pendente é bloqueado.
  btn.click();
  btn.click();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.command, "trigger");
  assert.equal(sent[0].payload.idempotent, false);
  assert.equal(btn.attributes["aria-disabled"], "true");

  sent[0].onDone({
    status: "unknown",
    idempotent: false,
    message: "Sem confirmação do servidor; resultado desconhecido (não reenviado).",
  });
  assert.equal(sent.length, 1);
  assert.equal(btn.attributes["aria-disabled"], "false");
  assert.equal(feedback.hidden, false);
  assert.match(feedback.textContent, /Resultado desconhecido — não reenviado/);

  // Próximo clique após desbloqueio funciona normalmente e trata unavailable.
  btn.click();
  assert.equal(sent.length, 2);
  sent[1].onDone({ status: "unavailable", idempotent: false, message: "Agente offline." });
  assert.equal(feedback.textContent, "Agente offline.");
  h.widget.destroy();
});

test("controlDeck slider exibe nível real, envia set_level e não reinventa valor ao falhar", () => {
  const sent = [];
  const h = setup("controlDeck", undefined, {
    canExecuteControlDeck: true,
    onControlDeckExecute: (payload, onDone) => sent.push({ payload, onDone }),
  });
  h.widget.update({
    title: "Áudio & Tela",
    columns: 2,
    tiles: [
      { id: "t-vol", bindingId: "b-vol", label: "Volume", icon: "volume" },
      { id: "t-br", bindingId: "b-br", label: "Brilho", icon: "sun" },
    ],
  });
  h.widget.setData({
    available: true,
    bindings: {
      "b-vol": {
        bindingId: "b-vol",
        label: "Volume",
        kind: "volume",
        action: "set_level",
        idempotent: true,
        available: true,
        level: 42,
        muted: false,
        leaseSeconds: null,
      },
      "b-br": {
        bindingId: "b-br",
        label: "Brilho",
        kind: "brightness",
        action: "set_level",
        idempotent: true,
        available: false,
        level: null,
        muted: null,
        leaseSeconds: null,
      },
    },
  });

  const grid = h.root.children[3];
  const volWrap = grid.children[0];
  const volValue = volWrap.children[0].children[2];
  const volSlider = volWrap.children[1];
  const brWrap = grid.children[1];
  const brValue = brWrap.children[0].children[2];
  const brSlider = brWrap.children[1];

  assert.equal(volValue.textContent, "42%");
  assert.equal(volSlider.value, "42");
  assert.equal(volSlider.disabled, false);
  assert.equal(brValue.textContent, "—");
  assert.equal(brSlider.disabled, true);

  volSlider.value = "78";
  volSlider.input();
  assert.equal(volValue.textContent, "78%");
  volSlider.change();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.bindingId, "b-vol");
  assert.equal(sent[0].payload.command, "set_level");
  assert.equal(sent[0].payload.value, 78);
  assert.equal(sent[0].payload.idempotent, true);

  sent[0].onDone({
    status: "ok",
    idempotent: true,
    message: "Volume ajustado.",
    state: { level: 78 },
  });
  assert.equal(volValue.textContent, "78%");
  assert.equal(volSlider.value, "78");

  // Em falha, retorna ao valor real conhecido do servidor.
  volSlider.value = "10";
  volSlider.change();
  sent[1].onDone({ status: "unavailable", idempotent: true, message: "Host desconectado." });
  assert.equal(volValue.textContent, "42%");
  h.widget.destroy();
});

test("controlDeck Push-to-Talk adquire, renova na metade do lease e libera em pointerup, pause e destroy", () => {
  const sent = [];
  const h = setup("controlDeck", undefined, {
    canExecuteControlDeck: true,
    onControlDeckExecute: (payload, onDone) => sent.push({ payload, onDone }),
  });
  h.widget.update({
    title: "Microfone",
    columns: 2,
    tiles: [{ id: "t-ptt", bindingId: "b-ptt", label: "Falar", icon: "mic" }],
  });
  h.widget.setData({
    available: true,
    bindings: {
      "b-ptt": {
        bindingId: "b-ptt",
        label: "Falar",
        kind: "mic_ptt",
        action: "hold_unmute",
        idempotent: true,
        available: true,
        level: null,
        muted: true,
        leaseSeconds: 10,
      },
    },
  });

  const pttBtn = h.root.children[3].children[0];
  pttBtn.pointerdown({ button: 0, stopPropagation() {} });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.command, "ptt_acquire");
  assert.equal(sent[0].payload.leaseSeconds, 10);
  assert.equal(sent[0].payload.leaseRequestId, sent[0].payload.executionId);

  sent[0].onDone({
    status: "ok",
    idempotent: true,
    message: "PTT ativo",
    lease: { leaseId: "lease-1", expiresAt: "2027-03-01T02:00:10Z", leaseSeconds: 10 },
  });
  assert.equal(pttBtn.attributes["aria-pressed"], "true");
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 5000);

  // Renovação automática na metade do lease.
  h.tick();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].payload.command, "ptt_renew");
  assert.equal(sent[1].payload.leaseId, "lease-1");
  sent[1].onDone({
    status: "ok",
    idempotent: true,
    lease: { leaseId: "lease-1", expiresAt: "2027-03-01T02:00:15Z", leaseSeconds: 10 },
  });
  assert.equal(h.timers.size, 1);

  // Soltar envia ptt_release imediato e limpa timer de renovação.
  pttBtn.pointerup({ stopPropagation() {} });
  assert.equal(h.timers.size, 0);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].payload.command, "ptt_release");
  assert.equal(sent[2].payload.leaseId, "lease-1");
  assert.equal(sent[2].payload.leaseRequestId, sent[0].payload.leaseRequestId);
  assert.equal(pttBtn.attributes["aria-pressed"], "false");

  // pause() com PTT ativo libera imediatamente.
  pttBtn.pointerdown({ button: 0, stopPropagation() {} });
  sent[3].onDone({
    status: "ok",
    idempotent: true,
    lease: { leaseId: "lease-2", expiresAt: "2027-03-01T02:00:25Z", leaseSeconds: 10 },
  });
  assert.equal(h.timers.size, 1);
  h.widget.pause();
  assert.equal(h.timers.size, 0);
  assert.equal(sent.at(-1).payload.command, "ptt_release");
  assert.equal(sent.at(-1).payload.leaseId, "lease-2");

  // destroy() com PTT ativo (mesmo antes do reply de acquire) libera ao concluir ou imediatamente.
  h.widget.resume();
  const pttAfterResume = h.root.children[3].children[0];
  pttAfterResume.pointerdown({ button: 0, stopPropagation() {} });
  const pendingAcquire = sent.at(-1);
  h.widget.destroy();
  assert.equal(sent.at(-1).payload.command, "ptt_release");
  pendingAcquire.onDone({
    status: "ok",
    idempotent: true,
    lease: { leaseId: "lease-3", expiresAt: "2027-03-01T02:00:35Z", leaseSeconds: 10 },
  });
  assert.equal(sent.at(-1).payload.command, "ptt_release");
  assert.equal(sent.at(-1).payload.leaseId, "lease-3");
  assert.equal(sent.at(-1).payload.leaseRequestId, pendingAcquire.payload.leaseRequestId);
});

test("controlDeck habilita slider de app_volume, bloqueia input durante pending e libera PTT em reconstrução de structureKey", () => {
  const sent = [];
  const h = setup("controlDeck", undefined, {
    canExecuteControlDeck: true,
    onControlDeckExecute: (payload, onDone) => sent.push({ payload, onDone }),
  });
  h.widget.update({
    title: "Deck",
    columns: 2,
    tiles: [
      { id: "t-app", bindingId: "b-app", label: "Spotify", icon: "app" },
      { id: "t-ptt", bindingId: "b-ptt", label: "Falar", icon: "mic" },
    ],
  });
  h.widget.setData({
    available: true,
    bindings: {
      "b-app": {
        bindingId: "b-app",
        label: "Spotify",
        kind: "app_volume",
        action: "set_level",
        idempotent: true,
        available: true,
        level: null,
        muted: null,
        leaseSeconds: null,
      },
      "b-ptt": {
        bindingId: "b-ptt",
        label: "Falar",
        kind: "mic_ptt",
        action: "hold_unmute",
        idempotent: true,
        available: true,
        level: null,
        muted: true,
        leaseSeconds: 6,
      },
    },
  });

  const grid = h.root.children[3];
  const appSlider = grid.children[0].children[1];
  const appVal = grid.children[0].children[0].children[2];
  assert.equal(appSlider.disabled, false);
  assert.equal(appVal.textContent, "—");

  appSlider.value = "65";
  appSlider.input();
  assert.equal(appVal.textContent, "65%");
  appSlider.change();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.command, "set_level");

  // Enquanto pending === true, input e change subsequentes são ignorados.
  appSlider.value = "20";
  appSlider.input();
  assert.equal(appSlider.value, "50");
  appSlider.change();
  assert.equal(sent.length, 1);
  sent[0].onDone({ status: "ok", idempotent: true, state: { level: 65 } });
  assert.equal(appSlider.value, "65");

  // Adquirir PTT e mudar structureKey antes de soltar libera o lease imediatamente.
  const pttBtn = grid.children[1];
  pttBtn.pointerdown({ button: 0, stopPropagation() {} });
  sent[1].onDone({
    status: "ok",
    idempotent: true,
    lease: { leaseId: "lease-struct-1", expiresAt: "2027-03-01T02:01:00Z", leaseSeconds: 6 },
  });
  h.widget.update({
    title: "Deck",
    columns: 2,
    tiles: [{ id: "t-ptt", bindingId: "b-ptt", label: "Falar", icon: "mic" }],
  });
  assert.equal(sent.at(-1).payload.command, "ptt_release");
  assert.equal(sent.at(-1).payload.leaseId, "lease-struct-1");
  h.widget.destroy();
});
