import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@smartframe/database";
import {
  onlineWidgetData,
  refreshOnlineWidgets,
  WIDGET_REFRESH_SECONDS,
} from "@smartframe/widgets";

const db = createDatabase(process.env.DATABASE_URL!);
const settings = { weather: { enabled: true, city: "Camboriú" }, currencies: { enabled: true } };
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
  if (url.includes("frankfurter")) return { date: "2026-11-02", rates: { BRL: 5.4, EUR: 0.9 } };
  return { data: { base: "BTC", currency: "BRL", amount: "350000" } };
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

describe("widgets online a cada 30 minutos", () => {
  it("consulta dados reais uma vez e só atualiza novamente aos 30 minutos", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => Response.json(source(input)));
    vi.stubGlobal("fetch", fetcher);
    await refreshOnlineWidgets(db, settings);
    const data = await onlineWidgetData(db, settings);
    await refreshOnlineWidgets(db, settings);
    expect(WIDGET_REFRESH_SECONDS).toBe(1800);
    expect(data.weather).toMatchObject({ temperature: 24, source: "Open-Meteo", stale: false });
    expect(data.currencies.USD?.value).toBe(5.4);
    expect(data.currencies.EUR?.value).toBe(6);
    expect(data.currencies.BTC?.value).toBe(350000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.setSystemTime(new Date("2026-11-02T12:29:59.999Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.setSystemTime(new Date("2026-11-02T12:30:00Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect((await onlineWidgetData(db, settings)).weather?.updatedAt).toBe(
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
      vi.setSystemTime(new Date(Date.parse("2026-11-02T12:00:00Z") + i * 60_000));
      await onlineWidgetData(db, settings);
      await refreshOnlineWidgets(db, settings);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
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
    const data = await onlineWidgetData(db, settings);
    await refreshOnlineWidgets(db, settings);
    expect(data.weather).toMatchObject({ temperature: 24, stale: true });
    expect(data.currencies.BTC).toMatchObject({ value: 350000, stale: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("sem cache ou com widgets desligados não fornece demonstrações", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Sem conexão")));
    await refreshOnlineWidgets(db, settings);
    const data = await onlineWidgetData(db, settings);
    await refreshOnlineWidgets(db, settings);
    expect(data.weather).toBeNull();
    expect(data.currencies).toEqual({ USD: null, EUR: null, BTC: null });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const disabled = {
      weather: { enabled: false, city: "Camboriú" },
      currencies: { enabled: false },
    };
    await refreshOnlineWidgets(db, disabled);
    expect((await onlineWidgetData(db, disabled)).weather).toBeNull();
    await refreshOnlineWidgets(db, disabled);
    expect(fetcher).not.toHaveBeenCalled();
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
    expect((await onlineWidgetData(db, changed)).weather).toBeNull();
    await refreshOnlineWidgets(db, changed);
  });
});
