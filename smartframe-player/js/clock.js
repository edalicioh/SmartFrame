(function (app) {
  "use strict";
  var time = document.getElementById("clock-time"),
    date = document.getElementById("clock-date"),
    card = document.getElementById("clock"),
    config,
    timer;
  function render() {
    clearTimeout(timer);
    if (!config || !config.enabled || document.hidden) return;
    var now = new Date();
    time.textContent = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: config.format === "12h",
      timeZone: app.timezone || undefined,
    }).format(now);
    date.textContent = new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: app.timezone || undefined,
    }).format(now);
    timer = setTimeout(render, 60000 - (Date.now() % 60000) + 30);
  }
  app.clock = {
    update: function (value) {
      config = value;
      date.hidden = !value.showDate;
      card.classList.toggle("clock-time-only", !value.showDate);
      time.className = "clock-time" + (value.size === "normal" ? "" : " clock-" + value.size);
      time.style.color = value.color || "";
      render();
    },
    pause: function () {
      clearTimeout(timer);
    },
    resume: render,
  };
})(window.SmartFrame);
