import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@smartframe/database";
import { defaultPhotoFrame, photoFrameSchema, type PhotoFrame } from "@smartframe/contracts";
import { cachedWidgetData, refreshFrameWidgets, searchCities } from "@smartframe/widgets";

const db = createDatabase(process.env.DATABASE_URL!);
const config: PhotoFrame = {
  ...structuredClone(defaultPhotoFrame),
  widgets: {
    position: "top-left",
    weather: { enabled: true, city: "São Paulo", latitude: -23.5505, longitude: -46.6333 },
    currencies: { enabled: true },
  },
};
beforeEach(async () => {
  await db.widgetSnapshot.deleteMany();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await db.widgetSnapshot.deleteMany();
  await db.$disconnect();
});

function source(url: string) {
  if (url.includes("forecast"))
    return {
      current: { temperature_2m: 22.1, weather_code: 2 },
      daily: { temperature_2m_min: [16.3], temperature_2m_max: [23.9] },
    };
  if (url.includes("frankfurter")) return { date: "2026-10-30", rates: { BRL: 5.4, EUR: 0.9 } };
  if (url.includes("coinbase"))
    return { data: { base: "BTC", currency: "USD", amount: "77003.37" } };
  return {};
}

describe("Widgets: clima e cotações", () => {
  it("mantém layouts antigos compatíveis e começa com os cartões desativados", async () => {
    const { widgets: unused, ...old } = defaultPhotoFrame;
    void unused;
    expect(photoFrameSchema.parse(old).widgets.weather.enabled).toBe(false);
    expect(await cachedWidgetData(db, defaultPhotoFrame)).toEqual({
      weather: null,
      currencies: null,
    });
  });
  it("consulta somente fontes HTTPS fixas e reutiliza o cache", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => Response.json(source(String(input))));
    vi.stubGlobal("fetch", fetcher);
    await refreshFrameWidgets(db, config);
    const data = await cachedWidgetData(db, config);
    expect(data.weather).toMatchObject({
      temperature: 22.1,
      minimum: 16.3,
      maximum: 23.9,
      weatherCode: 2,
      stale: false,
    });
    expect(data.currencies).toMatchObject({
      usdBrl: 5.4,
      eurBrl: 6,
      btcUsd: 77003.37,
      stale: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("https://"))).toBe(true);
    await refreshFrameWidgets(db, config);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("preserva dados anteriores quando as fontes ficam indisponíveis", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) => Response.json(source(String(input)))),
    );
    await refreshFrameWidgets(db, config);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Sem rede")));
    await refreshFrameWidgets(db, config, true);
    const data = await cachedWidgetData(db, config);
    expect(data.weather?.temperature).toBe(22.1);
    expect(data.weather?.stale).toBe(true);
    expect(data.currencies?.btcUsd).toBe(77003.37);
    expect(data.currencies?.stale).toBe(true);
  });
  it("uma fonte indisponível não impede os demais cartões", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        if (String(input).includes("coinbase")) throw new Error("Indisponível");
        return Response.json(source(String(input)));
      }),
    );
    await refreshFrameWidgets(db, config);
    const data = await cachedWidgetData(db, config);
    expect(data.weather?.temperature).toBe(22.1);
    expect(data.currencies?.usdBrl).toBe(5.4);
    expect(data.currencies?.btcUsd).toBeNull();
  });
  it("rejeita dados inválidos sem fabricar cotações ou temperaturas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ inesperado: true })),
    );
    await refreshFrameWidgets(db, config);
    const data = await cachedWidgetData(db, config);
    expect(data.weather).toBeNull();
    expect(data.currencies?.usdBrl).toBeNull();
    expect(data.currencies?.btcUsd).toBeNull();
  });
  it("marca snapshots antigos e separa cidades pelo cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) => Response.json(source(String(input)))),
    );
    await refreshFrameWidgets(db, config);
    await db.widgetSnapshot.updateMany({ data: { updatedAt: new Date(Date.now() - 60 * 60_000) } });
    expect((await cachedWidgetData(db, config)).weather?.stale).toBe(true);
    const different = {
      ...config,
      widgets: { ...config.widgets, weather: { ...config.widgets.weather, latitude: 0 } },
    };
    expect((await cachedWidgetData(db, different)).weather).toBeNull();
  });
  it("busca cidades sem aceitar URLs externas como destino", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        results: [
          {
            id: 1,
            name: "São Paulo",
            latitude: -23.55,
            longitude: -46.63,
            timezone: "America/Sao_Paulo",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect((await searchCities("São Paulo"))[0].name).toBe("São Paulo");
    expect(new URL(String(fetcher.mock.calls[0][0])).hostname).toBe("geocoding-api.open-meteo.com");
  });
});
