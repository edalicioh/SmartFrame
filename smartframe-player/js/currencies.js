(function (app) {
  "use strict";
  var list = document.getElementById("currency-list"),
    config,
    timer,
    rates = {},
    index = 0,
    paused = false;
  function visibleCount() {
    return Math.min(
      config.displayCount || 2,
      Math.max(1, Math.floor((list.clientWidth + 8) / 198)),
      config.pairs.length,
    );
  }
  function format(value, currency) {
    var crypto = currency === "BTC" || currency === "ETH";
    return (
      new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: crypto ? 8 : 2,
      }).format(value) + (crypto ? " " + currency : "")
    );
  }
  function render() {
    list.textContent = "";
    if (!config || !config.enabled) return;
    var count = visibleCount(),
      pairs = config.pairs;
    for (var i = 0; i < count; i++) {
      var pair = pairs[(index + i) % pairs.length],
        rate = rates[pair],
        item = document.createElement("div");
      item.className = "currency-item";
      var header = document.createElement("div"),
        body = document.createElement("div"),
        label = document.createElement("div"),
        value = document.createElement("div");
      header.className = "currency-header";
      body.className = "currency-body";
      label.className = "currency-code";
      label.textContent = pair === "BTC/BRL" ? "Bitcoin" : pair.replace("/", " / ");
      value.className = "currency-value";
      value.textContent = rate ? format(rate.value, pair.split("/")[1]) : "—";
      var stale = rate && (rate.stale || Date.now() - Date.parse(rate.updatedAt) >= 30 * 60000);
      var change =
        rate &&
        rate.changePeriod === "24h" &&
        typeof rate.changePercent === "number" &&
        isFinite(rate.changePercent) &&
        !stale
          ? rate.changePercent
          : null;
      var rounded = change === null ? null : Math.round(change * 100) / 100;
      var direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
      item.title = rate
        ? (stale ? "Dados anteriores · " : "") +
          pair +
          " · " +
          rate.source +
          " · consultado em " +
          new Date(rate.updatedAt).toLocaleString("pt-BR") +
          (change !== null ? " · Variação em 24h: Coinbase Exchange" : "")
        : "Cotação indisponível";
      header.appendChild(label);
      body.appendChild(value);
      if (rounded !== null) {
        var changeLabel = document.createElement("span"),
          indicator = document.createElement("span"),
          formatted = new Intl.NumberFormat("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(Math.abs(rounded));
        changeLabel.className = "currency-change currency-" + direction;
        changeLabel.textContent = (rounded > 0 ? "+" : rounded < 0 ? "−" : "") + formatted + "%";
        indicator.className = "currency-indicator currency-" + direction;
        indicator.textContent = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
        indicator.setAttribute(
          "aria-label",
          direction === "up"
            ? "Alta em 24 horas"
            : direction === "down"
              ? "Queda em 24 horas"
              : "Estável em 24 horas",
        );
        header.appendChild(changeLabel);
        body.appendChild(indicator);
      }
      item.appendChild(header);
      item.appendChild(body);
      list.appendChild(item);
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (!paused && config && config.enabled)
      timer = setTimeout(function () {
        if (config.pairs.length > visibleCount())
          index = (index + visibleCount()) % config.pairs.length;
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
      Object.keys(value || {}).forEach(function (code) {
        var rate = value && value[code];
        if (
          /^[A-Z]{3}\/[A-Z]{3}$/.test(code) &&
          rate &&
          typeof rate.value === "number" &&
          isFinite(rate.value) &&
          rate.value > 0 &&
          typeof rate.updatedAt === "string" &&
          isFinite(Date.parse(rate.updatedAt))
        )
          next[code] = rate;
      });
      rates = next;
      render();
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
