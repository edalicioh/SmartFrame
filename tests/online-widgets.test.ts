import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@smartframe/database";
import { publicHttpsDispatcher } from "../packages/widgets/src/public-https";
import {
  onlineWidgetData,
  parseRssXml,
  refreshOnlineWidgets,
  WIDGET_REFRESH_SECONDS,
  CURRENCY_REFRESH_SECONDS,
  RSS_REFRESH_SECONDS,
} from "@smartframe/widgets";

const db = createDatabase(process.env.DATABASE_URL!);
const householdId = "online-widgets-test";
const settings = {
  weather: { enabled: true, city: "Camboriú" },
  currencies: {
    enabled: true,
    pairs: ["USD/BRL", "EUR/BRL", "BTC/USD", "BTC/BRL"],
  },
};
function source(input: URL | RequestInfo) {
  const url = String(input);
  if (url.includes("geocoding"))
    return {
      results: [
        {
          id: 1,
          name: "Camboriú",
          country: "Brasil",
          latitude: -27.02,
          longitude: -48.65,
          timezone: "America/Sao_Paulo",
        },
      ],
    };
  if (url.includes("forecast"))
    return {
      current: { temperature_2m: 24, weather_code: 2 },
      daily: { temperature_2m_min: [19], temperature_2m_max: [27] },
    };
  if (url.includes("api.exchange.coinbase.com")) return { open: "50000", last: "65000" };
  const currency = new URL(url).searchParams.get("currency");
  const rates =
    currency === "USD"
      ? { BRL: "5.4", EUR: "0.9" }
      : currency === "EUR"
        ? { BRL: "6", USD: "1.11111111" }
        : { BRL: "350000", USD: "65000", ETH: "30" };
  return { data: { currency, rates } };
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
  await db.widgetSnapshot.deleteMany();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(async () => {
  await db.widgetSnapshot.deleteMany();
  await db.$disconnect();
});

describe("cotações online por par", () => {
  it("consulta ao abrir e só atualiza novamente aos 30 minutos", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => Response.json(source(input)));
    vi.stubGlobal("fetch", fetcher);
    await refreshOnlineWidgets(db, settings);
    const data = await onlineWidgetData(db, settings, householdId);
    await refreshOnlineWidgets(db, settings);
    expect(WIDGET_REFRESH_SECONDS).toBe(1800);
    expect(CURRENCY_REFRESH_SECONDS).toBe(1800);
    expect(data.weather).toMatchObject({ temperature: 24, source: "Open-Meteo", stale: false });
    expect(data.currencies["USD/BRL"]?.value).toBe(5.4);
    expect(data.currencies["EUR/BRL"]?.value).toBe(6);
    expect(data.currencies["BTC/BRL"]?.value).toBe(350000);
    expect(data.currencies["BTC/USD"]?.value).toBe(65000);
    expect(data.currencies["BTC/USD"]?.changePercent).toBeCloseTo(30);
    expect(data.currencies["BTC/USD"]?.changePeriod).toBe("24h");
    expect(data.currencies["BTC/BRL"]).not.toHaveProperty("changePercent");
    expect(fetcher).toHaveBeenCalledTimes(6);
    vi.setSystemTime(new Date("2026-11-02T12:01:00Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(6);
    vi.setSystemTime(new Date("2026-11-02T12:29:59.999Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(
      (await onlineWidgetData(db, settings, householdId)).currencies["BTC/USD"]?.updatedAt,
    ).toBe("2026-11-02T12:00:00.000Z");
    vi.setSystemTime(new Date("2026-11-02T12:30:00Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect((await onlineWidgetData(db, settings, householdId)).weather?.updatedAt).toBe(
      "2026-11-02T12:30:00.000Z",
    );
    await refreshOnlineWidgets(db, settings);
  });

  it("consultas simultâneas e polling de fotos não repetem chamadas aos provedores", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => Response.json(source(input)));
    vi.stubGlobal("fetch", fetcher);
    await Promise.all(Array.from({ length: 10 }, () => refreshOnlineWidgets(db, settings)));
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(new Date(Date.parse("2026-11-02T12:00:00Z") + i * 1000));
      await onlineWidgetData(db, settings, householdId);
      await refreshOnlineWidgets(db, settings);
    }
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("preserva o cache e sinaliza dados antigos após falha, sem inventar valores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input) => Response.json(source(input))),
    );
    await refreshOnlineWidgets(db, settings);
    vi.setSystemTime(new Date("2026-11-02T12:30:00Z"));
    const fetcher = vi.fn().mockRejectedValue(new Error("Sem conexão"));
    vi.stubGlobal("fetch", fetcher);
    await refreshOnlineWidgets(db, settings);
    const data = await onlineWidgetData(db, settings, householdId);
    await refreshOnlineWidgets(db, settings);
    expect(data.weather).toMatchObject({ temperature: 24, stale: true });
    expect(data.currencies["BTC/BRL"]).toMatchObject({ value: 350000, stale: true });
    expect(data.currencies["BTC/USD"]).not.toHaveProperty("changePercent");
    expect(fetcher).toHaveBeenCalledTimes(5);
    vi.setSystemTime(new Date("2026-11-02T12:31:59.999Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(5);
    vi.setSystemTime(new Date("2026-11-02T12:32:00Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it("sem cache ou com widgets desligados não fornece demonstrações", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Sem conexão")));
    await refreshOnlineWidgets(db, settings);
    const data = await onlineWidgetData(db, settings, householdId);
    await refreshOnlineWidgets(db, settings);
    expect(data.weather).toBeNull();
    expect(data.currencies).toEqual({
      "USD/BRL": null,
      "EUR/BRL": null,
      "BTC/USD": null,
      "BTC/BRL": null,
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const disabled = {
      weather: { enabled: false, city: "Camboriú" },
      currencies: { enabled: false },
    };
    await refreshOnlineWidgets(db, disabled);
    expect((await onlineWidgetData(db, disabled, householdId)).weather).toBeNull();
    await refreshOnlineWidgets(db, disabled);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("mantém a cotação quando a estatística de 24 horas é inválida ou indisponível", async () => {
    const onlyBtc = {
      weather: { enabled: false, city: "" },
      currencies: { enabled: true, pairs: ["BTC/USD"] },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) =>
          String(input).includes("api.exchange.coinbase.com")
            ? Response.json({ open: "0", last: "65000" })
            : Response.json(source(input)),
        ),
    );
    await refreshOnlineWidgets(db, onlyBtc);
    const data = await onlineWidgetData(db, onlyBtc, householdId);
    expect(data.currencies["BTC/USD"]?.value).toBe(65000);
    expect(data.currencies["BTC/USD"]).not.toHaveProperty("changePercent");
    await refreshOnlineWidgets(db, onlyBtc);
  });

  it("trocar a cidade não reutiliza o clima da cidade anterior", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input) => Response.json(source(input))),
    );
    await refreshOnlineWidgets(db, settings);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Sem conexão")));
    const changed = { ...settings, weather: { enabled: true, city: "Outra cidade" } };
    await refreshOnlineWidgets(db, changed);
    expect((await onlineWidgetData(db, changed, householdId)).weather).toBeNull();
    await refreshOnlineWidgets(db, changed);
  });

  it("compartilha uma consulta por origem entre seleções simultâneas diferentes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => Response.json(source(input)));
    vi.stubGlobal("fetch", fetcher);
    const first = {
      weather: { enabled: false, city: "" },
      currencies: { enabled: true, pairs: ["BTC/USD"] },
    };
    const second = { ...first, currencies: { enabled: true, pairs: ["BTC/BRL", "BTC/ETH"] } };
    await Promise.all([refreshOnlineWidgets(db, first), refreshOnlineWidgets(db, second)]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await onlineWidgetData(db, second, householdId)).currencies["BTC/ETH"]?.value).toBe(30);
    await refreshOnlineWidgets(db, second);
  });

  it("sinaliza atualização pendente no vencimento e preserva a cotação anterior", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input) => Response.json(source(input))),
    );
    const onlyBtc = {
      weather: { enabled: false, city: "" },
      currencies: { enabled: true, pairs: ["BTC/USD"] },
    };
    await refreshOnlineWidgets(db, onlyBtc);
    vi.setSystemTime(new Date("2026-11-02T12:30:00Z"));
    const data = await onlineWidgetData(db, onlyBtc, householdId);
    expect(data.currenciesPending).toBe(true);
    expect(data.currencies["BTC/USD"]).toMatchObject({ value: 65000, stale: true });
    await refreshOnlineWidgets(db, onlyBtc);
    expect((await onlineWidgetData(db, onlyBtc, householdId)).currenciesPending).toBe(false);
    await refreshOnlineWidgets(db, onlyBtc);
  });

  it("retorna imediatamente sem cache e sinaliza a primeira consulta em andamento", async () => {
    let complete!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input) =>
        String(input).includes("api.exchange.coinbase.com")
          ? Promise.resolve(Response.json({ open: "50000", last: "65000" }))
          : new Promise<Response>((resolve) => {
              complete = () =>
                resolve(
                  Response.json(source("https://api.coinbase.com/v2/exchange-rates?currency=BTC")),
                );
            }),
      ),
    );
    const onlyBtc = {
      weather: { enabled: false, city: "" },
      currencies: { enabled: true, pairs: ["BTC/USD"] },
    };
    const job = refreshOnlineWidgets(db, onlyBtc);
    // Wait for the database read to start the provider call without awaiting that call.
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    const data = await onlineWidgetData(db, onlyBtc, householdId);
    expect(data.currenciesPending).toBe(true);
    expect(data.currencies["BTC/USD"]).toBeNull();
    complete();
    await job;
    expect((await onlineWidgetData(db, onlyBtc, householdId)).currencies["BTC/USD"]?.value).toBe(
      65000,
    );
    await refreshOnlineWidgets(db, onlyBtc);
  });

  it("rejeita respostas com origem errada, cotações inválidas e pares não suportados", async () => {
    const onlyUsd = {
      weather: { enabled: false, city: "" },
      currencies: { enabled: true, pairs: ["USD/BRL", "USD/EUR", "BAD/BRL"] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ data: { currency: "BTC", rates: { BRL: "10" } } })),
    );
    await refreshOnlineWidgets(db, onlyUsd);
    expect((await onlineWidgetData(db, onlyUsd, householdId)).currencies).toEqual({
      "USD/BRL": null,
      "USD/EUR": null,
    });
    await refreshOnlineWidgets(db, onlyUsd);
    vi.setSystemTime(new Date("2026-11-02T12:02:00Z"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () =>
          Response.json({ data: { currency: "USD", rates: { BRL: "NaN", EUR: "-1" } } }),
        ),
    );
    await refreshOnlineWidgets(db, onlyUsd);
    const data = await onlineWidgetData(db, onlyUsd, householdId);
    expect(data.currencies["USD/BRL"]).toBeNull();
    expect(data.currenciesPending).toBe(false);
    await refreshOnlineWidgets(db, onlyUsd);
  });

  it("retorna contagens apenas da residência autenticada", async () => {
    const userIds = [randomUUID(), randomUUID()];
    try {
      const households = await Promise.all(
        userIds.map((id, index) =>
          db.household.create({
            data: {
              name: `Casa ${index}`,
              owner: { create: { id, name: `Owner ${index}`, email: `${id}@test.local` } },
              devices: {
                create: [
                  ...Array.from({ length: index + 1 }, (_, i) => ({ name: `Tela ${i}` })),
                  { name: "Revogada", revokedAt: new Date() },
                ],
              },
              media: {
                create: [
                  ...Array.from({ length: index + 2 }, (_, i) => ({
                    filename: `foto-${i}.jpg`,
                    status: "ready",
                  })),
                  { filename: "pendente.jpg", status: "pending" },
                ],
              },
            },
          }),
        ),
      );
      const metrics = {
        weather: { enabled: false, city: "" },
        currencies: { enabled: false },
        devMonitor: { enabled: true, showServerMetrics: true },
      };
      for (const [index, household] of households.entries()) {
        const data = await onlineWidgetData(db, metrics, household.id);
        expect(data.devMonitor).toMatchObject({
          activeDevicesCount: index + 1,
          readyPhotosCount: index + 2,
        });
      }
      await expect(onlineWidgetData(db, metrics, "")).rejects.toThrow("Residência autenticada");
    } finally {
      await db.household.deleteMany({ where: { ownerId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  it("sanitiza feeds RSS/Atom sem HTML e cacheia por 15 minutos", async () => {
    const parsed = parseRssXml(`<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Portal &amp; Tech &lt;script&gt;alert(1)&lt;/script&gt;</title>
          <item>
            <title><![CDATA[<b>Nova versão</b> do &quot;SmartFrame&quot;]]></title>
            <pubDate>Mon, 02 Nov 2026 11:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Segundo item</title>
          </item>
        </channel>
      </rss>`);
    expect(parsed.title).toBe("Portal & Tech alert(1)");
    expect(parsed.items).toEqual([
      { title: 'Nova versão do "SmartFrame"', publishedAt: "2026-11-02T11:00:00.000Z" },
      { title: "Segundo item", publishedAt: null },
    ]);

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title><entry><title>Release v0.4</title><updated>2026-11-02T10:00:00Z</updated></entry></feed>`,
          { status: 200, headers: { "content-type": "application/atom+xml" } },
        ),
      );
    vi.stubGlobal("fetch", fetcher);

    const rssOnly = {
      weather: { enabled: false, city: "" },
      currencies: { enabled: false, pairs: [] },
      rss: { enabled: true, feedUrl: "https://feeds.example.com/atom.xml", maxItems: 5 },
      system: { enabled: true },
      devMonitor: { enabled: true, showServerMetrics: true },
    };

    expect(RSS_REFRESH_SECONDS).toBe(900);
    await refreshOnlineWidgets(db, rssOnly);
    const data = await onlineWidgetData(db, rssOnly, householdId);
    await refreshOnlineWidgets(db, rssOnly);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      rssOnly.rss.feedUrl,
      expect.objectContaining({ dispatcher: publicHttpsDispatcher, redirect: "error" }),
    );
    expect(data.rss).toMatchObject({
      title: "Atom Feed",
      items: [{ title: "Release v0.4", publishedAt: "2026-11-02T10:00:00.000Z" }],
      stale: false,
    });
    expect(data.rssPending).toBe(false);
    expect(data.system).toMatchObject({
      cpuCores: expect.any(Number),
      memoryUsedPercent: expect.any(Number),
      uptimeSeconds: expect.any(Number),
    });
    expect(data.devMonitor).toMatchObject({
      nodeVersion: expect.stringMatching(/^v\d+/),
      activeDevicesCount: expect.any(Number),
      readyPhotosCount: expect.any(Number),
    });

    // URL privada deve ser ignorada mesmo se passar para o provedor.
    await refreshOnlineWidgets(db, {
      weather: { enabled: false, city: "" },
      currencies: { enabled: false, pairs: [] },
      rss: { enabled: true, feedUrl: "https://127.0.0.1/secret.xml", maxItems: 5 },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("decodificação de feeds RSS", () => {
  const rss = {
    weather: { enabled: false, city: "" },
    currencies: { enabled: false },
    rss: { enabled: true, feedUrl: "https://feeds.example.com/noticias.xml" },
  };
  const feed =
    "<rss><channel><title>Notícias</title><item><title>Ação</title></item></channel></rss>";
  const declaration = (encoding: string) => `<?xml version="1.0" encoding="${encoding}"?>`;
  async function refreshFeed() {
    await refreshOnlineWidgets(db, rss);
    const data = await onlineWidgetData(db, rss, householdId);
    await refreshOnlineWidgets(db, rss); // Finish the cache read's background refresh before teardown.
    return data.rss;
  }

  it.each([
    { name: "UTF-8 por padrão", type: "application/rss+xml", bytes: Buffer.from(feed) },
    {
      name: "ISO-8859-1 declarado no XML",
      type: "application/rss+xml",
      bytes: Buffer.from(declaration("ISO-8859-1") + feed, "latin1"),
    },
    {
      name: "charset HTTP tem precedência sobre a declaração",
      type: 'text/xml; CHARSET="ISO-8859-1"',
      bytes: Buffer.from(declaration("UTF-8") + feed, "latin1"),
    },
    {
      name: "BOM UTF-16BE tem precedência sobre o charset HTTP",
      type: "application/rss+xml; charset=utf-8",
      bytes: Buffer.from("\ufeff" + feed, "utf16le").swap16(),
    },
  ])("$name: preserva acentos no cache", async ({ type, bytes }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(bytes, {
          headers: { "Content-Type": type },
        }),
      ),
    );
    expect(await refreshFeed()).toMatchObject({
      title: "Notícias",
      items: [{ title: "Ação" }],
      stale: false,
    });
  });

  it("preserva as manchetes anteriores quando a codificação declarada não é suportada", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(feed))
        .mockResolvedValueOnce(
          new Response(Buffer.from(declaration("not-an-encoding") + feed), {
            headers: { "Content-Type": "application/rss+xml" },
          }),
        ),
    );
    const previous = await refreshFeed();
    expect(previous?.stale).toBe(false);
    vi.setSystemTime(Date.now() + RSS_REFRESH_SECONDS * 1000);
    expect(await refreshFeed()).toEqual({ ...previous, stale: true });
  });
});
