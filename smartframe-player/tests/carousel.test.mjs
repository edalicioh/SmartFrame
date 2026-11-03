import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../js/carousel.js", import.meta.url), "utf8");

function harness(result = () => ({ ok: true, delay: 0 })) {
  let now = 0,
    sequence = 0;
  const timers = new Map(),
    requests = [];
  function later(fn, delay) {
    const id = ++sequence;
    timers.set(id, { fn, at: now + delay });
    return id;
  }
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const entry = [...timers]
        .filter(([, value]) => value.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!entry) break;
      timers.delete(entry[0]);
      now = entry[1].at;
      entry[1].fn();
    }
    now = end;
  }
  class Element {
    constructor() {
      const classes = new Set();
      this.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)),
        contains: (name) => classes.has(name),
      };
      this.listeners = {};
      this.children = [];
      this.onload = this.onerror = null;
    }
    set src(value) {
      timers.delete(this.loadId);
      this.url = value;
      requests.push({ src: value, at: now });
      const response = result(value, requests.filter((x) => x.src === value).length);
      this.loadId = later(() => {
        const callback = response.ok ? this.onload : this.onerror;
        if (callback) callback();
      }, response.delay);
    }
    get src() {
      return this.url;
    }
    removeAttribute(name) {
      if (name === "src") {
        timers.delete(this.loadId);
        this.url = undefined;
      }
    }
    setAttribute() {}
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    appendChild(child) {
      this.children.push(child);
    }
  }
  const images = [new Element(), new Element()];
  const elements = Object.fromEntries(
    ["photos", "photo-message", "photo-indicators", "photo-previous", "photo-next"].map((name) => [
      name,
      new Element(),
    ]),
  );
  elements.photos.querySelectorAll = () => images;
  const app = {};
  runInNewContext(source, {
    window: { SmartFrame: app },
    document: { getElementById: (id) => elements[id], createElement: () => new Element() },
    setTimeout: later,
    clearTimeout: (id) => timers.delete(id),
  });
  function update(items, intervalSeconds = 5) {
    app.carousel.update({
      enabled: true,
      fit: "cover",
      intervalSeconds,
      items: items.map((id) => ({ id, src: "/" + id, alt: id })),
    });
  }
  return {
    app,
    images,
    requests,
    advance,
    update,
    displayed: () => images.find((image) => image.classList.contains("is-current"))?.alt,
    click: (id) => elements[id].listeners.click(),
  };
}

test("preloads only the next image and switches at the configured deadline", () => {
  const h = harness((src) => ({ ok: true, delay: src === "/b" ? 2000 : 0 }));
  h.update(["a", "b", "c"]);
  h.advance(0);
  assert.equal(h.displayed(), "a");
  h.advance(350);
  assert.deepEqual(
    h.requests.map((x) => x.src),
    ["/a", "/b"],
  );
  h.advance(4649);
  assert.equal(h.displayed(), "a");
  h.advance(1);
  assert.equal(h.displayed(), "b");
  assert.equal(h.images.length, 2);
  h.advance(350);
  assert.deepEqual(
    h.requests.map((x) => x.src),
    ["/a", "/b", "/c"],
  );
});

test("spaces failures, caps attempts per cycle and continues through a large stale list", () => {
  const h = harness(() => ({ ok: false, delay: 0 }));
  h.update(Array.from({ length: 100 }, (_, i) => String(i)));
  h.advance(1000);
  assert.deepEqual(
    h.requests.map((x) => x.at),
    [0, 250, 500],
  );
  h.advance(4500);
  assert.equal(h.requests[3].src, "/3");
  assert.equal(h.requests[3].at, 5500);
});

test("previous navigation skips failures in the requested direction", () => {
  const h = harness((src) => ({ ok: src !== "/bad", delay: 0 }));
  h.update(["a", "bad", "b"]);
  h.advance(0);
  h.update(["b", "a", "bad"]);
  h.click("photo-previous");
  h.advance(0);
  assert.equal(h.displayed(), "b");
  h.click("photo-previous");
  h.advance(250);
  assert.equal(h.displayed(), "a");
});

test("retries a single replacement after transient failure", () => {
  const h = harness((src, count) => ({ ok: src !== "/flaky" || count > 1, delay: 0 }));
  h.update(["a"]);
  h.advance(0);
  h.update(["flaky"]);
  h.advance(0);
  assert.equal(h.displayed(), "a");
  h.advance(5000);
  assert.equal(h.displayed(), "flaky");
});

test("pausing cancels a pending preload and restarting uses only one slide timer", () => {
  const h = harness((src) => ({ ok: true, delay: src === "/b" ? 2000 : 0 }));
  h.update(["a", "b"]);
  h.advance(350);
  h.app.carousel.pause();
  h.advance(20000);
  assert.equal(h.displayed(), "a");
  assert.equal(h.requests.length, 2);
  h.app.carousel.resume();
  h.advance(4999);
  assert.equal(h.displayed(), "a");
  h.advance(1);
  assert.equal(h.displayed(), "b");
});

test("repeated interval updates preserve an already prepared image", () => {
  const h = harness();
  h.update(["a", "b"]);
  h.advance(350);
  for (let i = 0; i < 5; i++) h.update(["a", "b"], 10);
  h.advance(9999);
  assert.equal(h.displayed(), "a");
  h.advance(1);
  assert.equal(h.displayed(), "b");
  assert.equal(h.requests.filter((x) => x.src === "/b").length, 1);
});

test("replacing the list discards the old preload and releases the outgoing image", () => {
  const h = harness((src) => ({ ok: true, delay: src === "/b" ? 2000 : 0 }));
  h.update(["a", "b"]);
  h.advance(350);
  h.update(["c"]);
  h.advance(350);
  assert.equal(h.displayed(), "c");
  assert.equal(h.images.filter((image) => image.src).length, 1);
  h.advance(10000);
  assert.equal(h.displayed(), "c");
});
