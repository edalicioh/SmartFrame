import { z } from "zod";
import {
  photoFrameSchema,
  widgetDataSchema,
  type PhotoFrame,
  type WidgetData,
} from "@smartframe/contracts";
import type { PrismaClient } from "@smartframe/database";

export const WIDGET_REFRESH_SECONDS = 30 * 60;
const TTL = WIDGET_REFRESH_SECONDS * 1000;
const STALE_AFTER = 30 * 60_000;
const weatherPayload = z.object({
  temperature: z.number().min(-100).max(100),
  minimum: z.number().min(-100).max(100),
  maximum: z.number().min(-100).max(100),
  weatherCode: z.number().int().min(0).max(99),
});
const fiatPayload = z.object({
  usdBrl: z.number().positive().max(1e10),
  eurBrl: z.number().positive().max(1e10),
  date: z.string().max(30),
});
const btcPayload = z.object({ btcUsd: z.number().positive().max(1e10) });
const weatherKey = (frame: PhotoFrame) =>
  `weather:${frame.widgets.weather.latitude.toFixed(4)}:${frame.widgets.weather.longitude.toFixed(4)}:${frame.timezone}`;

async function loadWeather(latitude: number, longitude: number, timezone: string) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min",
    timezone,
    forecast_days: "1",
  }).toString();
  const result = z
    .object({
      current: z.object({ temperature_2m: z.number(), weather_code: z.number() }),
      daily: z.object({
        temperature_2m_min: z.array(z.number()).min(1),
        temperature_2m_max: z.array(z.number()).min(1),
      }),
    })
    .parse(await externalJson(url));
  return weatherPayload.parse({
    temperature: result.current.temperature_2m,
    minimum: result.daily.temperature_2m_min[0],
    maximum: result.daily.temperature_2m_max[0],
    weatherCode: result.current.weather_code,
  });
}

async function loadFiat() {
  const data = z
    .object({
      date: z.string(),
      rates: z.object({ BRL: z.number().positive(), EUR: z.number().positive() }),
    })
    .parse(await externalJson("https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL,EUR"));
  return fiatPayload.parse({
    usdBrl: data.rates.BRL,
    eurBrl: data.rates.BRL / data.rates.EUR,
    date: data.date,
  });
}

