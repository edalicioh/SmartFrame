(function (app) {
  "use strict";

  // These renderers are registered for the modular player; the current dashboard
  // does not load them until it can validate and apply grid configurations.
  function civilDate(now, timezone) {
    var fields = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    var parts = {};
    fields.forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = Number(part.value);
    });
    return parts;
  }
  function dayNumber(year, month, day) {
    var date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime() / 86400000;
  }
  function daysUntilBirthday(person, today) {
    function occurrence(year) {
      var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      return dayNumber(
        year,
        person.month,
        person.month === 2 && person.day === 29 && !leap ? 28 : person.day,
      );
    }
    var current = dayNumber(today.year, today.month, today.day);
    var next = occurrence(today.year);
    if (next < current) next = occurrence(today.year + 1);
    return next - current;
  }

  /** One renderer per instance. Untrusted text is always assigned via textContent. */
  function create(type, root, context) {
    if (["notes", "countdown", "birthdays", "tasks"].indexOf(type) < 0)
      throw new Error("Widget local desconhecido");
    var document = root.ownerDocument;
    var settings = null;
    var timer = null;
    var index = 0;
    var paused = false;
    var disposed = false;
    var setTimer = context.setTimeout || setTimeout;
    var clearTimer = context.clearTimeout || clearTimeout;
    var now =
      context.now ||
      function () {
        return Date.now();
      };

    function line(parent, tag, text, className) {
      var element = document.createElement(tag);
      if (className) element.className = className;
      element.textContent = text;
      parent.appendChild(element);
      return element;
    }
    function render() {
      clearTimer(timer);
      timer = null;
      if (!settings || paused || disposed) return;
      root.textContent = "";
      line(root, "h2", settings.title, "local-widget-title");
      var current = now();
      var delay = 60000 - (current % 60000) + 30;
      if (type === "notes") {
        var notes = settings.messages;
        if (notes.length) {
          index = index % notes.length;
          line(root, "p", notes[index].text, "local-widget-message");
          if (notes.length > 1) delay = settings.intervalSeconds * 1000;
        } else line(root, "p", "Nenhum recado", "local-widget-empty");
      } else if (type === "countdown") {
        var remaining;
        if (settings.target.kind === "date") {
          var target = settings.target.date.split("-").map(Number);
          var today = civilDate(current, context.timezone);
          remaining =
            dayNumber(target[0], target[1], target[2]) -
            dayNumber(today.year, today.month, today.day);
          line(
            root,
            "p",
            remaining < 0
              ? settings.completedText
              : remaining === 0
                ? "Hoje!"
                : remaining + (remaining === 1 ? " dia" : " dias"),
            "local-widget-value",
          );
        } else {
          remaining = Date.parse(settings.target.dateTime) - current;
          if (remaining <= 0) line(root, "p", settings.completedText, "local-widget-value");
          else {
            var minutes = Math.ceil(remaining / 60000);
            var days = Math.floor(minutes / 1440);
            var hours = Math.floor((minutes % 1440) / 60);
            var mins = minutes % 60;
            var value =
              settings.display === "days"
                ? Math.ceil(remaining / 86400000) + " dias"
                : days + "d " + hours + "h " + mins + "min";
            line(root, "p", value, "local-widget-value");
          }
        }
      } else if (type === "birthdays") {
        var todayDate = civilDate(current, context.timezone);
        var people = settings.people
          .map(function (person, order) {
            return { name: person.name, days: daysUntilBirthday(person, todayDate), order: order };
          })
          .sort(function (a, b) {
            return a.days - b.days || a.order - b.order;
          });
        if (!people.length) line(root, "p", "Nenhum aniversário", "local-widget-empty");
        people.slice(0, settings.displayCount).forEach(function (person) {
          line(
            root,
            "p",
            person.name +
              " · " +
              (person.days === 0
                ? "Hoje!"
                : "em " + person.days + (person.days === 1 ? " dia" : " dias")),
            "local-widget-item",
          );
        });
      } else {
        var items = settings.items.filter(function (item) {
          return settings.showCompleted || !item.completed;
        });
        if (!items.length) line(root, "p", "Nenhuma tarefa", "local-widget-empty");
        items.forEach(function (item) {
          line(root, "p", (item.completed ? "✓ " : "○ ") + item.text, "local-widget-item");
        });
      }
      if (type !== "tasks" && (type !== "notes" || settings.messages.length > 1)) {
        timer = setTimer(function () {
          if (type === "notes") index++;
          render();
        }, delay);
      }
    }
    return {
      update: function (value) {
        settings = value;
        index = 0;
        render();
      },
      pause: function () {
        paused = true;
        clearTimer(timer);
        timer = null;
      },
      resume: function () {
        if (!disposed) {
          paused = false;
          render();
        }
      },
      destroy: function () {
        disposed = true;
        clearTimer(timer);
        timer = null;
        root.textContent = "";
      },
    };
  }
  app.localWidgets = { create: create };
})(window.SmartFrame);
