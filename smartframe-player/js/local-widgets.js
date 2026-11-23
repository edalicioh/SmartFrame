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
    "controlDeck",
  ];
  var DECK_ICONS = {
    bolt: "⚡",
    play: "▶",
    next: "⏭",
    prev: "⏮",
    stop: "⏹",
    volume: "🔊",
    mute: "🔇",
    app: "◫",
    mic: "🎙",
    sun: "☀",
    terminal: ">_",
  };
  var DECK_IDEMPOTENT_ACTIONS = {
    "volume:set_mute": true,
    "volume:set_level": true,
    "app_volume:set_level": true,
    "brightness:set_level": true,
    "mic_ptt:set_mute": true,
    "mic_ptt:hold_unmute": true,
  };
  function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target, key);
  }
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
    var deckExecSeq = 0;
    var deckState = {
      mounted: false,
      structureKey: "",
      header: null,
      titleEl: null,
      statusBadge: null,
      noticeEl: null,
      feedbackEl: null,
      feedbackText: "",
      feedbackClass: "control-deck-feedback",
      gridEl: null,
      emptyEl: null,
      tiles: Object.create(null),
      ptt: {
        holding: false,
        active: false,
        bindingId: "",
        tileId: "",
        leaseId: null,
        leaseRequestId: null,
        leaseSeconds: 10,
        renewTimer: null,
        seq: 0,
      },
    };

    function nextExecutionId() {
      return "deckexec-" + ++deckExecSeq + "-" + Math.max(0, Math.floor(now())).toString(36);
    }
    function getDeckBinding(bindingId) {
      var bindings =
        widgetData && widgetData.bindings && typeof widgetData.bindings === "object"
          ? widgetData.bindings
          : null;
      if (!bindings || !hasOwn(bindings, bindingId)) return null;
      var binding = bindings[bindingId];
      return binding && typeof binding === "object" ? binding : null;
    }
    function getDeckMode(binding) {
      if (!binding) return "button";
      if (
        (binding.kind === "volume" ||
          binding.kind === "app_volume" ||
          binding.kind === "brightness") &&
        binding.action === "set_level"
      )
        return "slider";
      if (binding.kind === "mic_ptt" && binding.action === "hold_unmute") return "ptt";
      return "button";
    }
    function setDeckFeedback(status, message) {
      if (status === "unknown") {
        deckState.feedbackText = "Resultado desconhecido — não reenviado";
        deckState.feedbackClass = "control-deck-feedback is-unknown";
      } else if (status === "unavailable") {
        deckState.feedbackText =
          typeof message === "string" && message.trim() ? message.trim() : "Host indisponível";
        deckState.feedbackClass = "control-deck-feedback is-error";
      } else if (status === "rejected" || status === "error") {
        deckState.feedbackText =
          typeof message === "string" && message.trim()
            ? message.trim()
            : "Comando recusado pelo host.";
        deckState.feedbackClass = "control-deck-feedback is-error";
      } else {
        deckState.feedbackText =
          typeof message === "string" && message.trim() ? message.trim() : "Comando executado.";
        deckState.feedbackClass = "control-deck-feedback is-ok";
      }
      if (deckState.feedbackEl) {
        deckState.feedbackEl.textContent = deckState.feedbackText;
        deckState.feedbackEl.className = deckState.feedbackClass;
        deckState.feedbackEl.hidden = !deckState.feedbackText;
      }
    }
    function clearPttRenewTimer() {
      if (deckState.ptt.renewTimer !== null) {
        clearTimer(deckState.ptt.renewTimer);
        deckState.ptt.renewTimer = null;
      }
    }
    function sendDeckCommand(payload, onDone) {
      if (typeof context.onControlDeckExecute !== "function") {
        onDone({
          status: "unavailable",
          idempotent: Boolean(payload && payload.idempotent),
          message: "Transporte nativo indisponível.",
        });
        return;
      }
      try {
        context.onControlDeckExecute(payload, onDone);
      } catch {
        onDone({
          status: "unavailable",
          idempotent: Boolean(payload && payload.idempotent),
          message: "Transporte nativo indisponível.",
        });
      }
    }
    function releasePtt(skipRender) {
      var ptt = deckState.ptt;
      clearPttRenewTimer();
      var hadSession = ptt.holding || ptt.active || Boolean(ptt.leaseId);
      if (!hadSession) return;
      var bindingId = ptt.bindingId;
      var leaseId = ptt.leaseId;
      var leaseRequestId = ptt.leaseRequestId;
      ptt.holding = false;
      ptt.active = false;
      ptt.leaseId = null;
      ptt.leaseRequestId = null;
      ptt.seq++;
      if (!skipRender && !disposed && !paused && settings) renderControlDeck();
      if (bindingId && context.canExecuteControlDeck) {
        var releasePayload = {
          executionId: nextExecutionId(),
          bindingId: bindingId,
          command: "ptt_release",
          idempotent: true,
        };
        if (leaseId) releasePayload.leaseId = leaseId;
        if (leaseRequestId) releasePayload.leaseRequestId = leaseRequestId;
        sendDeckCommand(releasePayload, function (reply) {
          if (disposed) return;
          if (reply && reply.status && reply.status !== "ok") {
            setDeckFeedback(reply.status, reply.message);
          } else if (reply && reply.status === "ok" && !paused) {
            setDeckFeedback("ok", reply.message || "Microfone silenciado.");
          }
          if (!paused && settings) renderControlDeck();
        });
      }
    }
    function schedulePttRenew(seq, bindingId, leaseId, leaseSeconds) {
      clearPttRenewTimer();
      var ptt = deckState.ptt;
      if (disposed || paused || !ptt.holding || ptt.seq !== seq || !leaseId) return;
      var halfLeaseMs = Math.max(1000, Math.floor((leaseSeconds * 1000) / 2));
      ptt.renewTimer = setTimer(function () {
        ptt.renewTimer = null;
        if (disposed || paused || !ptt.holding || ptt.seq !== seq || ptt.leaseId !== leaseId)
          return;
        sendDeckCommand(
          {
            executionId: nextExecutionId(),
            bindingId: bindingId,
            command: "ptt_renew",
            leaseSeconds: leaseSeconds,
            leaseId: leaseId,
            idempotent: true,
          },
          function (reply) {
            if (disposed || paused || !ptt.holding || ptt.seq !== seq) return;
            if (reply && reply.status === "ok") {
              var nextLeaseId =
                reply.lease && typeof reply.lease.leaseId === "string"
                  ? reply.lease.leaseId
                  : leaseId;
              var nextLeaseSec =
                reply.lease && Number.isInteger(reply.lease.leaseSeconds)
                  ? reply.lease.leaseSeconds
                  : leaseSeconds;
              ptt.leaseId = nextLeaseId;
              ptt.leaseSeconds = nextLeaseSec;
              schedulePttRenew(seq, bindingId, nextLeaseId, nextLeaseSec);
            } else {
              ptt.holding = false;
              ptt.active = false;
              ptt.leaseId = null;
              ptt.leaseRequestId = null;
              clearPttRenewTimer();
              setDeckFeedback((reply && reply.status) || "rejected", reply && reply.message);
              renderControlDeck();
            }
          },
        );
      }, halfLeaseMs);
    }
    function createDeckTileEntry(tile, mode) {
      var iconText = DECK_ICONS[tile.icon] || DECK_ICONS.bolt;
      if (mode === "slider") {
        var wrap = document.createElement("div");
        wrap.className = "control-deck-tile control-deck-slider-wrap";
        var top = document.createElement("div");
        top.className = "control-deck-tile-top";
        var iconEl = line(top, "span", iconText, "control-deck-icon");
        iconEl.setAttribute("aria-hidden", "true");
        var labelEl = line(top, "span", tile.label, "control-deck-tile-label");
        var valueEl = line(top, "span", "—", "control-deck-tile-value");
        wrap.appendChild(top);
        var slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "100";
        slider.step = "1";
        slider.className = "control-deck-slider";
        slider.setAttribute("aria-label", tile.label);
        wrap.appendChild(slider);
        var sliderEntry = {
          mode: "slider",
          tile: tile,
          rootEl: wrap,
          iconEl: iconEl,
          labelEl: labelEl,
          valueEl: valueEl,
          slider: slider,
          pending: false,
          dragging: false,
          hasInteracted: false,
          lastCommittedValue: "50",
          overrideLevel: null,
          overrideDataStamp: null,
        };
        slider.addEventListener("pointerdown", function (event) {
          if (event && typeof event.stopPropagation === "function") event.stopPropagation();
          if (slider.disabled || sliderEntry.pending) return;
          sliderEntry.dragging = true;
        });
        slider.addEventListener("pointerup", function () {
          sliderEntry.dragging = false;
        });
        slider.addEventListener("pointercancel", function () {
          sliderEntry.dragging = false;
        });
        slider.addEventListener("input", function () {
          if (slider.disabled || sliderEntry.pending) {
            slider.value = sliderEntry.lastCommittedValue;
            return;
          }
          var live = Math.max(0, Math.min(100, Math.round(Number(slider.value))));
          if (Number.isFinite(live)) sliderEntry.valueEl.textContent = live + "%";
        });
        slider.addEventListener("change", function () {
          sliderEntry.dragging = false;
          if (slider.disabled || sliderEntry.pending || !context.canExecuteControlDeck) return;
          var binding = getDeckBinding(tile.bindingId);
          if (!widgetData || widgetData.available !== true || !binding || !binding.available)
            return;
          var nextLevel = Math.max(0, Math.min(100, Math.round(Number(slider.value))));
          if (!Number.isFinite(nextLevel)) return;
          sliderEntry.pending = true;
          sliderEntry.hasInteracted = true;
          sliderEntry.overrideLevel = nextLevel;
          sliderEntry.overrideDataStamp = widgetData;
          sliderEntry.valueEl.textContent = nextLevel + "%";
          slider.setAttribute("aria-disabled", "true");
          sendDeckCommand(
            {
              executionId: nextExecutionId(),
              bindingId: tile.bindingId,
              command: "set_level",
              value: nextLevel,
              idempotent: true,
            },
            function (reply) {
              if (disposed) return;
              sliderEntry.pending = false;
              if (reply && reply.status === "ok") {
                if (reply.state && typeof reply.state.level === "number") {
                  sliderEntry.overrideLevel = Math.max(
                    0,
                    Math.min(100, Math.round(reply.state.level)),
                  );
                  sliderEntry.overrideDataStamp = widgetData;
                }
                setDeckFeedback(
                  "ok",
                  reply.message ||
                    tile.label + ": " + (sliderEntry.overrideLevel ?? nextLevel) + "%",
                );
              } else {
                sliderEntry.overrideLevel = null;
                setDeckFeedback((reply && reply.status) || "error", reply && reply.message);
              }
              if (!paused && settings) renderControlDeck();
            },
          );
        });
        return sliderEntry;
      }
      if (mode === "ptt") {
        var pttBtn = document.createElement("button");
        pttBtn.type = "button";
        pttBtn.className = "control-deck-tile control-deck-ptt";
        pttBtn.setAttribute("aria-pressed", "false");
        var pttTop = document.createElement("div");
        pttTop.className = "control-deck-tile-top";
        var pttIcon = line(pttTop, "span", iconText, "control-deck-icon");
        pttIcon.setAttribute("aria-hidden", "true");
        var pttLabel = line(pttTop, "span", tile.label, "control-deck-tile-label");
        pttBtn.appendChild(pttTop);
        var pttMeta = line(pttBtn, "span", "Indisponível", "control-deck-tile-meta");
        var pttEntry = {
          mode: "ptt",
          tile: tile,
          rootEl: pttBtn,
          iconEl: pttIcon,
          labelEl: pttLabel,
          metaEl: pttMeta,
          disabled: true,
        };
        pttBtn.addEventListener("pointerdown", function (event) {
          if (event && typeof event.stopPropagation === "function") event.stopPropagation();
          if (event && event.button !== undefined && event.button !== 0) return;
          if (pttEntry.disabled || !context.canExecuteControlDeck || paused || disposed) return;
          var binding = getDeckBinding(tile.bindingId);
          if (!widgetData || widgetData.available !== true || !binding || !binding.available)
            return;
          var ptt = deckState.ptt;
          if (ptt.holding && ptt.bindingId === tile.bindingId) return;
          if (ptt.holding || ptt.active || ptt.leaseId) releasePtt(true);
          if (
            typeof pttBtn.setPointerCapture === "function" &&
            event &&
            event.pointerId !== undefined
          ) {
            try {
              pttBtn.setPointerCapture(event.pointerId);
            } catch {}
          }
          var leaseSeconds =
            Number.isInteger(binding.leaseSeconds) &&
            binding.leaseSeconds >= 2 &&
            binding.leaseSeconds <= 30
              ? binding.leaseSeconds
              : 10;
          ptt.holding = true;
          ptt.active = false;
          ptt.bindingId = tile.bindingId;
          ptt.tileId = tile.id;
          ptt.leaseId = null;
          var leaseRequestId = nextExecutionId();
          ptt.leaseRequestId = leaseRequestId;
          ptt.leaseSeconds = leaseSeconds;
          var seq = ++ptt.seq;
          renderControlDeck();
          sendDeckCommand(
            {
              executionId: leaseRequestId,
              leaseRequestId: leaseRequestId,
              bindingId: tile.bindingId,
              command: "ptt_acquire",
              leaseSeconds: leaseSeconds,
              idempotent: true,
            },
            function (reply) {
              var releasedEarly = !ptt.holding || ptt.seq !== seq || paused || disposed;
              if (
                reply &&
                reply.status === "ok" &&
                reply.lease &&
                typeof reply.lease.leaseId === "string"
              ) {
                if (releasedEarly) {
                  if (context.canExecuteControlDeck) {
                    sendDeckCommand(
                      {
                        executionId: nextExecutionId(),
                        bindingId: tile.bindingId,
                        command: "ptt_release",
                        leaseId: reply.lease.leaseId,
                        leaseRequestId: leaseRequestId,
                        idempotent: true,
                      },
                      function () {},
                    );
                  }
                  return;
                }
                ptt.active = true;
                ptt.leaseId = reply.lease.leaseId;
                var effectiveLeaseSec = Number.isInteger(reply.lease.leaseSeconds)
                  ? reply.lease.leaseSeconds
                  : leaseSeconds;
                ptt.leaseSeconds = effectiveLeaseSec;
                setDeckFeedback("ok", reply.message || "Push-to-Talk ativo.");
                schedulePttRenew(seq, tile.bindingId, ptt.leaseId, effectiveLeaseSec);
                renderControlDeck();
                return;
              }
              if (releasedEarly) return;
              ptt.holding = false;
              ptt.active = false;
              ptt.leaseId = null;
              ptt.leaseRequestId = null;
              clearPttRenewTimer();
              setDeckFeedback((reply && reply.status) || "unavailable", reply && reply.message);
              renderControlDeck();
            },
          );
        });
        pttBtn.addEventListener("pointerup", function (event) {
          if (event && typeof event.stopPropagation === "function") event.stopPropagation();
          if (deckState.ptt.bindingId === tile.bindingId) releasePtt(false);
        });
        pttBtn.addEventListener("pointercancel", function (event) {
          if (event && typeof event.stopPropagation === "function") event.stopPropagation();
          if (deckState.ptt.bindingId === tile.bindingId) releasePtt(false);
        });
        pttBtn.addEventListener("lostpointercapture", function () {
          if (deckState.ptt.bindingId === tile.bindingId) releasePtt(false);
        });
        pttBtn.addEventListener("blur", function () {
          if (deckState.ptt.bindingId === tile.bindingId) releasePtt(false);
        });
        return pttEntry;
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "control-deck-tile";
      var btnTop = document.createElement("div");
      btnTop.className = "control-deck-tile-top";
      var btnIcon = line(btnTop, "span", iconText, "control-deck-icon");
      btnIcon.setAttribute("aria-hidden", "true");
      var btnLabel = line(btnTop, "span", tile.label, "control-deck-tile-label");
      btn.appendChild(btnTop);
      var btnMeta = line(btn, "span", "—", "control-deck-tile-meta");
      var btnEntry = {
        mode: "button",
        tile: tile,
        rootEl: btn,
        iconEl: btnIcon,
        labelEl: btnLabel,
        metaEl: btnMeta,
        pending: false,
        disabled: true,
        effectiveMuted: null,
        overrideMuted: null,
        overrideDataStamp: null,
      };
      btn.addEventListener("click", function (event) {
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
        if (btnEntry.disabled || btnEntry.pending || !context.canExecuteControlDeck) return;
        var binding = getDeckBinding(tile.bindingId);
        if (!widgetData || widgetData.available !== true || !binding || !binding.available) return;
        var actionKey = binding.kind + ":" + binding.action;
        var idempotent =
          typeof binding.idempotent === "boolean"
            ? binding.idempotent
            : Boolean(DECK_IDEMPOTENT_ACTIONS[actionKey]);
        var payload = {
          executionId: nextExecutionId(),
          bindingId: tile.bindingId,
          command: "trigger",
          idempotent: idempotent,
        };
        if (
          (binding.kind === "volume" || binding.kind === "mic_ptt") &&
          binding.action === "set_mute"
        ) {
          payload.command = "set_mute";
          payload.muted = !(btnEntry.effectiveMuted === true);
        }
        btnEntry.pending = true;
        btn.setAttribute("aria-disabled", "true");
        renderControlDeck();
        sendDeckCommand(payload, function (reply) {
          if (disposed) return;
          btnEntry.pending = false;
          if (reply && reply.state && typeof reply.state === "object") {
            if (typeof reply.state.muted === "boolean") {
              btnEntry.overrideMuted = reply.state.muted;
              btnEntry.overrideDataStamp = widgetData;
            }
          }
          setDeckFeedback((reply && reply.status) || "error", reply && reply.message);
          if (!paused && settings) renderControlDeck();
        });
      });
      return btnEntry;
    }
    function renderControlDeck() {
      var canExecute = Boolean(context.canExecuteControlDeck);
      var hostAvailable = Boolean(widgetData && widgetData.available === true);
      var tiles = Array.isArray(settings.tiles) ? settings.tiles : [];
      var columns =
        Number.isInteger(settings.columns) && settings.columns >= 2 && settings.columns <= 4
          ? settings.columns
          : 3;

      if (
        (deckState.ptt.holding || deckState.ptt.active || deckState.ptt.leaseId) &&
        !tiles.some(function (t) {
          if (t.bindingId !== deckState.ptt.bindingId) return false;
          var b = getDeckBinding(t.bindingId);
          return Boolean(hostAvailable && b && b.available && getDeckMode(b) === "ptt");
        })
      ) {
        releasePtt(true);
      }

      var structureKey = tiles
        .map(function (tile) {
          return tile.id + "|" + tile.bindingId + "|" + getDeckMode(getDeckBinding(tile.bindingId));
        })
        .join(";");

      if (!deckState.mounted || deckState.structureKey !== structureKey) {
        if (
          deckState.mounted &&
          (deckState.ptt.holding || deckState.ptt.active || deckState.ptt.leaseId)
        ) {
          releasePtt(true);
        }
        root.textContent = "";
        var header = document.createElement("div");
        header.className = "control-deck-header";
        var titleEl = line(header, "h2", settings.title, "local-widget-title");
        var statusBadge = line(
          header,
          "span",
          hostAvailable ? "Conectado" : "Host indisponível",
          "control-deck-status " + (hostAvailable ? "is-connected" : "is-offline"),
        );
        root.appendChild(header);

        var noticeEl = line(
          root,
          "p",
          "Prévia / somente leitura — comandos disponíveis apenas no tablet pareado.",
          "control-deck-notice",
        );
        noticeEl.hidden = canExecute;

        var feedbackEl = line(
          root,
          "p",
          deckState.feedbackText,
          deckState.feedbackClass || "control-deck-feedback",
        );
        feedbackEl.setAttribute("role", "status");
        feedbackEl.setAttribute("aria-live", "polite");
        feedbackEl.hidden = !deckState.feedbackText;

        var newTiles = Object.create(null);
        var gridEl = null;
        var emptyEl = null;
        if (tiles.length > 0) {
          gridEl = document.createElement("div");
          gridEl.className = "control-deck-grid";
          gridEl.style.setProperty("--deck-columns", String(columns));
          tiles.forEach(function (tile) {
            var mode = getDeckMode(getDeckBinding(tile.bindingId));
            var entry = createDeckTileEntry(tile, mode);
            newTiles[tile.id] = entry;
            gridEl.appendChild(entry.rootEl);
          });
          root.appendChild(gridEl);
        } else {
          emptyEl = line(root, "p", "Nenhum controle configurado", "local-widget-empty");
        }

        deckState.mounted = true;
        deckState.structureKey = structureKey;
        deckState.header = header;
        deckState.titleEl = titleEl;
        deckState.statusBadge = statusBadge;
        deckState.noticeEl = noticeEl;
        deckState.feedbackEl = feedbackEl;
        deckState.gridEl = gridEl;
        deckState.emptyEl = emptyEl;
        deckState.tiles = newTiles;
      } else {
        if (deckState.titleEl.textContent !== settings.title)
          deckState.titleEl.textContent = settings.title;
        deckState.statusBadge.textContent = hostAvailable ? "Conectado" : "Host indisponível";
        deckState.statusBadge.className =
          "control-deck-status " + (hostAvailable ? "is-connected" : "is-offline");
        deckState.noticeEl.hidden = canExecute;
        deckState.feedbackEl.textContent = deckState.feedbackText;
        deckState.feedbackEl.className = deckState.feedbackClass || "control-deck-feedback";
        deckState.feedbackEl.hidden = !deckState.feedbackText;
        if (deckState.gridEl) deckState.gridEl.style.setProperty("--deck-columns", String(columns));
      }

      tiles.forEach(function (tile) {
        var entry = deckState.tiles[tile.id];
        if (!entry) return;
        var binding = getDeckBinding(tile.bindingId);
        var iconText = DECK_ICONS[tile.icon] || DECK_ICONS.bolt;
        if (entry.iconEl.textContent !== iconText) entry.iconEl.textContent = iconText;
        if (entry.labelEl.textContent !== tile.label) entry.labelEl.textContent = tile.label;

        if (entry.mode === "slider") {
          if (entry.overrideDataStamp !== widgetData) {
            entry.overrideLevel = null;
          }
          var hasServerNumericLevel = Boolean(binding && typeof binding.level === "number");
          if (hasServerNumericLevel) {
            entry.hasInteracted = false;
          }
          var rawLevel =
            entry.overrideDataStamp === widgetData && typeof entry.overrideLevel === "number"
              ? entry.overrideLevel
              : hasServerNumericLevel
                ? binding.level
                : null;
          var supportsBlindLevel = Boolean(
            binding && binding.kind === "app_volume" && binding.action === "set_level",
          );
          var hasNumericLevel = typeof rawLevel === "number";
          var levelAvailable = Boolean(
            hostAvailable &&
            binding &&
            binding.available &&
            (hasNumericLevel || supportsBlindLevel),
          );
          var sliderInteractive = Boolean(canExecute && levelAvailable);
          entry.slider.disabled = !sliderInteractive;
          entry.slider.setAttribute("aria-disabled", String(!sliderInteractive || entry.pending));
          entry.slider.setAttribute("aria-label", tile.label);
          if (!levelAvailable) {
            entry.hasInteracted = false;
            entry.lastCommittedValue = "50";
            entry.valueEl.textContent = "—";
            entry.rootEl.className = "control-deck-tile control-deck-slider-wrap is-unavailable";
          } else if (!hasNumericLevel) {
            if (!entry.dragging && !entry.pending) {
              if (!entry.hasInteracted) {
                entry.slider.value = "50";
                entry.lastCommittedValue = "50";
              } else {
                entry.lastCommittedValue = String(entry.slider.value);
              }
              entry.valueEl.textContent = "—";
            }
            entry.rootEl.className =
              "control-deck-tile control-deck-slider-wrap" +
              (sliderInteractive ? "" : " is-readonly");
          } else {
            var clampedLevel = Math.max(0, Math.min(100, Math.round(rawLevel)));
            entry.lastCommittedValue = String(clampedLevel);
            if (!entry.dragging && !entry.pending) {
              entry.slider.value = String(clampedLevel);
              entry.valueEl.textContent = clampedLevel + "%";
            }
            entry.rootEl.className =
              "control-deck-tile control-deck-slider-wrap" +
              (sliderInteractive ? "" : " is-readonly");
          }
        } else if (entry.mode === "ptt") {
          var pttAvailable = Boolean(hostAvailable && binding && binding.available);
          var pttInteractive = Boolean(canExecute && pttAvailable);
          var isMine = deckState.ptt.bindingId === tile.bindingId;
          var pttPressed = Boolean(isMine && (deckState.ptt.holding || deckState.ptt.active));
          entry.disabled = !pttInteractive;
          entry.rootEl.disabled = !pttInteractive;
          entry.rootEl.setAttribute("aria-pressed", String(pttPressed));
          entry.rootEl.setAttribute("aria-disabled", String(!pttInteractive));
          entry.rootEl.className =
            "control-deck-tile control-deck-ptt" +
            (pttPressed ? " is-active" : "") +
            (pttAvailable ? "" : " is-unavailable");
          entry.metaEl.textContent = !pttAvailable
            ? "Indisponível"
            : pttPressed
              ? deckState.ptt.active
                ? "No ar"
                : "Ativando…"
              : "Segure para falar";
        } else {
          if (entry.overrideDataStamp !== widgetData) {
            entry.overrideMuted = null;
          }
          var btnAvailable = Boolean(hostAvailable && binding && binding.available);
          var btnInteractive = Boolean(canExecute && btnAvailable);
          entry.disabled = !btnInteractive;
          entry.rootEl.disabled = !btnInteractive;
          entry.rootEl.setAttribute("aria-disabled", String(!btnInteractive || entry.pending));
          entry.rootEl.className = "control-deck-tile" + (btnAvailable ? "" : " is-unavailable");
          var mutedVal =
            entry.overrideDataStamp === widgetData && typeof entry.overrideMuted === "boolean"
              ? entry.overrideMuted
              : binding && typeof binding.muted === "boolean"
                ? binding.muted
                : null;
          entry.effectiveMuted = mutedVal;
          var isMuteControl = Boolean(
            binding &&
            (binding.action === "mute_toggle" ||
              binding.action === "set_mute" ||
              binding.action === "toggle_mute"),
          );
          if (isMuteControl && typeof mutedVal === "boolean") {
            entry.rootEl.setAttribute("aria-pressed", String(mutedVal));
            entry.metaEl.textContent = !btnAvailable
              ? "Indisponível"
              : entry.pending
                ? "Enviando…"
                : mutedVal
                  ? "Silenciado"
                  : "Ativo";
          } else {
            entry.metaEl.textContent = !btnAvailable
              ? "Indisponível"
              : entry.pending
                ? "Enviando…"
                : binding.kind === "shortcut"
                  ? "Atalho"
                  : "Acionar";
          }
        }
      });
    }

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
      if (type === "controlDeck") return renderControlDeck();
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
          if (widgetData && typeof widgetData.nodeVersion === "string") {
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
        var pushedFeeds =
          widgetData && Array.isArray(widgetData.pushedFeeds) ? widgetData.pushedFeeds : [];
        var pushedByKey = Object.create(null);
        var usedPushKeys = Object.create(null);
        pushedFeeds.forEach(function (feed) {
          if (feed && typeof feed.key === "string" && !pushedByKey[feed.key]) {
            pushedByKey[feed.key] = feed;
          }
        });
        var rawDevItems = Array.isArray(settings.items) ? settings.items : [];
        var devItems = rawDevItems.map(function (entry) {
          var matchKey = entry.pushKey || entry.id;
          var pushed = matchKey ? pushedByKey[matchKey] : null;
          if (!pushed) return entry;
          usedPushKeys[pushed.key] = true;
          return {
            id: entry.id,
            name: entry.name || pushed.name,
            category: entry.category || pushed.category,
            status: pushed.status || entry.status,
            detail:
              typeof pushed.detail === "string" && pushed.detail !== ""
                ? pushed.detail
                : pushed.value !== null && pushed.value !== undefined
                  ? String(pushed.value)
                  : entry.detail,
          };
        });
        pushedFeeds.forEach(function (feed) {
          if (devItems.length >= 12 || !feed || typeof feed.key !== "string") return;
          if (usedPushKeys[feed.key]) return;
          usedPushKeys[feed.key] = true;
          devItems.push({
            id: "push-" + feed.key,
            name: feed.name || feed.key,
            category: feed.category || "service",
            status: feed.status || "healthy",
            detail:
              typeof feed.detail === "string" && feed.detail !== ""
                ? feed.detail
                : feed.value !== null && feed.value !== undefined
                  ? String(feed.value)
                  : "",
          });
        });
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
            var safeStatus = DEV_STATUS_LABELS[entry.status] ? entry.status : "healthy";
            line(
              row,
              "span",
              DEV_STATUS_LABELS[safeStatus] || entry.status,
              "dev-status-badge dev-status-" + safeStatus,
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
        if (type === "controlDeck") releasePtt(true);
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
        if (type === "controlDeck") releasePtt(true);
        disposed = true;
        clearTimer(timer);
        timer = null;
        root.textContent = "";
        pomodoroElements = null;
        taskTitle = taskEmpty = null;
        taskRows = [];
        deckState.mounted = false;
        deckState.structureKey = "";
        deckState.tiles = Object.create(null);
      },
    };
  }
  app.localWidgets = { create: create };
})(window.SmartFrame);
