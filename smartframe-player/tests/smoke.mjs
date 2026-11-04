// Teste local sem dependências: CHROME_BIN pode apontar para Chrome ou Edge.
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmOkAAAAASUVORK5CYII=",
  "base64",
);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
let requests = 0,
  flakyRequests = 0;
const unavailableRequests = [];
const widgetData = {
  refreshSeconds: 1800,
  weather: {
    city: "Camboriú",
    temperature: 22.1,
    minimum: 16,
    maximum: 24,
    weatherCode: 2,
    source: "Open-Meteo",
    updatedAt: new Date().toISOString(),
    stale: false,
  },
  currencies: {
    "USD/BRL": {
      value: 5.4,
      source: "Coinbase",
      updatedAt: new Date().toISOString(),
      stale: false,
    },
    "EUR/BRL": {
      value: 6,
      source: "Coinbase",
      updatedAt: new Date().toISOString(),
      stale: false,
    },
    "BTC/BRL": {
      value: 350000,
      source: "Coinbase",
      referenceDate: null,
      updatedAt: new Date().toISOString(),
      stale: false,
    },
  },
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/player/config") {
    requests++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        revision: "online:browser-test",
        layout: "photo-dashboard",
        refreshSeconds: 60,
        widgetData,
        widgets: {
          photos: {
            items: [
              { id: "a", src: "/a.png", alt: "A" },
              { id: "b", src: "/b.png", alt: "B" },
            ],
          },
        },
      }),
    );
    return;
  }
  if (url.pathname === "/a.png" || url.pathname === "/b.png") {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(png);
    return;
  }
  if (url.pathname === "/flaky.png") {
    flakyRequests++;
    res.writeHead(flakyRequests === 1 ? 503 : 200, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    });
    res.end(flakyRequests === 1 ? "" : png);
    return;
  }
  if (url.pathname.startsWith("/unavailable/")) {
    unavailableRequests.push(Date.now());
    res.writeHead(404, { "Cache-Control": "no-store" });
    res.end();
    return;
  }
  try {
    const name = url.pathname.replace(/^\/player-dashboard\//, "") || "index.html";
    const path = resolve(root, name);
    if (!path.startsWith(root + "\\") && !path.startsWith(root + "/"))
      throw new Error("Invalid path");
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const profile = await mkdtemp(join(tmpdir(), "smartframe-browser-"));
const executable =
  process.env.CHROME_BIN ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "chromium");
const browser = spawn(
  executable,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
let socket;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try {
      port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
    } catch {
      await sleep(100);
    }
  }
  if (!port) throw new Error("Não foi possível iniciar o navegador; defina CHROME_BIN.");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((yes, no) => {
    socket.onopen = yes;
    socket.onerror = no;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const response = JSON.parse(event.data);
    if (!response.id || !pending.has(response.id)) return;
    const { yes, no } = pending.get(response.id);
    pending.delete(response.id);
    if (response.error) no(new Error(response.error.message));
    else yes(response.result);
  };
  function call(method, params = {}) {
    return new Promise((yes, no) => {
      const command = ++id;
      pending.set(command, { yes, no });
      socket.send(JSON.stringify({ id: command, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  await call("Page.enable");
  await call("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}/player-dashboard/`,
  });
  for (let i = 0; i < 100; i++) {
    if (
      await evaluate(
        'document.readyState === "complete" && typeof window.applyConfig === "function" && !!document.querySelector(".photo-image.is-current[src]") && document.querySelector(".photo-image.is-current[src]").complete',
      )
    )
      break;
    await sleep(100);
  }
  assert.ok(requests > 0, "configuração solicitada");
  assert.equal(
    await evaluate(`document.querySelector('#weather-temperature').textContent`),
    "22°",
    "temperatura recebida do backend",
  );
  assert.equal(
    await evaluate(`document.querySelector('.currency-value').textContent.replace(/\\s/g,' ')`),
    "5,40",
    "cotação recebida do backend",
  );
  assert.equal(
    await evaluate(
      `!document.querySelector('#currencies-status') && !document.querySelector('#currencies .card-label') && !document.querySelector('#currencies .currency-change') && [...document.querySelectorAll('.currency-item')].every(item => item.querySelector('.currency-header') && item.querySelector('.currency-body'))`,
    ),
    true,
    "cartão sem variação mostra o par e o valor",
  );
  assert.equal(
    await evaluate(`(() => {
      const item = document.querySelector('.currency-item');
      const card = document.querySelector('#currencies').getBoundingClientRect();
      const list = document.querySelector('#currency-list').getBoundingClientRect();
      return getComputedStyle(item).textAlign === 'left' &&
        Math.abs((list.top + list.bottom) / 2 - (card.top + card.bottom) / 2) < 1;
    })()`),
    true,
    "par e valor alinhados à esquerda no cartão",
  );
  assert.equal(
    await evaluate(`(() => {
      applyConfig({widgets:{currencies:{pairs:['BTC/USD'],displayCount:1}},widgetData:{currencies:{'BTC/USD':{value:65000,source:'Coinbase',updatedAt:new Date().toISOString(),stale:false,changePercent:1.19,changePeriod:'24h'}}}});
      return document.querySelector('.currency-code').textContent === 'BTC / USD' &&
        document.querySelector('.currency-value').textContent.replace(/\u00a0/g,' ') === '65.000,00' &&
        document.querySelector('.currency-change').textContent === '+1,19%' &&
        document.querySelector('.currency-indicator').getAttribute('aria-label') === 'Alta em 24 horas';
    })()`),
    true,
    "par BTC/USD exibe cotação e variação de 24 horas",
  );
  await evaluate(
    `applyConfig({widgets:{currencies:{pairs:['USD/BRL','EUR/BRL','BTC/BRL'],displayCount:2}},widgetData:${JSON.stringify(widgetData)}})`,
  );
  assert.equal(
    await evaluate(`(() => {
      applyConfig({widgets:{
        photos:{backgroundColor:'#123456'},
        clock:{backgroundColor:'#ffffff',cardSize:'small'},
        weather:{backgroundColor:'#000000',cardSize:'large'},
        currencies:{backgroundColor:'#abcdef',cardSize:'large'},
        calendar:{backgroundColor:'#202020',cardSize:'small'}
      }});
      const style = selector => getComputedStyle(document.querySelector(selector));
      const smallHeight = document.querySelector('#clock').getBoundingClientRect().height;
      const colorsOk = style('#photos').backgroundColor === 'rgb(18, 52, 86)' &&
        style('#clock').backgroundColor === 'rgb(255, 255, 255)' &&
        style('#clock').color === 'rgb(23, 32, 51)' &&
        style('#weather').backgroundColor === 'rgb(0, 0, 0)' &&
        style('#weather').color === 'rgb(255, 255, 255)' &&
        style('.currency-item').backgroundColor === 'rgb(171, 205, 239)' &&
        style('#calendar').backgroundColor === 'rgb(32, 32, 32)';
      applyConfig({widgets:{clock:{cardSize:'large'}}});
      const larger = document.querySelector('#clock').getBoundingClientRect().height > smallHeight;
      applyConfig({widgets:{photos:{backgroundColor:''},clock:{backgroundColor:'',cardSize:'normal'},weather:{backgroundColor:'',cardSize:'normal'},currencies:{backgroundColor:'',cardSize:'normal'},calendar:{backgroundColor:'',cardSize:'normal'}}});
      return colorsOk && larger && style('.currency-item').backgroundColor === 'rgb(34, 35, 38)';
    })()`),
    true,
    "fundos e tamanhos independentes aplicam, contrastam e voltam ao padrão",
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const small of ["clock", "weather", "currencies", "calendar"]) {
    const escaped = await evaluate(`(() => {
      const widgets = Object.fromEntries(['clock','weather','currencies','calendar'].map(name =>
        [name, {cardSize: name === ${JSON.stringify(small)} ? 'small' : 'large'}]));
      applyConfig({widgets});
      return [...document.querySelectorAll('.widget-stack .card:not([hidden])')].flatMap(card => {
        const outer = card.getBoundingClientRect();
        return [...card.querySelectorAll('*')].filter(el => {
          if (!el.getClientRects().length) return false;
          const r = el.getBoundingClientRect();
          return r.left < outer.left - 1 || r.right > outer.right + 1 || r.top < outer.top - 1 || r.bottom > outer.bottom + 1;
        }).map(el => card.id + ':' + (el.className || el.tagName));
      });
    })()`);
    assert.deepEqual(escaped, [], `widgets não transbordam com ${small} pequeno`);
  }
  await evaluate(
    `applyConfig({widgets:{clock:{cardSize:'normal'},weather:{cardSize:'normal'},currencies:{cardSize:'normal'},calendar:{cardSize:'normal'}}})`,
  );
  assert.equal(
    await evaluate(
      `(() => { applyConfig({widgetData:{weather:${JSON.stringify({ ...widgetData.weather, temperature: 23, stale: true })},currencies:${JSON.stringify(widgetData.currencies)}}}); return document.querySelector('#weather-temperature').textContent==='23°' && document.querySelector('#weather').getAttribute('aria-label').includes('dados anteriores'); })()`,
    ),
    true,
    "atualização de dados não depende de mudança da configuração",
  );
  await sleep(500);
  assert.equal(
    await evaluate(
      `(() => { const next = document.querySelector('.photo-image:not(.is-current)'); return next.getAttribute('src') === '/b.png' && next.complete && next.naturalWidth > 0 && document.querySelector('.photo-image.is-current').alt === 'A'; })()`,
    ),
    true,
    "próxima foto carregada antes do intervalo, sem trocar a atual",
  );
  assert.equal(
    await evaluate(`(() => {
      applyConfig({widgets:{photos:{fit:'contain'}}});
      const photo = document.querySelector('.photo-image.is-current');
      const background = document.querySelector('.photo-backdrop.is-current');
      const style = getComputedStyle(background);
      return background.getAttribute('src') === photo.getAttribute('src') &&
        background.alt === '' && background.getAttribute('aria-hidden') === 'true' &&
        style.display === 'block' && style.objectFit === 'cover' && style.filter === 'blur(20px)' &&
        getComputedStyle(photo).objectFit === 'contain' && getComputedStyle(photo).filter === 'none' &&
        getComputedStyle(document.querySelector('.photo-stage')).overflow === 'hidden' &&
        getComputedStyle(document.querySelector('#photos')).overflow === 'hidden';
    })()`),
    true,
    "conter mantém foto nítida e inteira sobre cópia desfocada, recortada dentro do painel",
  );
  await evaluate(
    `applyConfig({widgetData:{weather:${JSON.stringify(widgetData.weather)},currencies:${JSON.stringify(
      {
        ...widgetData.currencies,
        "USD/BRL": {
          ...widgetData.currencies["USD/BRL"],
          changePercent: 1.19,
          changePeriod: "24h",
        },
        "EUR/BRL": {
          ...widgetData.currencies["EUR/BRL"],
          changePercent: -1.19,
          changePeriod: "24h",
        },
      },
    )}}})`,
  );
  for (const [width, height] of [
    [1024, 600],
    [800, 480],
    [1280, 800],
    [600, 1024],
  ]) {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(100);
    for (let percent = 40; percent <= 75; percent++) {
      await evaluate(
        `applyConfig({layoutOptions:{photoWidthPercent:${percent}},widgets:{photos:{enabled:true},clock:{enabled:true,size:'large',format:'12h',showDate:true},weather:{enabled:true,city:'Cidade '.repeat(11).trim()},currencies:{enabled:true},calendar:{enabled:true}}}); document.querySelector('#clock-time').textContent='11:59 AM'`,
      );
      const result = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.photo-panel, .widget-stack .card')].filter(x => !x.hidden);
      const boxes = cards.map(x => { const r = x.getBoundingClientRect(); return { id: x.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, scroll: x.scrollHeight > x.clientHeight + 1 || x.scrollWidth > x.clientWidth + 1, scrollWidth: x.scrollWidth, clientWidth: x.clientWidth, scrollHeight: x.scrollHeight, clientHeight: x.clientHeight }; });
      const escaped = [...document.querySelectorAll('.widget-stack .card:not([hidden])')].flatMap(card => { const outer = card.getBoundingClientRect(); return [...card.querySelectorAll('*')].filter(el => { if (!el.getClientRects().length) return false; const r=el.getBoundingClientRect(); return r.left < outer.left - 1 || r.right > outer.right + 1 || r.top < outer.top - 1 || r.bottom > outer.bottom + 1; }).map(el => ({card:card.id, element:el.id || el.className || el.tagName, rect:el.getBoundingClientRect().toJSON(), outer:outer.toJSON()})); });
      return { documentScroll: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth, weatherChildren: [...document.querySelector('#weather').children].map(x => x.id), boxes, escaped };
    })()`);
      assert.ok(
        await evaluate(
          `parseFloat(getComputedStyle(document.querySelector('.currency-value')).fontSize) >= 22`,
        ),
        "cotação com fonte ampliada para leitura",
      );
      assert.deepEqual(
        result.weatherChildren,
        ["weather-temperature", "weather-range"],
        "clima contém somente temperatura atual e máxima/mínima, sem cidade ou rótulos",
      );
      assert.deepEqual(
        result.escaped,
        [],
        `${width}x${height} ${percent}%: descendentes fora do cartão`,
      );
      assert.equal(result.documentScroll, false, `${width}x${height}: rolagem da página`);
      for (const box of result.boxes) {
        assert.ok(
          box.width > 0 &&
            box.height > 0 &&
            box.left >= 0 &&
            box.top >= 0 &&
            box.right <= width &&
            box.bottom <= height,
          JSON.stringify(box),
        );
        assert.equal(
          box.scroll,
          false,
          `${width}x${height} ${percent}%: conteúdo cortado ${JSON.stringify(box)}`,
        );
      }
      for (let i = 0; i < result.boxes.length; i++)
        for (let j = i + 1; j < result.boxes.length; j++) {
          const a = result.boxes[i],
            b = result.boxes[j];
          assert.ok(
            a.right <= b.left + 1 ||
              b.right <= a.left + 1 ||
              a.bottom <= b.top + 1 ||
              b.bottom <= a.top + 1,
            `sobreposição: ${a.id}, ${b.id}`,
          );
        }
    }
    assert.equal(
      await evaluate(`(() => {
        applyConfig({widgets:{clock:{showDate:false}}});
        const card = document.querySelector('#clock').getBoundingClientRect();
        const time = document.querySelector('#clock-time').getBoundingClientRect();
        return !document.querySelector('#clock-date') &&
          Math.abs((time.left + time.right) / 2 - (card.left + card.right) / 2) < 1 &&
          Math.abs((time.top + time.bottom) / 2 - (card.top + card.bottom) / 2) < 1;
      })()`),
      true,
      `${width}x${height}: horário centralizado sem data`,
    );
    assert.equal(
      await evaluate(`(() => {
        applyConfig({widgets:{clock:{showDate:true}}});
        return !document.querySelector('#clock-date') &&
          document.querySelector('#clock').children.length === 1 &&
          document.querySelector('#clock').classList.contains('clock-time-only') &&
          SmartFrame.normalizeConfig({widgets:{clock:{showDate:true}}}).widgets.clock.showDate === false;
      })()`),
      true,
      "configurações antigas não podem reintroduzir a data no relógio",
    );
    console.log(`Layout ${width}x${height}: OK`);
  }
  assert.equal(
    await evaluate(
      `(() => { applyConfig({widgets:{clock:{format:'12h',showDate:false},photos:{intervalSeconds:30}}}); applyConfig({widgets:{weather:{enabled:false}}}); return document.querySelector('#weather').hidden && !document.querySelector('#clock-date') && SmartFrame.normalizeConfig({}).widgets.photos.intervalSeconds === 15; })()`,
    ),
    true,
  );
  assert.equal(
    await evaluate(
      `(() => { applyConfig({layoutOptions:{photoPosition:'right',photoWidthPercent:70}}); return document.querySelector('#dashboard').classList.contains('photo-right'); })()`,
    ),
    true,
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 800,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(
    await evaluate(
      `(() => { const p=document.querySelector('#photos').getBoundingClientRect(), s=document.querySelector('#widget-stack').getBoundingClientRect(); return p.left > s.right && p.width > s.width * 2; })()`,
    ),
    true,
    "posição e proporção aplicadas sob CSP",
  );
  assert.equal(
    await evaluate(
      `(() => { applyConfig({layoutOptions:{photoWidthPercent:75}}); return document.querySelectorAll('.currency-item').length; })()`,
    ),
    1,
    "moedas reagrupadas ao estreitar",
  );
  assert.equal(
    await evaluate(
      `(() => { applyConfig({layoutOptions:{photoWidthPercent:40}}); return document.querySelectorAll('.currency-item').length; })()`,
    ),
    2,
    "moedas reagrupadas ao alargar",
  );
  assert.equal(
    await evaluate(
      `(() => { applyConfig({layoutOptions:{photoWidthPercent:75}}); applyConfig({widgets:{photos:{enabled:false}}}); return document.querySelectorAll('.currency-item').length; })()`,
    ),
    2,
    "moedas reagrupadas ao ocultar fotos",
  );
  assert.equal(
    await evaluate(
      `(() => { applyConfig({widgets:{photos:{enabled:true}}}); return document.querySelectorAll('.currency-item').length; })()`,
    ),
    1,
    "moedas reagrupadas ao mostrar fotos",
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('#calendar-days .calendar-day').length`),
    42,
  );
  assert.equal(
    await evaluate(
      `(() => { const now = new Date(); const months = (now.getFullYear() - 2024) * 12 + now.getMonth() - 1; for (let i = 0; i < Math.abs(months); i++) document.querySelector(months > 0 ? '#calendar-previous' : '#calendar-next').click(); return [...document.querySelectorAll('#calendar-days .calendar-day:not(.adjacent)')].some(x => x.textContent === '29') && document.querySelector('#calendar-today').textContent.includes('2024'); })()`,
    ),
    true,
    "fevereiro bissexto",
  );
  await evaluate(`document.querySelector('#calendar-today').click()`);
  await evaluate(`document.querySelector('#photo-next').click()`);
  await sleep(300);
  assert.equal(await evaluate(`document.querySelector('.photo-image.is-current').alt`), "B");
  assert.equal(
    await evaluate(`document.querySelector('.photo-backdrop.is-current').getAttribute('src')`),
    "/b.png",
    "fundo desfocado acompanha a navegação do carrossel",
  );
  assert.equal(
    await evaluate(`(() => {
      applyConfig({widgets:{photos:{fit:'cover'}}});
      return [...document.querySelectorAll('.photo-backdrop')].every(background =>
        !background.hasAttribute('src') && getComputedStyle(background).display === 'none') &&
        getComputedStyle(document.querySelector('.photo-image.is-current')).objectFit === 'cover';
    })()`),
    true,
    "preencher mantém o comportamento original, sem fundo desfocado",
  );
  await evaluate(
    `applyConfig({widgets:{photos:{items:[{id:'b',src:'/b.png',alt:'B'},{id:'a',src:'/a.png',alt:'A'}]}}})`,
  );
  assert.equal(await evaluate(`document.querySelector('.photo-image.is-current').alt`), "B");
  await evaluate(
    `applyConfig({widgets:{photos:{items:[{id:'bad',src:'/missing.png',alt:'Inválida'},{id:'b',src:'/b.png',alt:'B'}]}}}); document.querySelector('#photo-next').click()`,
  );
  await sleep(300);
  assert.equal(
    await evaluate(`document.querySelector('.photo-image.is-current').alt`),
    "B",
    "foto atual preservada após falha",
  );
  await evaluate(
    `applyConfig({widgets:{photos:{items:[{id:'a',src:'/a.png',alt:'A'},{id:'bad',src:'/missing.png',alt:'Inválida'},{id:'b',src:'/b.png',alt:'B'}]}}}); document.querySelector('#photo-previous').click()`,
  );
  await sleep(300);
  assert.equal(
    await evaluate(`document.querySelector('.photo-image.is-current').alt`),
    "A",
    "anterior ignora foto inválida na mesma direção",
  );
  await evaluate(`document.querySelector('#photo-next').click()`);
  await sleep(300);
  await evaluate(
    `(() => { const p=document.querySelector('#photos'); p.dispatchEvent(new TouchEvent('touchstart',{touches:[new Touch({identifier:1,target:p,clientX:10})]})); p.dispatchEvent(new TouchEvent('touchend',{changedTouches:[new Touch({identifier:1,target:p,clientX:100})]})); })()`,
  );
  await sleep(300);
  assert.equal(
    await evaluate(`document.querySelector('.photo-image.is-current').alt`),
    "A",
    "deslizar para trás ignora foto inválida",
  );
  await evaluate(
    `applyConfig({widgets:{photos:{items:[{id:'flaky',src:'/flaky.png',alt:'Recuperada'}],intervalSeconds:5}}})`,
  );
  await sleep(300);
  assert.equal(
    await evaluate(`document.querySelector('.photo-image.is-current').alt`),
    "A",
    "mantém foto removida durante falha",
  );
  await sleep(5300);
  assert.equal(
    await evaluate(`document.querySelector('.photo-image.is-current').alt`),
    "Recuperada",
    "única substituta recupera após falha temporária",
  );
  await evaluate(
    `applyConfig({widgets:{photos:{items:[{id:'a',src:'/a.png',alt:'A'},{id:'b',src:'/b.png',alt:'B'}],intervalSeconds:5}}}); for (let i=0;i<5;i++) applyConfig({widgets:{photos:{intervalSeconds:5}}})`,
  );
  await sleep(5300);
  assert.equal(
    await evaluate(`document.querySelector('.photo-image.is-current').alt`),
    "B",
    "avanço automático",
  );
  await evaluate(
    `applyConfig({widgets:{photos:{items:Array.from({length:100},(_,i)=>({id:'missing-'+i,src:'/unavailable/'+i,alt:'Ausente'}))}}})`,
  );
  await sleep(1000);
  assert.equal(unavailableRequests.length, 3, "apenas três tentativas por ciclo de falhas");
  for (let i = 1; i < unavailableRequests.length; i++)
    assert.ok(unavailableRequests[i] - unavailableRequests[i - 1] >= 200, "espera entre erros");
  await evaluate(
    `applyConfig({widgets:{photos:{items:[{id:'a',src:'/a.png',alt:'A'},{id:'b',src:'/b.png',alt:'B'}]}}})`,
  );
  const beforePause = requests;
  await evaluate(
    `Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await sleep(150);
  assert.equal(requests, beforePause, "sem consulta em segundo plano");
  await evaluate(
    `Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await sleep(300);
  assert.equal(requests, beforePause + 1, "retorno consulta imediatamente uma vez");
  assert.equal(
    await evaluate(
      `(() => { applyConfig({widgets:{photos:{enabled:false},clock:{enabled:false},weather:{enabled:false},currencies:{enabled:false},calendar:{enabled:true}}}); const r=document.querySelector('#calendar').getBoundingClientRect(); return r.width > innerWidth - 30 && r.height > innerHeight - 30 && !document.querySelector('#calendar').hidden; })()`,
    ),
    true,
    "reorganização de widgets",
  );
  console.log("Configuração parcial, layout, calendário e carrossel: OK");
} finally {
  if (socket) socket.close();
  browser.kill();
  server.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
