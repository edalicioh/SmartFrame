(function (app) {
  "use strict";
  var list = document.getElementById("currency-list"),
    config,
    timer,
    rates = {},
    index = 0,
    paused = false;
  var symbolsText = { USD: "$", EUR: "€", BTC: "₿" };
  var formatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  function render() {
    list.textContent = "";
    if (!config || !config.enabled) return;
    var count = list.clientWidth < 260 ? 1 : 2,
      symbols = config.symbols;
    for (var i = 0; i < Math.min(count, symbols.length); i++) {
      var code = symbols[(index + i) % symbols.length],
        rate = rates[code],
        item = document.createElement("div");
      item.className = "currency-item";
      var label = document.createElement("div"),
        value = document.createElement("div"),
        change = document.createElement("div");
      label.className = "currency-code";
      label.textContent = symbolsText[code] + " " + code + "/BRL";
      value.className = "currency-value";
      value.textContent = rate ? formatter.format(rate.value) : "—";
      change.className = "currency-change";
      change.textContent = !rate
        ? "Sem dados"
        : rate.stale
          ? "Dados anteriores"
          : rate.referenceDate
            ? "BCE · " + rate.referenceDate.split("-").reverse().join("/")
            : "Coinbase";
      change.style.color = rate && rate.stale ? "#fbbf24" : "";
      item.title = rate
        ? rate.source + " · consultado em " + new Date(rate.updatedAt).toLocaleString("pt-BR")
        : "Aguardando atualização do servidor";
      item.appendChild(label);
      item.appendChild(value);
      item.appendChild(change);
      list.appendChild(item);
    }
    document.getElementById("currencies-status").textContent = "Atualiza a cada 30 min";
  }
  function schedule() {
    clearTimeout(timer);
    if (!paused && config && config.enabled && config.symbols.length > 1)
      timer = setTimeout(function () {
        index = (index + 1) % config.symbols.length;
        render();
        schedule();
      }, config.intervalSeconds * 1000);
  }
  window.addEventListener("resize", render);
  app.currencies = {
    update: function (value) {
      config = value;
      index = 0;
      render();
      schedule();
    },
    relayout: render,
    setData: function (value) {
      var next = {};
      ["USD", "EUR", "BTC"].forEach(function (code) {
        var rate = value && value[code];
        if (
          rate &&
          typeof rate.value === "number" &&
          isFinite(rate.value) &&
          rate.value > 0 &&
          typeof rate.updatedAt === "string" &&
          isFinite(Date.parse(rate.updatedAt))
        )
          next[code] = rate;
      });
      if (JSON.stringify(rates) !== JSON.stringify(next)) {
        rates = next;
        render();
      }
    },
    pause: function () {
      paused = true;
      clearTimeout(timer);
    },
    resume: function () {
      paused = false;
      render();
      schedule();
    },
  };
})(window.SmartFrame);
