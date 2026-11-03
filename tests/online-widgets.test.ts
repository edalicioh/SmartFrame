import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@smartframe/database";
import {
  onlineWidgetData,
  refreshOnlineWidgets,
  WIDGET_REFRESH_SECONDS,
  CURRENCY_REFRESH_SECONDS,
} from "@smartframe/widgets";

const db = createDatabase(process.env.DATABASE_URL!);
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
    const data = await onlineWidgetData(db, settings);
    await refreshOnlineWidgets(db, settings);
    expect(WIDGET_REFRESH_SECONDS).toBe(1800);
    expect(CURRENCY_REFRESH_SECONDS).toBe(1800);
    expect(data.weather).toMatchObject({ temperature: 24, source: "Open-Meteo", stale: false });
    expect(data.currencies["USD/BRL"]?.value).toBe(5.4);
    expect(data.currencies["EUR/BRL"]?.value).toBe(6);
    expect(data.currencies["BTC/BRL"]?.value).toBe(350000);
    expect(data.currencies["BTC/USD"]?.value).toBe(65000);
    expect(fetcher).toHaveBeenCalledTimes(5);
    vi.setSystemTime(new Date("2026-11-02T12:01:00Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(5);
    vi.setSystemTime(new Date("2026-11-02T12:29:59.999Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect((await onlineWidgetData(db, settings)).currencies["BTC/USD"]?.updatedAt).toBe(
      "2026-11-02T12:00:00.000Z",
    );
    vi.setSystemTime(new Date("2026-11-02T12:30:00Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(10);
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
      vi.setSystemTime(new Date(Date.parse("2026-11-02T12:00:00Z") + i * 1000));
      await onlineWidgetData(db, settings);
      await refreshOnlineWidgets(db, settings);
    }
    expect(fetcher).toHaveBeenCalledTimes(5);
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
    expect(data.currencies["BTC/BRL"]).toMatchObject({ value: 350000, stale: true });
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.setSystemTime(new Date("2026-11-02T12:31:59.999Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(4);
    vi.setSystemTime(new Date("2026-11-02T12:32:00Z"));
    await refreshOnlineWidgets(db, settings);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("sem cache ou com widgets desligados não fornece demonstrações", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Sem conexão")));
    await refreshOnlineWidgets(db, settings);
    const data = await onlineWidgetData(db, settings);
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
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await onlineWidgetData(db, second)).currencies["BTC/ETH"]?.value).toBe(30);
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
    const data = await onlineWidgetData(db, onlyBtc);
    expect(data.currenciesPending).toBe(true);
    expect(data.currencies["BTC/USD"]).toMatchObject({ value: 65000, stale: true });
    await refreshOnlineWidgets(db, onlyBtc);
    expect((await onlineWidgetData(db, onlyBtc)).currenciesPending).toBe(false);
    await refreshOnlineWidgets(db, onlyBtc);
  });

  it("retorna imediatamente sem cache e sinaliza a primeira consulta em andamento", async () => {
    let complete!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
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
    const data = await onlineWidgetData(db, onlyBtc);
    expect(data.currenciesPending).toBe(true);
    expect(data.currencies["BTC/USD"]).toBeNull();
    complete();
    await job;
    expect((await onlineWidgetData(db, onlyBtc)).currencies["BTC/USD"]?.value).toBe(65000);
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
    expect((await onlineWidgetData(db, onlyUsd)).currencies).toEqual({
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
    const data = await onlineWidgetData(db, onlyUsd);
    expect(data.currencies["USD/BRL"]).toBeNull();
    expect(data.currenciesPending).toBe(false);
    await refreshOnlineWidgets(db, onlyUsd);
  });
});
