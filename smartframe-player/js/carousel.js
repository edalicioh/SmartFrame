(function (app) {
  "use strict";
  var panel = document.getElementById("photos"),
    images = panel.querySelectorAll(".photo-image");
  var message = document.getElementById("photo-message"),
    indicators = document.getElementById("photo-indicators");
  var previous = document.getElementById("photo-previous"),
    next = document.getElementById("photo-next");
  var config,
    current = null,
    active = 0,
    timer = null,
    loadingTimer = null,
    retryTimer = null,
    preloadTimer = null,
    pending = null,
    retryIndex = null,
    startX = null,
    paused = false;
  var maxAttempts = 3;

  function same(a, b) {
    return a && b && a.id === b.id && a.src === b.src;
  }
  function available() {
    return config && config.enabled && !paused && config.items.length;
  }
  function stop() {
    clearTimeout(timer);
    timer = null;
  }
  function cancelLoad() {
    clearTimeout(loadingTimer);
    clearTimeout(retryTimer);
    clearTimeout(preloadTimer);
    loadingTimer = retryTimer = preloadTimer = null;
    pending = null;
    var image = images[1 - active];
    image.onload = image.onerror = null;
    image.removeAttribute("src");
  }
  function currentIndex() {
    return config.items.findIndex(function (item) {
      return same(current, item);
    });
  }
  function schedule() {
    stop();
    if (!available() || (pending && pending.requested)) return;
    var missing = currentIndex() < 0;
    if (config.items.length > 1 || missing)
      timer = setTimeout(
        function () {
          timer = null;
          if (pending) {
            pending.requested = true;
            if (pending.ready) activate(pending);
          } else begin(retryIndex === null ? currentIndex() + 1 : retryIndex, 1, true);
        },
        (missing ? Math.min(config.intervalSeconds, 30) : config.intervalSeconds) * 1000,
      );
  }
  function renderIndicators() {
    indicators.textContent = "";
    var items = config.items;
    previous.hidden = next.hidden = items.length < 2;
    if (items.length > 30) return;
    items.forEach(function (item, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", "Foto " + (index + 1));
      if (same(current, item)) {
        button.className = "active";
        button.setAttribute("aria-current", "true");
      }
      button.addEventListener("click", function () {
        show(index, 1);
      });
      indicators.appendChild(button);
    });
  }
  function queuePreload() {
    clearTimeout(preloadTimer);
    if (!available() || currentIndex() < 0) return;
    // Let the outgoing image finish its fade before reusing its buffer.
    preloadTimer = setTimeout(function () {
      preloadTimer = null;
      if (available() && !pending) {
        if (config.items.length > 1) begin(currentIndex() + 1, 1, false);
        else images[1 - active].removeAttribute("src");
      }
    }, 350);
  }
  function activate(operation) {
    if (pending !== operation || !operation.ready || !available()) return;
    var image = images[1 - active];
    image.alt = operation.item.alt;
    images[active].classList.remove("is-current");
    image.classList.add("is-current");
    active = 1 - active;
    current = operation.item;
    pending = null;
    retryIndex = null;
    message.hidden = true;
    renderIndicators();
    schedule();
    queuePreload();
  }
  function failed(operation, index) {
    if (pending !== operation) return;
    retryIndex = index;
    pending = null;
    images[1 - active].removeAttribute("src");
    message.textContent = current
      ? "Algumas fotos estão indisponíveis"
      : "Não foi possível carregar as fotos";
    message.hidden = false;
    // A background failure must not postpone the already scheduled slide deadline.
    if (timer === null) schedule();
  }
  function loadCandidate(operation, index) {
    if (pending !== operation || !available()) return;
    var items = config.items,
      i = ((index % items.length) + items.length) % items.length,
      item = items[i];
    if (operation.attempts >= Math.min(maxAttempts, items.length) || same(current, item)) {
      failed(
        operation,
        same(current, item) ? (i + operation.direction + items.length) % items.length : i,
      );
      return;
    }
    operation.attempts++;
    var image = images[1 - active],
      done = false;
    function finish(ok) {
      if (done || pending !== operation) return;
      done = true;
      clearTimeout(loadingTimer);
      image.onload = image.onerror = null;
      if (!ok) {
        image.removeAttribute("src");
        var following = i + operation.direction;
        if (operation.attempts >= Math.min(maxAttempts, items.length)) {
          failed(operation, ((following % items.length) + items.length) % items.length);
        } else {
          // Space errors apart and cap each cycle, even for very large stale albums.
          retryTimer = setTimeout(function () {
            loadCandidate(operation, following);
          }, 250);
        }
        return;
      }
      operation.item = item;
      operation.ready = true;
      if (operation.requested) activate(operation);
    }
    image.onload = function () {
      finish(true);
    };
    image.onerror = function () {
      finish(false);
    };
    loadingTimer = setTimeout(function () {
      finish(false);
    }, 8000);
    image.src = item.src;
  }
  function begin(index, direction, requested) {
    if (!available()) return;
    cancelLoad();
    var operation = {
      start: (index + config.items.length) % config.items.length,
      direction: direction,
      requested: requested,
      attempts: 0,
      ready: false,
    };
    pending = operation;
    if (requested) stop();
    loadCandidate(operation, index);
  }
  function show(index, direction) {
    if (!available()) return;
    if (same(current, config.items[index])) return;
    if (pending && pending.start === index && pending.direction === direction) {
      stop();
      pending.requested = true;
      if (pending.ready) activate(pending);
    } else begin(index, direction, true);
  }
  function move(step) {
    if (!available()) return;
    var index = currentIndex();
    show((index + step + config.items.length) % config.items.length, step);
  }
  previous.addEventListener("click", function () {
    move(-1);
  });
  next.addEventListener("click", function () {
    move(1);
  });
  panel.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length === 1) startX = e.touches[0].clientX;
    },
    { passive: true },
  );
  panel.addEventListener(
    "touchend",
    function (e) {
      if (startX !== null && e.changedTouches.length) {
        var delta = e.changedTouches[0].clientX - startX;
        if (Math.abs(delta) > 45) move(delta < 0 ? 1 : -1);
      }
      startX = null;
    },
    { passive: true },
  );
  panel.addEventListener(
    "touchcancel",
    function () {
      startX = null;
    },
    { passive: true },
  );
  app.carousel = {
    update: function (value) {
      var old = config;
      config = value;
      panel.classList.toggle("fit-contain", value.fit === "contain");
      var listChanged = !old || JSON.stringify(old.items) !== JSON.stringify(value.items);
      if (listChanged || !old || old.enabled !== value.enabled) {
        cancelLoad();
        stop();
        retryIndex = null;
        if (!value.items.length) {
          current = null;
          images.forEach(function (image) {
            image.classList.remove("is-current");
            image.removeAttribute("src");
          });
          message.textContent = "Nenhuma foto disponível";
          message.hidden = false;
        } else if (available()) {
          if (currentIndex() < 0) begin(0, 1, true);
          else queuePreload();
        }
        renderIndicators();
      }
      if (
        !old ||
        old.intervalSeconds !== value.intervalSeconds ||
        listChanged ||
        old.enabled !== value.enabled
      )
        schedule();
    },
    pause: function () {
      paused = true;
      stop();
      cancelLoad();
    },
    resume: function () {
      paused = false;
      if (!available()) return;
      if (currentIndex() < 0) begin(0, 1, true);
      else {
        schedule();
        queuePreload();
      }
    },
  };
})(window.SmartFrame);