async function externalJson(url: URL | string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(9000),
    redirect: "error",
    headers: { Accept: "application/json", "User-Agent": "SmartFrame/0.2 self-hosted" },
  });
  if (!response.ok) throw new Error("Fonte de dados temporariamente indisponível.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Resposta vazia.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 262144) {
        await reader.cancel();
        throw new Error("Resposta externa muito grande.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function refresh(
  db: PrismaClient,
  key: string,
  load: () => Promise<Record<string, string | number>>,
  force: boolean,
) {
  const cached = await db.widgetSnapshot.findUnique({ where: { key } });
  if (!force && cached && cached.expiresAt > new Date()) return;
  try {
    const payload = await load();
    const updatedAt = new Date();
    const data = {
      payload,
      updatedAt,
      expiresAt: new Date(updatedAt.getTime() + TTL),
      failedAt: null,
    };
    await db.widgetSnapshot.upsert({ where: { key }, create: { key, ...data }, update: data });
  } catch {
    const failedAt = new Date();
    const expiresAt = new Date(failedAt.getTime() + 120_000);
    await db.widgetSnapshot.upsert({
      where: { key },
      create: { key, payload: {}, updatedAt: new Date(0), failedAt, expiresAt },
      update: { failedAt, expiresAt },
    });
    // Falha de uma fonte não bloqueia os outros widgets nem apaga o cache.
  }
}

export async function refreshFrameWidgets(db: PrismaClient, frame: PhotoFrame, force = false) {
  const tasks: Promise<void>[] = [];
  if (frame.widgets.weather.enabled)
    tasks.push(
      refresh(
        db,
        weatherKey(frame),
        () =>
          loadWeather(
            frame.widgets.weather.latitude,
            frame.widgets.weather.longitude,
            frame.timezone,
          ),
        force,
      ),
    );
  if (frame.widgets.currencies.enabled) {
    tasks.push(refresh(db, "currencies:fiat", loadFiat, force));
    tasks.push(
      refresh(
        db,
        "currencies:btc",
        async () => {
          const data = z
            .object({
              data: z.object({
                amount: z.string(),
                base: z.literal("BTC"),
                currency: z.literal("USD"),
              }),
            })
            .parse(await externalJson("https://api.coinbase.com/v2/prices/BTC-USD/spot"));
          return btcPayload.parse({ btcUsd: Number(data.data.amount) });
        },
        force,
      ),
    );
  }
  await Promise.all(tasks);
}

export async function refreshPublishedWidgets(db: PrismaClient) {
  const layouts = await db.layout.findMany({
    where: { publishedVersionId: { not: null } },
    include: { publishedVersion: true },
    take: 100,
  });
  for (const layout of layouts) {
    const parsed = photoFrameSchema.safeParse(layout.publishedVersion?.config);
    if (parsed.success) await refreshFrameWidgets(db, parsed.data);
  }
}

export async function cachedWidgetData(db: PrismaClient, frame: PhotoFrame): Promise<WidgetData> {
  const stale = (record: { updatedAt: Date; failedAt: Date | null }) =>
    Date.now() - record.updatedAt.getTime() > STALE_AFTER ||
    (!!record.failedAt && record.failedAt >= record.updatedAt);
  let weather: WidgetData["weather"] = null;
  let currencies: WidgetData["currencies"] = null;
  if (frame.widgets.weather.enabled) {
    const record = await db.widgetSnapshot.findUnique({ where: { key: weatherKey(frame) } });
    const parsed = weatherPayload.safeParse(record?.payload);
    if (record && parsed.success)
      weather = { ...parsed.data, updatedAt: record.updatedAt.toISOString(), stale: stale(record) };
  }
  if (frame.widgets.currencies.enabled) {
    const [fiat, btc] = await Promise.all([
      db.widgetSnapshot.findUnique({ where: { key: "currencies:fiat" } }),
      db.widgetSnapshot.findUnique({ where: { key: "currencies:btc" } }),
    ]);
    const rates = fiatPayload.safeParse(fiat?.payload);
    const crypto = btcPayload.safeParse(btc?.payload);
    currencies = {
      usdBrl: rates.success ? rates.data.usdBrl : null,
      eurBrl: rates.success ? rates.data.eurBrl : null,
      btcUsd: crypto.success ? crypto.data.btcUsd : null,
      fiatDate: rates.success ? rates.data.date : null,
      fiatUpdatedAt: fiat && rates.success ? fiat.updatedAt.toISOString() : null,
      btcUpdatedAt: btc && crypto.success ? btc.updatedAt.toISOString() : null,
      stale: !fiat || !btc || stale(fiat) || stale(btc),
    };
  }
  return widgetDataSchema.parse({ weather, currencies });
}

type OnlineSettings = {
  weather: { enabled: boolean; city: string };
  currencies: { enabled: boolean };
};
const onlineWeatherKey = (city: string) =>
  `online:weather:${city.trim().toLocaleLowerCase("pt-BR")}`;
const onlineRefreshes = new WeakMap<PrismaClient, Map<string, Promise<void>>>();
const btcBrlPayload = z.object({ btcBrl: z.number().positive().max(1e10) });

/** Persisted cache, shared by devices; never run a provider request per photo/config poll. */
export function refreshOnlineWidgets(db: PrismaClient, settings: OnlineSettings): Promise<void> {
  let jobs = onlineRefreshes.get(db);
  if (!jobs) {
    jobs = new Map();
    onlineRefreshes.set(db, jobs);
  }
  const key = JSON.stringify([
    settings.weather.enabled,
    settings.weather.city,
    settings.currencies.enabled,
  ]);
  const existing = jobs.get(key);
  if (existing) return existing;
  const job = (async () => {
    const tasks: Promise<void>[] = [];
    if (settings.weather.enabled)
      tasks.push(
        refresh(
          db,
          onlineWeatherKey(settings.weather.city),
          async () => {
            const cities = await searchCities(settings.weather.city);
            const city =
              cities.find((item) => /^(Brasil|Brazil)$/i.test(item.country ?? "")) ?? cities[0];
            if (!city) throw new Error("Cidade não encontrada.");
            return loadWeather(city.latitude, city.longitude, city.timezone ?? "America/Sao_Paulo");
          },
          false,
        ),
      );
    if (settings.currencies.enabled) {
      tasks.push(refresh(db, "online:currencies:fiat", loadFiat, false));
      tasks.push(
        refresh(
          db,
          "online:currencies:btc-brl",
          async () => {
            const result = z
              .object({
                data: z.object({
                  amount: z.string(),
                  base: z.literal("BTC"),
                  currency: z.literal("BRL"),
                }),
              })
              .parse(await externalJson("https://api.coinbase.com/v2/prices/BTC-BRL/spot"));
            return btcBrlPayload.parse({ btcBrl: Number(result.data.amount) });
          },
          false,
        ),
      );
    }
    await Promise.all(tasks);
  })();
  jobs.set(key, job);
  void job
    .finally(() => {
      if (jobs.get(key) === job) jobs.delete(key);
    })
    .catch(() => {});
  return job;
}

export async function onlineWidgetData(db: PrismaClient, settings: OnlineSettings) {
  const [weather, fiat, btc] = await Promise.all([
    settings.weather.enabled
      ? db.widgetSnapshot.findUnique({ where: { key: onlineWeatherKey(settings.weather.city) } })
      : null,
    settings.currencies.enabled
      ? db.widgetSnapshot.findUnique({ where: { key: "online:currencies:fiat" } })
      : null,
    settings.currencies.enabled
      ? db.widgetSnapshot.findUnique({ where: { key: "online:currencies:btc-brl" } })
      : null,
  ]);
  // Providers may take longer than the tablet's HTTP deadline. Return the last cache
  // immediately and refresh in the background; the next normal poll receives new data.
  void refreshOnlineWidgets(db, settings).catch(() => {
    console.warn("SmartFrame: atualização dos widgets online indisponível.");
  });
  const old = (record: { updatedAt: Date; failedAt: Date | null }) =>
    Date.now() - record.updatedAt.getTime() >= TTL ||
    (!!record.failedAt && record.failedAt >= record.updatedAt);
  const parsedWeather = weatherPayload.safeParse(weather?.payload);
  const rates = fiatPayload.safeParse(fiat?.payload);
  const crypto = btcBrlPayload.safeParse(btc?.payload);
  const quote = (
    value: number,
    record: NonNullable<typeof fiat>,
    source: string,
    referenceDate: string | null = null,
  ) => ({
    value,
    source,
    referenceDate,
    updatedAt: record.updatedAt.toISOString(),
    stale: old(record),
  });
  return {
    refreshSeconds: WIDGET_REFRESH_SECONDS,
    weather:
      weather && parsedWeather.success
        ? {
            ...parsedWeather.data,
            city: settings.weather.city,
            source: "Open-Meteo",
            updatedAt: weather.updatedAt.toISOString(),
            stale: old(weather),
          }
        : null,
    currencies: {
      USD:
        fiat && rates.success
          ? quote(rates.data.usdBrl, fiat, "Frankfurter / BCE", rates.data.date)
          : null,
      EUR:
        fiat && rates.success
          ? quote(rates.data.eurBrl, fiat, "Frankfurter / BCE", rates.data.date)
          : null,
      BTC: btc && crypto.success ? quote(crypto.data.btcBrl, btc, "Coinbase") : null,
    },
  };
}

export async function searchCities(query: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: query,
    count: "6",
    language: "pt",
    format: "json",
  }).toString();
  const data = z
    .object({
      results: z
        .array(
          z.object({
            id: z.number(),
            name: z.string(),
            latitude: z.number(),
            longitude: z.number(),
            country: z.string().optional(),
            admin1: z.string().optional(),
            timezone: z.string().optional(),
          }),
        )
        .optional(),
    })
    .parse(await externalJson(url));
  return data.results ?? [];
}
