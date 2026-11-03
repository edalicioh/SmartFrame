(function (app) {
  "use strict";
  var title = document.getElementById("calendar-today"),
    days = document.getElementById("calendar-days");
  var view = new Date(),
    lastToday = new Date(),
    config,
    timer,
    paused = false;
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  function zonedToday() {
    var now = new Date();
    if (!app.timezone) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: app.timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(now);
    var values = {};
    parts.forEach(function (part) {
      values[part.type] = Number(part.value);
    });
    return new Date(values.year, values.month - 1, values.day);
  }
  function updateToday() {
    var now = zonedToday();
    if (view.getFullYear() === lastToday.getFullYear() && view.getMonth() === lastToday.getMonth())
      view = new Date(now.getFullYear(), now.getMonth(), 1);
    lastToday = now;
    render();
  }
  function render() {
    var today = zonedToday(),
      year = view.getFullYear(),
      month = view.getMonth(),
      first = new Date(year, month, 1).getDay();
    title.textContent = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
      view,
    );
    days.textContent = "";
    for (var i = 0; i < 42; i++) {
      var day = new Date(year, month, i - first + 1),
        cell = document.createElement("span");
      cell.className = "calendar-day";
      cell.textContent = day.getDate();
      if (day.getMonth() !== month) cell.classList.add("adjacent");
      if (
        config &&
        config.highlightToday &&
        day.getFullYear() === today.getFullYear() &&
        day.getMonth() === today.getMonth() &&
        day.getDate() === today.getDate()
      ) {
        cell.classList.add("today");
        cell.setAttribute("aria-current", "date");
      }
      cell.setAttribute(
        "aria-label",
        new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(
          day,
        ),
      );
      days.appendChild(cell);
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (paused || !config || !config.enabled) return;
    var now = new Date(),
      midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = setTimeout(
      function () {
        updateToday();
        schedule();
      },
      Math.min(60000, Math.max(1000, midnight - now + 50)),
    );
  }
  document.getElementById("calendar-previous").addEventListener("click", function () {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    render();
  });
  document.getElementById("calendar-next").addEventListener("click", function () {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    render();
  });
  title.addEventListener("click", function () {
    var now = new Date();
    view = new Date(now.getFullYear(), now.getMonth(), 1);
    render();
  });
  app.calendar = {
    update: function (value) {
      config = value;
      updateToday();
      schedule();
    },
    pause: function () {
      paused = true;
      clearTimeout(timer);
    },
    resume: function () {
      paused = false;
      updateToday();
      schedule();
    },
  };
})(window.SmartFrame);
