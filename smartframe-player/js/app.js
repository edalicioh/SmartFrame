(function (app) {
  "use strict";
  var dashboard = document.getElementById("dashboard"),
    stack = document.getElementById("widget-stack");
  var status = document.getElementById("connection-status"),
    smartStackNav = document.getElementById("smart-stack-nav"),
    pageNav = document.getElementById("page-nav"),
    pageOverview = document.getElementById("page-overview"),
    config = null,
    pollTimer = null,
    pageTimer = null,
    stackTimer = null,
    pageTimerKey = "",
    stackTimerKey = "",
    controller = null,
    inFlight = false,
    refreshRequested = false,
    failures = 0,
    currenciesPending = false,
    rssPending = false,
    activePageIndex = 0,
    activePageId = "",
    activeStackIndex = 0,
    overviewOpen = false,
    interactionPausedUntil = 0;
  var preview = new URLSearchParams(location.search).get("preview") === "1",
    deviceMatch = location.pathname.match(/^\/player\/([A-Za-z0-9_-]+)$/),
    appliedRevision = "";
  var names = ["photos", "clock", "weather", "currencies", "calendar"];
  var localNames = [
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
  var nativeTasks = window.SmartFrameTasks,
    nativeTasksSupported = Boolean(nativeTasks && typeof nativeTasks.postMessage === "function"),
    nativeTaskSequence = 0,
    pendingNativeTasks = Object.create(null);
  if (nativeTasksSupported) {
    nativeTasks.onmessage = function (event) {
      var reply;
      try {
        reply = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!reply || typeof reply.requestId !== "string") return;
      var pending = pendingNativeTasks[reply.requestId];
      if (!pending) return;
      delete pendingNativeTasks[reply.requestId];
      clearTimeout(pending.timer);
      if (reply.ok !== true && typeof pending.rollback === "function") pending.rollback();
      if (typeof pending.settle === "function") pending.settle(reply.ok === true);
      // A failed response may still have committed. Reconcile with the server.
      schedule(0);
    };
  }
  var localContext = {
      timezone: "America/Sao_Paulo",
      revision: "",
      canToggleTasks: preview || nativeTasksSupported,
      onToggleTask: function (taskId, completed, rollback, settle) {
        if (preview) {
          if (typeof settle === "function") settle(true);
          return;
        }
        if (
          !nativeTasksSupported ||
          !taskId ||
          !config ||
          !/^online:[A-Za-z0-9_-]{1,128}$/.test(config.revision)
        ) {
          if (typeof rollback === "function") rollback();
          if (typeof settle === "function") settle(false);
          return;
        }
        var requestId = "task-" + ++nativeTaskSequence;
        var failNativeTask = function () {
          var pending = pendingNativeTasks[requestId];
          if (!pending) return;
          delete pendingNativeTasks[requestId];
          clearTimeout(pending.timer);
          if (typeof pending.rollback === "function") pending.rollback();
          if (typeof pending.settle === "function") pending.settle(false);
          schedule(0);
        };
        pendingNativeTasks[requestId] = {
          rollback: rollback,
          settle: settle,
          timer: setTimeout(failNativeTask, 25000),
        };
        try {
          nativeTasks.postMessage(
            JSON.stringify({
              requestId: requestId,
              revision: config.revision,
              taskId: taskId,
              completed: completed,
            }),
          );
        } catch {
          failNativeTask();
        }
      },
    },
    localRenderers = {};
  if (app.localWidgets)
    localNames.forEach(function (name) {
      var el = document.getElementById(name);
      if (el) localRenderers[name] = app.localWidgets.create(name, el, localContext);
    });
  function changed(a, b) {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  function styleWidget(name, value, globalAppearance) {
    var element = document.getElementById(name);
    if (!element) return;
    var background = value.backgroundColor || "";
    element.classList.toggle("has-custom-bg", Boolean(background));
    if (background) {
      var hex = background.slice(1);
      if (hex.length === 3)
        hex = hex
          .split("")
          .map(function (part) {
            return part + part;
          })
          .join("");
      var channels = [0, 2, 4].map(function (offset) {
        var channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
      var light = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179;
      element.style.setProperty("--widget-background", background);
      element.style.setProperty("--widget-foreground", light ? "#172033" : "#ffffff");
      element.style.setProperty("--widget-muted", light ? "#4b5563" : "#d1d5db");
      element.style.setProperty("--widget-up", light ? "#06642e" : "#8dd6a3");
      element.style.setProperty("--widget-down", light ? "#a51f28" : "#ff999d");
      element.style.setProperty("--widget-flat", light ? "#4b5563" : "#bfc3ca");
    } else {
      ["background", "foreground", "muted", "up", "down", "flat"].forEach(function (key) {
        element.style.removeProperty("--widget-" + key);
      });
    }
    var resolved = app.resolveAppearance
      ? app.resolveAppearance(globalAppearance, value.appearance)
      : null;
    if (resolved) {
      if (resolved.cornerRadius !== null)
        element.style.setProperty("--widget-radius", resolved.cornerRadius + "px");
      else element.style.removeProperty("--widget-radius");
      if (name !== "photos" && resolved.innerPadding !== null)
        element.style.setProperty("--widget-padding", resolved.innerPadding + "px");
      else element.style.removeProperty("--widget-padding");
      if (resolved.border === true)
        element.style.setProperty(
          "--widget-border",
          "1px solid var(--widget-border-color, rgba(148, 163, 184, 0.38))",
        );
      else if (resolved.border === false)
        element.style.setProperty("--widget-border", "0px solid transparent");
      else element.style.removeProperty("--widget-border");
      if (resolved.shadow === true) element.style.setProperty("--widget-shadow", "var(--shadow)");
      else if (resolved.shadow === false) element.style.setProperty("--widget-shadow", "none");
      else element.style.removeProperty("--widget-shadow");
      element.classList.toggle("surface-flat", resolved.surfaceMode === "flat");
      element.classList.toggle("surface-borderless", resolved.surfaceMode === "borderless");
      element.classList.toggle("surface-seamless", resolved.surfaceMode === "seamless");
    } else {
      ["radius", "padding", "border", "shadow"].forEach(function (key) {
        element.style.removeProperty("--widget-" + key);
      });
      element.classList.remove("surface-flat", "surface-borderless", "surface-seamless");
    }
    if (name !== "photos") {
      var rows = {
        clock: [14, 18, 23],
        weather: [13, 16, 20],
        currencies: [15, 19, 24],
        calendar: [38, 47, 59],
      };
      if (rows[name]) {
        var size = value.cardSize === "small" ? 0 : value.cardSize === "large" ? 2 : 1;
        element.style.setProperty("--widget-rows", rows[name][size]);
      }
    }
  }
  function indexGridItems(items) {
    var map = {};
    if (!Array.isArray(items)) return map;
    items.forEach(function (item) {
      if (item && typeof item.widgetId === "string") map[item.widgetId] = item;
    });
    return map;
  }
  var gridTracks = {
      landscape: { columns: 24, rows: 24 },
      portrait: { columns: 12, rows: 40 },
    },
    gridSides = ["top", "right", "bottom", "left"];
  function gridMarginFactor(item, side, tracks) {
    if (side === "top") return item.y === 0 ? 0 : 0.5;
    if (side === "bottom") return item.y + item.h >= tracks.rows ? 0 : 0.5;
    if (side === "left") return item.x === 0 ? 0 : 0.5;
    return item.x + item.w >= tracks.columns ? 0 : 0.5;
  }
  function applyGridItem(element, orientation, item) {
    var suffix = "-" + orientation;
    if (!item) {
      element.style.removeProperty("--grid-col" + suffix);
      element.style.removeProperty("--grid-row" + suffix);
      gridSides.forEach(function (side) {
        element.style.removeProperty("--grid-margin-" + side + suffix);
      });
      return;
    }
    element.style.setProperty("--grid-col" + suffix, item.x + 1 + " / span " + item.w);
    element.style.setProperty("--grid-row" + suffix, item.y + 1 + " / span " + item.h);
    gridSides.forEach(function (side) {
      element.style.setProperty(
        "--grid-margin-" + side + suffix,
        gridMarginFactor(item, side, gridTracks[orientation]),
      );
    });
  }
  function clearChildren(node) {
    if (!node) return;
    if (typeof node.replaceChildren === "function") node.replaceChildren();
    else node.textContent = "";
  }
  function makeButton(className, label, text, pressed, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    if (label) btn.setAttribute("aria-label", label);
    if (pressed !== null && pressed !== undefined)
      btn.setAttribute("aria-pressed", String(pressed));
    btn.textContent = text;
    btn.addEventListener("click", function (event) {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      pauseAutoRotation();
      onClick();
    });
    return btn;
  }
  function pauseAutoRotation() {
    interactionPausedUntil = Date.now() + 10000;
  }
  function resolveEffectiveView(cfg) {
    var pages = Array.isArray(cfg.pages) && cfg.pages.length > 0 ? cfg.pages : null;
    var page = null;
    if (pages) {
      var foundIndex = -1;
      if (activePageId) {
        for (var i = 0; i < pages.length; i++) {
          if (pages[i].id === activePageId) {
            foundIndex = i;
            break;
          }
        }
      }
      if (foundIndex < 0) foundIndex = activePageIndex < pages.length ? activePageIndex : 0;
      activePageIndex = foundIndex;
      page = pages[foundIndex];
      activePageId = page.id;
    } else {
      activePageIndex = 0;
      activePageId = "";
    }
    var enabledMap = {};
    if (page && Array.isArray(page.enabledWidgets)) {
      page.enabledWidgets.forEach(function (key) {
        enabledMap[key] = true;
      });
    } else {
      names.concat(localNames).forEach(function (key) {
        if (cfg.widgets[key] && cfg.widgets[key].enabled) enabledMap[key] = true;
      });
    }
    var layoutOptions = (page && page.layoutOptions) || cfg.layoutOptions;
    var gridLayout = (page && page.gridLayout) || cfg.gridLayout || null;
    var smartStack = (page && page.smartStack) || cfg.smartStack || null;
    var stackWidgets = [];
    var gridEnabled = Boolean(gridLayout && gridLayout.enabled);
    if (gridEnabled && smartStack && smartStack.enabled && Array.isArray(smartStack.widgets)) {
      smartStack.widgets.forEach(function (key) {
        if (enabledMap[key] && stackWidgets.indexOf(key) === -1) stackWidgets.push(key);
      });
    }
    if (stackWidgets.length >= 2) {
      activeStackIndex =
        ((activeStackIndex % stackWidgets.length) + stackWidgets.length) % stackWidgets.length;
    } else {
      activeStackIndex = 0;
    }
    return {
      pages: pages,
      page: page,
      pageIndex: activePageIndex,
      enabledMap: enabledMap,
      layoutOptions: layoutOptions,
      gridLayout: gridLayout,
      smartStack: smartStack,
      stackWidgets: stackWidgets,
      activeStackWidget: stackWidgets.length >= 2 ? stackWidgets[activeStackIndex] : null,
    };
  }
  function currenciesEnabledOnAnyPage(cfg) {
    var globallyEnabled = Boolean(cfg.widgets.currencies && cfg.widgets.currencies.enabled);
    if (Array.isArray(cfg.pages) && cfg.pages.length > 0) {
      return (
        globallyEnabled ||
        cfg.pages.some(function (page) {
          return (
            page &&
            Array.isArray(page.enabledWidgets) &&
            page.enabledWidgets.indexOf("currencies") !== -1
          );
        })
      );
    }
    return globallyEnabled;
  }
  function applyGridLayout(gridLayout, stackWidgets) {
    var enabled = Boolean(gridLayout && gridLayout.enabled);
    dashboard.classList.toggle("grid-mode", enabled);
    var maps = {
      landscape: enabled ? indexGridItems(gridLayout.landscape) : {},
      portrait: enabled ? indexGridItems(gridLayout.portrait) : {},
    };
    function findStackSlot(orientation) {
      if (!enabled || !stackWidgets || stackWidgets.length < 2) return null;
      var map = maps[orientation];
      for (var i = 0; i < stackWidgets.length; i++) {
        if (map[stackWidgets[i]]) return map[stackWidgets[i]];
      }
      return null;
    }
    var stackSlot = {
      landscape: findStackSlot("landscape"),
      portrait: findStackSlot("portrait"),
    };
    names.concat(localNames).forEach(function (name) {
      var element = document.getElementById(name);
      if (!element) return;
      var inStack = stackWidgets && stackWidgets.length >= 2 && stackWidgets.indexOf(name) !== -1;
      ["landscape", "portrait"].forEach(function (orientation) {
        var item = maps[orientation][name] || (inStack ? stackSlot[orientation] : null);
        if (inStack && stackSlot[orientation]) item = stackSlot[orientation];
        applyGridItem(element, orientation, item);
      });
    });
    if (smartStackNav) {
      ["landscape", "portrait"].forEach(function (orientation) {
        applyGridItem(smartStackNav, orientation, stackSlot[orientation]);
      });
    }
  }
  function renderSmartStackNav(effective) {
    if (!smartStackNav) return;
    var stackWidgets = effective.stackWidgets;
    var smartStack = effective.smartStack;
    var show = stackWidgets.length >= 2 && (!smartStack || smartStack.showIndicators !== false);
    smartStackNav.hidden = !show;
    if (!show || typeof document.createElement !== "function") {
      clearChildren(smartStackNav);
      return;
    }
    clearChildren(smartStackNav);
    smartStackNav.appendChild(
      makeButton("smart-stack-btn", "Widget anterior da pilha", "▲", null, function () {
        stepSmartStack(-1);
      }),
    );
    var dots = document.createElement("div");
    dots.className = "smart-stack-dots";
    stackWidgets.forEach(function (key, index) {
      var active = index === activeStackIndex;
      dots.appendChild(
        makeButton(
          "smart-stack-dot" + (active ? " is-active" : ""),
          key + " (" + (index + 1) + "/" + stackWidgets.length + ")",
          "",
          active,
          function () {
            activeStackIndex = index;
            renderEffectiveView(true, config, false);
          },
        ),
      );
    });
    smartStackNav.appendChild(dots);
    smartStackNav.appendChild(
      makeButton("smart-stack-btn", "Próximo widget da pilha", "▼", null, function () {
        stepSmartStack(1);
      }),
    );
  }
  function renderPageNavigation(effective) {
    var pages = effective.pages;
    var hasMulti = Boolean(pages && pages.length > 1);
    var settings = config.pageSettings;
    if (pageNav) {
      var showBar = hasMulti;
      var showIndicators = !settings || settings.showIndicators !== false;
      pageNav.hidden = !showBar;
      clearChildren(pageNav);
      if (showBar && typeof document.createElement === "function") {
        pageNav.appendChild(
          makeButton("page-nav-btn", "Página anterior", "‹", null, function () {
            setPage(activePageIndex - 1);
          }),
        );
        if (showIndicators) {
          var dots = document.createElement("div");
          dots.className = "page-nav-dots";
          pages.forEach(function (p, index) {
            var active = index === effective.pageIndex;
            dots.appendChild(
              makeButton(
                "page-dot" + (active ? " is-active" : ""),
                p.title,
                "",
                active,
                function () {
                  setPage(index);
                },
              ),
            );
          });
          pageNav.appendChild(dots);
        }
        pageNav.appendChild(
          makeButton("page-nav-btn", "Próxima página", "›", null, function () {
            setPage(activePageIndex + 1);
          }),
        );
        pageNav.appendChild(
          makeButton(
            "page-overview-toggle",
            "Visão geral das páginas",
            effective.page ? effective.page.title : "Páginas",
            overviewOpen,
            function () {
              toggleOverview();
            },
          ),
        );
      }
    }
    if (pageOverview) {
      var showOverview = hasMulti && overviewOpen;
      pageOverview.hidden = !showOverview;
      clearChildren(pageOverview);
      if (showOverview && typeof document.createElement === "function") {
        var header = document.createElement("div");
        header.className = "page-overview-header";
        var titleEl = document.createElement("strong");
        titleEl.textContent = "Páginas do painel";
        header.appendChild(titleEl);
        header.appendChild(
          makeButton("page-overview-close", "Fechar visão geral", "✕", null, function () {
            toggleOverview(false);
          }),
        );
        pageOverview.appendChild(header);
        var grid = document.createElement("div");
        grid.className = "page-overview-grid";
        pages.forEach(function (p, index) {
          var active = index === effective.pageIndex;
          grid.appendChild(
            makeButton(
              "page-overview-card" + (active ? " is-active" : ""),
              p.title,
              p.title + " (" + p.enabledWidgets.length + ")",
              active,
              function () {
                overviewOpen = false;
                setPage(index);
              },
            ),
          );
        });
        pageOverview.appendChild(grid);
      }
    }
  }
  function scheduleInteractiveTimers(effective) {
    if (document.hidden) {
      clearInterval(pageTimer);
      pageTimer = null;
      clearInterval(stackTimer);
      stackTimer = null;
      return;
    }
    var pageSettings = config.pageSettings;
    var pageInterval =
      effective.pages &&
      effective.pages.length > 1 &&
      pageSettings &&
      pageSettings.autoRotateSeconds >= 5
        ? pageSettings.autoRotateSeconds
        : 0;
    var pageKey =
      (effective.page ? effective.page.id : "") +
      "|" +
      (effective.pages ? effective.pages.length : 0) +
      "|" +
      pageInterval;
    if (pageKey !== pageTimerKey || (pageInterval > 0 ? !pageTimer : !!pageTimer)) {
      clearInterval(pageTimer);
      pageTimer = null;
      pageTimerKey = pageKey;
      if (pageInterval > 0) {
        pageTimer = setInterval(function () {
          if (document.hidden || overviewOpen || Date.now() < interactionPausedUntil) return;
          setPage(activePageIndex + 1);
        }, pageInterval * 1000);
      }
    }
    var stackInterval =
      effective.stackWidgets.length >= 2 &&
      effective.smartStack &&
      effective.smartStack.intervalSeconds >= 5
        ? effective.smartStack.intervalSeconds
        : 0;
    var stackKey =
      (effective.page ? effective.page.id : "") +
      "|" +
      stackInterval +
      "|" +
      effective.stackWidgets.join(",");
    if (stackKey !== stackTimerKey || (stackInterval > 0 ? !stackTimer : !!stackTimer)) {
      clearInterval(stackTimer);
      stackTimer = null;
      stackTimerKey = stackKey;
      if (stackInterval > 0) {
        stackTimer = setInterval(function () {
          if (document.hidden || Date.now() < interactionPausedUntil) return;
          stepSmartStack(1);
        }, stackInterval * 1000);
      }
    }
  }
  function renderEffectiveView(relayoutCurrencies, old, appearanceChanged) {
    var effective = resolveEffectiveView(config);
    var appearance = config.appearance || {};
    var layoutChanged =
      !old ||
      changed(old._effectiveLayoutOptions, effective.layoutOptions) ||
      changed(old._effectiveGridLayout, effective.gridLayout) ||
      changed(old._effectiveStackWidgets, effective.stackWidgets);
    if (layoutChanged) {
      applyGridLayout(effective.gridLayout, effective.stackWidgets);
      dashboard.classList.toggle("photo-right", effective.layoutOptions.photoPosition === "right");
      dashboard.style.setProperty(
        "--photo-width",
        effective.layoutOptions.photoWidthPercent + "fr",
      );
      dashboard.style.setProperty(
        "--widget-width",
        100 - effective.layoutOptions.photoWidthPercent + "fr",
      );
      dashboard.style.setProperty(
        "--clock-normal",
        (100 - effective.layoutOptions.photoWidthPercent) * 0.13 + "vw",
      );
      dashboard.style.setProperty(
        "--clock-small",
        (100 - effective.layoutOptions.photoWidthPercent) * 0.11 + "vw",
      );
      dashboard.style.setProperty(
        "--clock-large",
        (100 - effective.layoutOptions.photoWidthPercent) * 0.15 + "vw",
      );
    }
    var visibleMap = {};
    var enabledMap = {};
    var stackSet = {};
    if (effective.stackWidgets.length >= 2)
      effective.stackWidgets.forEach(function (k) {
        stackSet[k] = true;
      });
    names.forEach(function (name) {
      var value = config.widgets[name];
      var isEnabled = Boolean(effective.enabledMap[name]);
      var isVisible = isEnabled && (!stackSet[name] || name === effective.activeStackWidget);
      visibleMap[name] = isVisible;
      enabledMap[name] = isEnabled;
      var el = document.getElementById(name);
      var widgetChanged =
        !old ||
        changed(old.widgets[name], value) ||
        Boolean(old._visibleMap && old._visibleMap[name] !== isVisible) ||
        Boolean(old._enabledMap && old._enabledMap[name] !== isEnabled);
      if (el) el.hidden = !isVisible;
      if (widgetChanged || appearanceChanged) {
        styleWidget(name, value, appearance);
        if (
          !old ||
          changed(old.widgets[name], value) ||
          Boolean(old._enabledMap && old._enabledMap[name] !== isEnabled)
        ) {
          var renderValue = Object.assign({}, value, { enabled: isEnabled });
          app[name === "photos" ? "carousel" : name].update(renderValue);
        }
      }
    });
    if (app.localWidgets)
      localNames.forEach(function (name) {
        var value = config.widgets[name];
        if (!value) return;
        var isEnabled = Boolean(effective.enabledMap[name]);
        var isVisible = isEnabled && (!stackSet[name] || name === effective.activeStackWidget);
        visibleMap[name] = isVisible;
        enabledMap[name] = isEnabled;
        var el = document.getElementById(name);
        var settingsChanged =
          !old ||
          !old.widgets[name] ||
          changed(old.widgets[name], value) ||
          old.timezone !== config.timezone ||
          Boolean(old._enabledMap && old._enabledMap[name] !== isEnabled);
        var viewChanged =
          settingsChanged ||
          appearanceChanged ||
          Boolean(old._visibleMap && old._visibleMap[name] !== isVisible);
        if (el) el.hidden = !isVisible;
        var renderer = localRenderers[name];
        if (!renderer) return;
        if (viewChanged) styleWidget(name, value, appearance);
        // Even an identical server snapshot can settle an optimistic task change.
        if (isEnabled && (settingsChanged || (name === "tasks" && old !== config)))
          renderer.update(value);
        if (viewChanged) {
          if (isVisible) renderer.resume();
          else renderer.pause();
        }
      });
    var anyWidgets =
      names.slice(1).some(function (name) {
        return Boolean(visibleMap[name]);
      }) ||
      (app.localWidgets &&
        localNames.some(function (name) {
          return Boolean(visibleMap[name]);
        }));
    stack.hidden = !anyWidgets;
    dashboard.classList.toggle("no-photos", !visibleMap.photos);
    dashboard.classList.toggle("no-widgets", !anyWidgets);
    var visible = Array.prototype.filter.call(stack.children, function (element) {
      return !element.hidden;
    });
    Array.prototype.forEach.call(stack.children, function (element) {
      element.classList.remove("last-visible");
    });
    if (visible.length) visible[visible.length - 1].classList.add("last-visible");
    renderSmartStackNav(effective);
    renderPageNavigation(effective);
    config._effectiveLayoutOptions = effective.layoutOptions;
    config._effectiveGridLayout = effective.gridLayout;
    config._effectiveStackWidgets = effective.stackWidgets;
    config._visibleMap = visibleMap;
    config._enabledMap = enabledMap;
    if (relayoutCurrencies) app.currencies.relayout();
    scheduleInteractiveTimers(effective);
    return effective;
  }
  function setPage(target) {
    if (!config || !Array.isArray(config.pages) || config.pages.length === 0) return;
    var pages = config.pages;
    if (typeof target === "string") {
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].id === target) {
          activePageIndex = i;
          activePageId = pages[i].id;
          activeStackIndex = 0;
          renderEffectiveView(true, config, false);
          return;
        }
      }
      return;
    }
    var count = pages.length;
    activePageIndex = ((target % count) + count) % count;
    activePageId = pages[activePageIndex].id;
    activeStackIndex = 0;
    renderEffectiveView(true, config, false);
  }
  function stepSmartStack(delta) {
    if (!config) return;
    var effective = resolveEffectiveView(config);
    if (effective.stackWidgets.length < 2) return;
    var count = effective.stackWidgets.length;
    activeStackIndex = (((activeStackIndex + delta) % count) + count) % count;
    renderEffectiveView(true, config, false);
  }
  function toggleOverview(force) {
    overviewOpen = typeof force === "boolean" ? force : !overviewOpen;
    if (config) renderPageNavigation(resolveEffectiveView(config));
  }
  function applyConfig(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return config;
    var old = config,
      next = app.normalizeConfig(input, old);
    if (typeof input.activePageId === "string" && Array.isArray(next.pages)) {
      for (var p = 0; p < next.pages.length; p++) {
        if (next.pages[p].id === input.activePageId) {
          activePageId = next.pages[p].id;
          activePageIndex = p;
          break;
        }
      }
    }
    if (!next.pages || next.pages.length <= 1) overviewOpen = false;
    config = next;
    var appearance = next.appearance || {};
    app.timezone = next.timezone || "";
    localContext.timezone = next.timezone || "America/Sao_Paulo";
    localContext.revision = next.revision || "";
    [
      ["--background", appearance.backgroundColor],
      ["--primary", appearance.accentColor],
      ["--weather-bg", appearance.accentColor],
      ["--text", appearance.textColor],
    ].forEach(function (entry) {
      if (entry[1]) document.body.style.setProperty(entry[0], entry[1]);
      else document.body.style.removeProperty(entry[0]);
    });
    var globalResolved = app.resolveAppearance ? app.resolveAppearance(appearance, null) : null;
    if (globalResolved) {
      if (globalResolved.pageEdgePadding !== null)
        dashboard.style.setProperty("--page-edge-padding", globalResolved.pageEdgePadding + "px");
      else dashboard.style.removeProperty("--page-edge-padding");
      if (globalResolved.widgetSpacing !== null)
        dashboard.style.setProperty("--widget-spacing", globalResolved.widgetSpacing + "px");
      else dashboard.style.removeProperty("--widget-spacing");
      if (dashboard.dataset) dashboard.dataset.surfaceMode = globalResolved.surfaceMode;
      dashboard.classList.toggle("surface-seamless", globalResolved.surfaceMode === "seamless");
    } else {
      dashboard.style.removeProperty("--page-edge-padding");
      dashboard.style.removeProperty("--widget-spacing");
      if (dashboard.dataset) delete dashboard.dataset.surfaceMode;
      dashboard.classList.remove("surface-seamless");
    }
    if (!old || old.theme !== next.theme)
      document.body.classList.toggle("theme-dark", next.theme === "dark");
    if (!old || old.orientation !== next.orientation)
      dashboard.classList.toggle("orientation-portrait", next.orientation === "portrait");
    var appearanceChanged = !old || changed(old.appearance, next.appearance);
    var shouldRelayout =
      !old ||
      old.orientation !== next.orientation ||
      changed(old.gridLayout, next.gridLayout) ||
      changed(old.layoutOptions, next.layoutOptions) ||
      changed(old.pages, next.pages) ||
      changed(old.smartStack, next.smartStack) ||
      names.some(function (name) {
        return old.widgets[name].enabled !== next.widgets[name].enabled;
      });
    renderEffectiveView(shouldRelayout, old, appearanceChanged);
    if (old && old.timezone !== next.timezone) {
      var effective = resolveEffectiveView(next);
      app.clock.update(
        Object.assign({}, next.widgets.clock, { enabled: Boolean(effective.enabledMap.clock) }),
      );
      app.calendar.update(
        Object.assign({}, next.widgets.calendar, {
          enabled: Boolean(effective.enabledMap.calendar),
        }),
      );
    }
    if (old && old.refreshSeconds !== next.refreshSeconds && !inFlight)
      schedule(next.refreshSeconds * 1000);
    if (input.widgetData && typeof input.widgetData === "object") {
      currenciesPending = input.widgetData.currenciesPending === true;
      rssPending = input.widgetData.rssPending === true;
      app.weather.setData(input.widgetData.weather);
      app.currencies.setData(input.widgetData.currencies);
      if (localRenderers.system && typeof localRenderers.system.setData === "function")
        localRenderers.system.setData(input.widgetData.system || null);
      if (localRenderers.rss && typeof localRenderers.rss.setData === "function")
        localRenderers.rss.setData(input.widgetData.rss || null);
      if (localRenderers.devMonitor && typeof localRenderers.devMonitor.setData === "function")
        localRenderers.devMonitor.setData(input.widgetData.devMonitor || null);
    }
    return config;
  }
  function schedule(delay) {
    if (preview) return;
    clearTimeout(pollTimer);
    if (!document.hidden) pollTimer = setTimeout(poll, delay);
  }
  async function poll() {
    if (preview) return;
    clearTimeout(pollTimer);
    if (document.hidden) return;
    if (inFlight) {
      refreshRequested = true;
      return;
    }
    inFlight = true;
    controller = new AbortController();
    var requestController = controller,
      timeout = setTimeout(function () {
        requestController.abort();
      }, 10000);
    try {
      var query = new URLSearchParams();
      if (deviceMatch) query.set("deviceId", deviceMatch[1]);
      if (appliedRevision) query.set("appliedRevision", appliedRevision);
      var queryString = query.toString();
      var response = await fetch("/api/player/config" + (queryString ? "?" + queryString : ""), {
        cache: "no-store",
        credentials: "same-origin",
        signal: requestController.signal,
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      var data = await response.json();
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        data.layout !== "photo-dashboard" ||
        !data.widgets ||
        typeof data.widgets !== "object" ||
        !data.widgets.photos ||
        typeof data.widgets.photos !== "object" ||
        !/^online:[A-Za-z0-9_-]+$/.test(data.revision || "")
      )
        throw new Error("Configuração inválida");
      if (!document.hidden && !requestController.signal.aborted) {
        if (!applyConfig(data)) throw new Error("Configuração inválida");
        if (typeof data.revision === "string") appliedRevision = data.revision;
        failures = 0;
        status.hidden = true;
      }
    } catch {
      if (!document.hidden && !refreshRequested) {
        failures++;
        status.hidden = false;
        status.textContent =
          failures === 1
            ? "Player offline ou não publicado. Verifique a conexão e a publicação no painel."
            : "Reconectando ao SmartFrame… Verifique se este player continua publicado.";
      }
    } finally {
      clearTimeout(timeout);
      inFlight = false;
      controller = null;
      if (!document.hidden) {
        if (refreshRequested) {
          refreshRequested = false;
          schedule(0);
        } else {
          var currenciesEnabled = currenciesEnabledOnAnyPage(config);
          schedule(
            failures
              ? Math.min(300000, 5000 * Math.pow(2, Math.min(failures - 1, 6)))
              : (currenciesEnabled && currenciesPending) || rssPending
                ? 2000
                : Math.min(config.refreshSeconds, currenciesEnabled ? 1800 : 3600) * 1000,
          );
        }
      }
    }
  }
  var swipeOrigin = null;
  function startedInWidget(target, name) {
    var el = document.getElementById(name);
    return Boolean(
      el && (target === el || (typeof el.contains === "function" && el.contains(target))),
    );
  }
  function startedInSmartStack(target) {
    if (!config) return false;
    var effective = resolveEffectiveView(config);
    if (effective.stackWidgets.length < 2) return false;
    for (var i = 0; i < effective.stackWidgets.length; i++) {
      if (startedInWidget(target, effective.stackWidgets[i])) return true;
    }
    return false;
  }
  if (typeof dashboard.addEventListener === "function") {
    dashboard.addEventListener("pointerdown", function (event) {
      pauseAutoRotation();
      if (!event || (event.button !== undefined && event.button !== 0)) return;
      swipeOrigin = {
        x: event.clientX,
        y: event.clientY,
        inStack: startedInSmartStack(event.target),
        inPhotos: startedInWidget(event.target, "photos"),
      };
    });
    dashboard.addEventListener("pointerup", function (event) {
      if (!swipeOrigin || !event || !config) {
        swipeOrigin = null;
        return;
      }
      var dx = event.clientX - swipeOrigin.x;
      var dy = event.clientY - swipeOrigin.y;
      var inStack = swipeOrigin.inStack;
      var inPhotos = swipeOrigin.inPhotos;
      swipeOrigin = null;
      var effective = resolveEffectiveView(config);
      if (
        inStack &&
        effective.stackWidgets.length >= 2 &&
        Math.abs(dy) >= 36 &&
        Math.abs(dy) > Math.abs(dx) * 1.5
      ) {
        stepSmartStack(dy < 0 ? 1 : -1);
        return;
      }
      var swipeEnabled = !config.pageSettings || config.pageSettings.swipeEnabled !== false;
      if (
        // Photo swipes belong to the carousel's touch handlers, not page navigation.
        !inPhotos &&
        swipeEnabled &&
        effective.pages &&
        effective.pages.length > 1 &&
        !overviewOpen &&
        Math.abs(dx) >= 48 &&
        Math.abs(dx) > Math.abs(dy) * 1.5
      ) {
        setPage(dx < 0 ? activePageIndex + 1 : activePageIndex - 1);
      }
    });
    dashboard.addEventListener("pointercancel", function () {
      swipeOrigin = null;
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      clearTimeout(pollTimer);
      clearInterval(pageTimer);
      pageTimer = null;
      clearInterval(stackTimer);
      stackTimer = null;
      if (controller) controller.abort();
      app.carousel.pause();
      app.currencies.pause();
      app.clock.pause();
      app.calendar.pause();
      localNames.forEach(function (name) {
        if (localRenderers[name]) localRenderers[name].pause();
      });
    } else {
      app.carousel.resume();
      app.currencies.resume();
      app.clock.resume();
      app.calendar.resume();
      localNames.forEach(function (name) {
        var visible = config._visibleMap ? config._visibleMap[name] : config.widgets[name].enabled;
        if (localRenderers[name] && visible) localRenderers[name].resume();
      });
      if (config) scheduleInteractiveTimers(resolveEffectiveView(config));
      if (!preview) poll();
    }
  });
  window.addEventListener("online", function () {
    if (!preview) poll();
  });
  window.applyConfig = applyConfig;
  app.applyConfig = applyConfig;
  app.setPage = setPage;
  app.stepSmartStack = stepSmartStack;
  app.toggleOverview = toggleOverview;
  app.getState = function () {
    var effective = config ? resolveEffectiveView(config) : null;
    return {
      activePageId: activePageId,
      activePageIndex: activePageIndex,
      activeStackIndex: activeStackIndex,
      overviewOpen: overviewOpen,
      stackWidgets: effective ? effective.stackWidgets.slice() : [],
    };
  };
  applyConfig(app.defaults);
  if (preview) {
    window.addEventListener("message", function (event) {
      if (
        window.parent === window ||
        event.source !== window.parent ||
        event.origin !== location.origin ||
        !event.data ||
        event.data.type !== "smartframe:online-preview"
      )
        return;
      var input = event.data.config;
      if (!input || typeof input !== "object") return;
      var items = input.widgets && input.widgets.photos && input.widgets.photos.items;
      if (Array.isArray(items))
        input.widgets.photos.items = items.map(function (item) {
          if (!item || typeof item.id !== "string") return item;
          return Object.assign({}, item, {
            src: "/api/photos/" + encodeURIComponent(item.id) + "/image",
          });
        });
      applyConfig(
        typeof event.data.activePageId === "string"
          ? Object.assign({}, input, { activePageId: event.data.activePageId })
          : input,
      );
    });
    if (window.parent !== window)
      window.parent.postMessage({ type: "smartframe:online-preview-ready" }, location.origin);
    return;
  }
  if (document.hidden) {
    app.carousel.pause();
    app.currencies.pause();
    app.clock.pause();
    app.calendar.pause();
  } else poll();
})(window.SmartFrame);
