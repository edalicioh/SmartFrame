(function (app) {
  "use strict";

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

  var LOCAL_WIDGET_TYPES = [
    "notes",
    "countdown",
    "birthdays",
    "tasks",
    "pomodoro",
    "system",
    "worldClock",
    "rss",
    "devMonitor",
  ];
  var DEV_STATUS_LABELS = {
    healthy: "Saudável",
    running: "Em execução",
    warning: "Atenção",
    failing: "Falha",
    idle: "Inativo",
  };
  var DEV_CATEGORY_LABELS = {
    ci: "CI",
    ai: "IA",
    service: "SRV",
    deploy: "DEP",
  };

  function formatDuration(totalSeconds) {
    var seconds = Math.max(0, Math.floor(totalSeconds || 0));
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return days + "d " + hours + "h " + minutes + "min";
    if (hours > 0) return hours + "h " + minutes + "min";
    return minutes + "min";
  }

  /** One renderer per instance. Untrusted text is always assigned via textContent. */
  function create(type, root, context) {
    if (LOCAL_WIDGET_TYPES.indexOf(type) < 0) throw new Error("Widget local desconhecido");
    var document = root.ownerDocument;
    var settings = null;
    var widgetData = null;
    var timer = null;
    var index = 0;
    var rssNextRotation = 0;
    var paused = false;
    var disposed = false;
    var pomodoroElements = null;
    var taskTitle = null,
      taskEmpty = null,
      taskRows = [];
    // Keep optimistic task state separate from the last authoritative config.
    var taskChanges = Object.create(null);
    function taskKey(id) {
      return (context.revision || "") + "|" + id;
    }
    var phase = "work",
      running = false,
      end = 0,
      remainingMs = 0;
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
    function createTaskRow(id, key, interactive) {
      var element = document.createElement(interactive ? "button" : "p");
      var row = { element: element, key: key, interactive: interactive, completed: null };
      element.className = "local-widget-item";
      if (!interactive) return row;

      element.type = "button";
      element.addEventListener("click", function (event) {
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
        if (
          element.parentNode !== root ||
          key !== taskKey(id) ||
          (taskChanges[key] && taskChanges[key].pending)
        )
          return;
        var change = { completed: !row.completed, pending: true };
        taskChanges[key] = change;
        function settle(success) {
          if (taskChanges[key] !== change) return;
          if (success && key === taskKey(id)) change.pending = false;
          else delete taskChanges[key];
          render();
        }
        render();
        if (typeof context.onToggleTask === "function") {
          try {
            context.onToggleTask(
              id,
              change.completed,
              function () {
                settle(false);
              },
              settle,
            );
          } catch {
            settle(false);
          }
        } else settle(true);
      });
      return row;
    }
    function renderTasks() {
      if (!taskTitle) taskTitle = line(root, "h2", settings.title, "local-widget-title");
      else if (taskTitle.textContent !== settings.title) taskTitle.textContent = settings.title;
      var interactive = settings.interactive !== false && context.canToggleTasks !== false;
      var unused = taskRows;
      taskRows = [];
      settings.items.forEach(function (item) {
        var key = taskKey(item.id);
        var change = taskChanges[key];
        var completed = change ? change.completed : item.completed;
        if (completed && !settings.showCompleted) return;

        var match = unused.findIndex(function (row) {
          return row.key === key && row.interactive === interactive;
        });
        var row = match < 0 ? createTaskRow(item.id, key, interactive) : unused.splice(match, 1)[0];
        var element = row.element;
        var label = (completed ? "✓ " : "○ ") + item.text;
        if (element.textContent !== label) element.textContent = label;
        if (interactive) {
          if (completed !== row.completed) {
            element.className =
              "local-widget-item task-toggle-button" + (completed ? " is-completed" : "");
            element.setAttribute("aria-pressed", String(completed));
          }
          var pending = Boolean(change && change.pending);
          // The pending guard blocks repeat activation without taking keyboard focus away.
          if (row.pending !== pending) {
            element.setAttribute("aria-disabled", String(pending));
            row.pending = pending;
          }
        }
        row.completed = completed;
        taskRows.push(row);
      });
      unused.forEach(function (row) {
        root.removeChild(row.element);
      });
      if (!taskRows.length) {
        if (!taskEmpty) taskEmpty = line(root, "p", "Nenhuma tarefa", "local-widget-empty");
        return;
      }
      if (taskEmpty) {
        root.removeChild(taskEmpty);
        taskEmpty = null;
      }
      // When order changes, move siblings around the focused control; moving it would blur it.
      var next = null;
      for (var i = taskRows.length - 1; i >= 0; i--) {
        var node = taskRows[i].element;
        if (
          node !== document.activeElement &&
          (node.parentNode !== root || node.nextSibling !== next)
        )
          root.insertBefore(node, next);
        next = node;
      }
    }
    function render() {
      clearTimer(timer);
      timer = null;
      if (!settings || paused || disposed) return;
      if (type === "tasks") return renderTasks();
      if (type !== "pomodoro") {
        root.textContent = "";
        line(root, "h2", settings.title, "local-widget-title");
      }
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
      } else if (type === "pomodoro") {
        // Keep interactive nodes mounted across ticks so focus and pending clicks survive.
        if (!pomodoroElements) {
          root.textContent = "";
          pomodoroElements = {
            title: line(root, "h2", settings.title, "local-widget-title"),
            phase: line(root, "p", "", "local-widget-item"),
            time: line(root, "p", "", "local-widget-value"),
            start: line(root, "button", "Iniciar", "pomodoro-button"),
            reset: line(root, "button", "Reiniciar", "pomodoro-button"),
          };
          pomodoroElements.start.type = "button";
          pomodoroElements.start.addEventListener("click", function () {
            if (running) {
              remainingMs = Math.max(0, end - now());
              running = false;
            } else {
              end = now() + remainingMs;
              running = true;
            }
            render();
          });
          pomodoroElements.reset.type = "button";
          pomodoroElements.reset.addEventListener("click", function () {
            running = false;
            phase = "work";
            remainingMs = settings.workMinutes * 60000;
            render();
          });
        }
        if (running && current >= end) {
          running = false;
          phase = phase === "work" ? "break" : "work";
          remainingMs = (phase === "work" ? settings.workMinutes : settings.breakMinutes) * 60000;
        }
        var left = running ? Math.max(0, end - current) : remainingMs;
        var totalSeconds = Math.ceil(left / 1000);
        pomodoroElements.title.textContent = settings.title;
        pomodoroElements.phase.textContent = phase === "work" ? "Foco" : "Pausa";
        pomodoroElements.time.textContent =
          String(Math.floor(totalSeconds / 60)).padStart(2, "0") +
          ":" +
          String(totalSeconds % 60).padStart(2, "0");
        pomodoroElements.start.textContent = running ? "Pausar" : "Iniciar";
        delay = 250;
      } else if (type === "system") {
        if (!widgetData) {
          line(root, "p", "Aguardando métricas do servidor…", "local-widget-empty");
        } else {
          var metricsList = document.createElement("div");
          metricsList.className = "system-metrics-list";
          var addMeter = function (label, textValue, percent) {
            var row = document.createElement("div");
            row.className = "system-metric-row";
            var header = document.createElement("div");
            header.className = "system-metric-header";
            line(header, "span", label, "system-metric-label");
            line(header, "strong", textValue, "system-metric-value");
            row.appendChild(header);
            if (typeof percent === "number" && Number.isFinite(percent)) {
              var meter = document.createElement("div");
              meter.className = "system-meter";
              var fill = document.createElement("div");
              fill.className = "system-meter-fill";
              fill.style.setProperty("--meter-percent", Math.max(0, Math.min(100, percent)) + "%");
              meter.appendChild(fill);
              row.appendChild(meter);
            }
            metricsList.appendChild(row);
          };
          if (settings.showCpu) {
            addMeter(
              "CPU",
              widgetData.cpuUsagePercent + "% (" + widgetData.cpuCores + " núcleos)",
              widgetData.cpuUsagePercent,
            );
          }
          if (settings.showMemory) {
            addMeter(
              "RAM",
              widgetData.memoryUsedPercent +
                "% (" +
                widgetData.memoryUsedGb +
                " / " +
                widgetData.memoryTotalGb +
                " GB)",
              widgetData.memoryUsedPercent,
            );
          }
          if (settings.showDisk) {
            addMeter(
              "Disco",
              widgetData.diskUsedPercent === null
                ? "Indisponível"
                : widgetData.diskUsedPercent + "% ocupado",
              widgetData.diskUsedPercent,
            );
          }
          if (settings.showUptime) {
            addMeter("Atividade", formatDuration(widgetData.uptimeSeconds), null);
          }
          if (!metricsList.children.length) {
            line(root, "p", "Nenhuma métrica selecionada", "local-widget-empty");
          } else {
            root.appendChild(metricsList);
          }
        }
      } else if (type === "worldClock") {
        var zones = Array.isArray(settings.zones) ? settings.zones : [];
        if (!zones.length) {
          line(root, "p", "Nenhum fuso configurado", "local-widget-empty");
        } else {
          var worldList = document.createElement("div");
          worldList.className = "world-clock-list";
          var baseDate = civilDate(current, context.timezone || "America/Sao_Paulo");
          var baseDay = dayNumber(baseDate.year, baseDate.month, baseDate.day);
          zones.forEach(function (zone) {
            var row = document.createElement("div");
            row.className = "world-clock-row";
            var meta = document.createElement("div");
            meta.className = "world-clock-meta";
            line(meta, "strong", zone.label, "world-clock-city");
            var zoneDate = civilDate(current, zone.timezone);
            var deltaDays = dayNumber(zoneDate.year, zoneDate.month, zoneDate.day) - baseDay;
            var relLabel =
              deltaDays === 0 ? "Hoje" : deltaDays > 0 ? "+" + deltaDays + "d" : deltaDays + "d";
            line(meta, "span", relLabel, "world-clock-day");
            row.appendChild(meta);
            var formatted = new Intl.DateTimeFormat("pt-BR", {
              timeZone: zone.timezone,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: settings.format === "12h",
            }).format(current);
            line(row, "span", formatted, "world-clock-time");
            worldList.appendChild(row);
          });
          root.appendChild(worldList);
          delay = 1000 - (current % 1000) + 20;
        }
      } else if (type === "rss") {
        if (!settings.feedUrl) {
          line(root, "p", "Configure uma URL HTTPS nas opções de RSS.", "local-widget-empty");
        } else if (!widgetData || !Array.isArray(widgetData.items) || !widgetData.items.length) {
          line(root, "p", "Aguardando notícias do feed…", "local-widget-empty");
        } else {
          if (widgetData.title) line(root, "p", widgetData.title, "rss-source-title");
          var feedItems = widgetData.items.slice(0, settings.maxItems || 5);
          if (settings.rotateSeconds >= 5 && feedItems.length > 1) {
            index = index % feedItems.length;
            var currentFeedItem = feedItems[index];
            var card = document.createElement("div");
            card.className = "rss-item rss-item-featured";
            line(card, "p", currentFeedItem.title, "rss-item-title");
            line(
              card,
              "span",
              index +
                1 +
                "/" +
                feedItems.length +
                (currentFeedItem.publishedAt
                  ? " · " +
                    new Date(currentFeedItem.publishedAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""),
              "rss-item-meta",
            );
            root.appendChild(card);
            if (!rssNextRotation) rssNextRotation = current + settings.rotateSeconds * 1000;
            delay = Math.max(0, rssNextRotation - current);
          } else {
            var rssList = document.createElement("div");
            rssList.className = "rss-list";
            feedItems.forEach(function (entry) {
              var row = document.createElement("div");
              row.className = "rss-item";
              line(row, "p", entry.title, "rss-item-title");
              rssList.appendChild(row);
            });
            root.appendChild(rssList);
          }
        }
      } else if (type === "devMonitor") {
        if (settings.showServerMetrics !== false) {
          if (widgetData) {
            var summary = document.createElement("div");
            summary.className = "dev-server-summary";
            line(summary, "span", "Node " + widgetData.nodeVersion, "dev-pill");
            line(summary, "span", widgetData.rssMemoryMb + " MB RAM", "dev-pill");
            line(summary, "span", widgetData.activeDevicesCount + " telas", "dev-pill");
            line(summary, "span", widgetData.readyPhotosCount + " fotos", "dev-pill");
            root.appendChild(summary);
          } else {
            line(root, "p", "Coletando telemetria do servidor…", "local-widget-empty");
          }
        }
        var devItems = Array.isArray(settings.items) ? settings.items : [];
        if (devItems.length) {
          var devList = document.createElement("div");
          devList.className = "dev-monitor-list";
          devItems.forEach(function (entry) {
            var row = document.createElement("div");
            row.className = "dev-monitor-row";
            var left = document.createElement("div");
            left.className = "dev-monitor-info";
            line(
              left,
              "span",
              "[" + (DEV_CATEGORY_LABELS[entry.category] || "SRV") + "] " + entry.name,
              "dev-monitor-name",
            );
            if (entry.detail) line(left, "span", entry.detail, "dev-monitor-detail");
            row.appendChild(left);
            line(
              row,
              "span",
              DEV_STATUS_LABELS[entry.status] || entry.status,
              "dev-status-badge dev-status-" + entry.status,
            );
            devList.appendChild(row);
          });
          root.appendChild(devList);
        } else if (settings.showServerMetrics === false) {
          line(root, "p", "Nenhum serviço configurado", "local-widget-empty");
        }
      }
      var shouldSchedule =
        type === "countdown" ||
        type === "birthdays" ||
        (type === "notes" && settings.messages.length > 1) ||
        (type === "pomodoro" && running) ||
        (type === "worldClock" && Array.isArray(settings.zones) && settings.zones.length > 0) ||
        (type === "rss" &&
          widgetData &&
          Array.isArray(widgetData.items) &&
          Math.min(widgetData.items.length, settings.maxItems || 5) > 1 &&
          settings.rotateSeconds >= 5);
      if (shouldSchedule) {
        timer = setTimer(function () {
          if (type === "notes" || type === "rss") index++;
          if (type === "rss") rssNextRotation = 0;
          render();
        }, delay);
      } else if (type === "rss") {
        rssNextRotation = 0;
      }
    }
    return {
      update: function (value) {
        if (type === "tasks") {
          Object.keys(taskChanges).forEach(function (key) {
            if (!taskChanges[key].pending) delete taskChanges[key];
          });
        }
        if (
          type === "pomodoro" &&
          (!settings ||
            settings.workMinutes !== value.workMinutes ||
            settings.breakMinutes !== value.breakMinutes)
        ) {
          running = false;
          phase = "work";
          remainingMs = value.workMinutes * 60000;
        }
        settings = value;
        index = 0;
        rssNextRotation = 0;
        render();
      },
      setData: function (data) {
        widgetData = data || null;
        if (settings && !paused && !disposed) render();
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
        pomodoroElements = null;
        taskTitle = taskEmpty = null;
        taskRows = [];
      },
    };
  }
  app.localWidgets = { create: create };
})(window.SmartFrame);
