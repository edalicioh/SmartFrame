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
      Math.max(1, Math.floor(list.clientWidth / 190)),
      config.pairs.length,
    );
  }
  function format(value, currency) {
    var crypto = currency === "BTC" || currency === "ETH";
    return (
      new Intl.NumberFormat(
        "pt-BR",
        crypto
          ? {
              minimumFractionDigits: 2,
              maximumFractionDigits: 8,
            }
          : { style: "currency", currency: currency },
      ).format(value) + (crypto ? " " + currency : "")
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
      var label = document.createElement("div"),
        value = document.createElement("div");
      label.className = "currency-code";
      label.textContent = pair;
      value.className = "currency-value";
      value.textContent = rate ? format(rate.value, pair.split("/")[1]) : "—";
      var stale = rate && (rate.stale || Date.now() - Date.parse(rate.updatedAt) >= 30 * 60000);
      item.title = rate
        ? (stale ? "Dados anteriores · " : "") +
          rate.source +
          " · consultado em " +
          new Date(rate.updatedAt).toLocaleString("pt-BR")
        : "Cotação indisponível";
      item.appendChild(label);
      item.appendChild(value);
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
