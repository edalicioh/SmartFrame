import { createHash } from "node:crypto";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { MIMEType } from "node:util";
import { z } from "zod";
import {
  photoFrameSchema,
  widgetDataSchema,
  type PhotoFrame,
  type WidgetData,
  currencyCodes,
  currencyPairSchema,
  defaultCurrencyPairs,
  isSafePublicHttpsUrl,
  pushedFeedEntrySchema,
  type PushedFeedEntry,
} from "@smartframe/contracts";
import type { PrismaClient } from "@smartframe/database";
import { publicHttpsDispatcher } from "./public-https";

export const WIDGET_REFRESH_SECONDS = 30 * 60;
export const CURRENCY_REFRESH_SECONDS = 30 * 60;
export const RSS_REFRESH_SECONDS = 15 * 60;
const TTL = WIDGET_REFRESH_SECONDS * 1000;
const RSS_TTL = RSS_REFRESH_SECONDS * 1000;
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

async function fetchExternalBytes(url: URL | string, accept: string, publicOnly = false) {
  if (publicOnly && !isSafePublicHttpsUrl(String(url))) throw new Error("URL de feed inválida.");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(9000),
    redirect: "error",
    headers: { Accept: accept, "User-Agent": "SmartFrame/0.4 self-hosted" },
    ...(publicOnly ? { dispatcher: publicHttpsDispatcher } : {}),
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
  return {
    bytes: Buffer.concat(chunks, length),
    contentType: response.headers.get("content-type"),
  };
}

async function externalJson(url: URL | string) {
  const { bytes } = await fetchExternalBytes(url, "application/json");
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

/** XML over HTTP: the BOM takes precedence over the HTTP charset, then the XML declaration. */
function feedEncoding(bytes: Buffer, contentType: string | null): string {
  const prefix = bytes.toString("hex", 0, 4);
  if (prefix === "fffe0000" || prefix === "0000feff") throw new Error("UTF-32 não suportado.");
  if (prefix.startsWith("efbbbf")) return "utf-8";
  if (prefix.startsWith("fffe")) return "utf-16le";
  if (prefix.startsWith("feff")) return "utf-16be";

  if (contentType) {
    try {
      const charset = new MIMEType(contentType).params.get("charset");
      if (charset) return charset;
    } catch {
      // An invalid Content-Type supplies no usable charset; inspect the XML itself.
    }
  }
  if (prefix === "3c003f00") return "utf-16le";
  if (prefix === "003c003f") return "utf-16be";
  // For ASCII-compatible encodings only the declaration needs inspecting before decoding.
  const end = bytes.indexOf("?>");
  const declaration = end < 0 ? "" : bytes.toString("latin1", 0, end);
  return (
    /^<\?xml\s+[^?]*?\bencoding\s*=\s*(["'])([A-Za-z][\w.-]*)\1/.exec(declaration)?.[2] ?? "utf-8"
  );
}

type RssParsedFeed = {
  title: string;
  items: Array<{ title: string; publishedAt: string | null }>;
};

const rssCachePayload = z.object({
  title: z.string().max(120),
  items: z
    .array(
      z.object({
        title: z.string().max(180),
        publishedAt: z.string().nullable(),
      }),
    )
    .max(10),
});

function cleanXmlText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withoutTags = unwrapped.replace(/<[^>]+>/g, " ");
  const decoded = withoutTags
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number(dec);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    });
  return decoded
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstTagValue(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  return match ? cleanXmlText(match[1]) : "";
}

/** Extract sanitized feed title and headlines from RSS 2.0 or Atom XML without HTML/scripts. */
export function parseRssXml(xml: string): RssParsedFeed {
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, "");
  const headerSlice = stripped.split(/<(?:item|entry)(?:\s|>)/i)[0] ?? stripped;
  const feedTitle = firstTagValue(headerSlice, "title").slice(0, 120) || "Feed RSS";
  const blocks = [...stripped.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(
    0,
    10,
  );
  const items: Array<{ title: string; publishedAt: string | null }> = [];
  for (const match of blocks) {
    const body = match[2];
    const title = firstTagValue(body, "title").slice(0, 180);
    if (!title) continue;
    const rawDate =
      firstTagValue(body, "pubDate") ||
      firstTagValue(body, "published") ||
      firstTagValue(body, "updated");
    const parsedTime = rawDate ? Date.parse(rawDate) : Number.NaN;
    items.push({
      title,
      publishedAt: Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : null,
    });
  }
  return rssCachePayload.parse({ title: feedTitle, items });
}

let previousCpuSnapshot: { idle: number; total: number } | null = null;

export async function collectSystemMetrics() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  let cpuUsagePercent = 0;
  if (previousCpuSnapshot && total > previousCpuSnapshot.total) {
    const deltaTotal = total - previousCpuSnapshot.total;
    const deltaIdle = Math.max(0, idle - previousCpuSnapshot.idle);
    cpuUsagePercent = Math.min(
      100,
      Math.max(0, Math.round(((deltaTotal - deltaIdle) / deltaTotal) * 100)),
    );
  } else if (total > 0) {
    cpuUsagePercent = Math.min(100, Math.max(0, Math.round(((total - idle) / total) * 100)));
  }
  previousCpuSnapshot = { idle, total };

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  let diskUsedPercent: number | null = null;
  try {
    const stats = await statfs(process.cwd());
    const blocks = Number(stats.blocks);
    const bfree = Number(stats.bfree);
    if (blocks > 0) {
      diskUsedPercent = Math.min(100, Math.max(0, Math.round(((blocks - bfree) / blocks) * 100)));
    }
  } catch {
    diskUsedPercent = null;
  }

  return {
    cpuUsagePercent,
    cpuCores: cpus.length,
    memoryUsedPercent: totalMem > 0 ? Math.min(100, Math.round((usedMem / totalMem) * 100)) : 0,
    memoryUsedGb: Math.round((usedMem / 1024 ** 3) * 10) / 10,
    memoryTotalGb: Math.round((totalMem / 1024 ** 3) * 10) / 10,
    diskUsedPercent,
    uptimeSeconds: Math.max(0, Math.floor(os.uptime())),
    updatedAt: new Date().toISOString(),
  };
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const MIN_FORCE_REFRESH_COOLDOWN_MS = 15_000;

async function refresh(
  db: PrismaClient,
  key: string,
  load: () => Promise<JsonObject>,
  force: boolean,
  ttl = TTL,
  minForceCooldownMs = 0,
) {
  const cached = await db.widgetSnapshot.findUnique({ where: { key } });
  const nowMs = Date.now();
  if (!force && cached && cached.expiresAt.getTime() > nowMs) return;
  if (
    force &&
    minForceCooldownMs > 0 &&
    cached &&
    !cached.failedAt &&
    nowMs - cached.updatedAt.getTime() < minForceCooldownMs
  ) {
    return;
  }
  try {
    const payload = await load();
    const updatedAt = new Date();
    const data = {
      payload,
      updatedAt,
      expiresAt: new Date(updatedAt.getTime() + ttl),
      failedAt: null,
    };
    await db.widgetSnapshot.upsert({ where: { key }, create: { key, ...data }, update: data });
  } catch {
    const failedAt = new Date();
    const expiresAt = new Date(failedAt.getTime() + Math.min(ttl, 120_000));
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
  currencies: { enabled: boolean; pairs?: string[] };
  system?: { enabled: boolean };
  rss?: { enabled: boolean; feedUrl?: string; maxItems?: number };
  devMonitor?: {
    enabled: boolean;
    showServerMetrics?: boolean;
    items?: Array<{ pushKey?: string }>;
  };
};
const onlineWeatherKey = (city: string) =>
  `online:weather:${city.trim().toLocaleLowerCase("pt-BR")}`;
const onlineRssKey = (feedUrl: string) =>
  `online:rss:${createHash("sha256").update(feedUrl).digest("hex").slice(0, 32)}`;
const onlineRefreshes = new WeakMap<PrismaClient, Map<string, Promise<void>>>();
const spotPayload = z.object({ rates: z.record(z.string(), z.number().positive().max(1e20)) });
const spotKey = (base: string) => `online:currencies:spot:${base}`;
const marketStatsKey = (pair: string) => `online:currencies:stats:${pair}`;
// Exchange statistics are available for traded crypto markets, not arbitrary FX pairs.
const hasMarketStats = (pair: string) => {
  const [base, target] = pair.split("/");
  return ["BTC", "ETH"].includes(base) && ["USD", "EUR", "GBP", "BTC", "ETH"].includes(target);
};
const marketStatsPayload = z.object({
  open: z.number().positive().max(1e20),
  last: z.number().positive().max(1e20),
});
const selectedPairs = (settings: OnlineSettings) =>
  settings.currencies.enabled
    ? [...new Set(settings.currencies.pairs ?? defaultCurrencyPairs)]
        .filter((pair) => currencyPairSchema.safeParse(pair).success)
        .slice(0, 20)
    : [];

async function loadSpot(base: string) {
  const url = new URL("https://api.coinbase.com/v2/exchange-rates");
  url.searchParams.set("currency", base);
  const result = z
    .object({
      data: z.object({ currency: z.literal(base), rates: z.record(z.string(), z.string()) }),
    })
    .parse(await externalJson(url));
  const rates: Record<string, number> = {};
  for (const code of currencyCodes) {
    if (result.data.rates[code] === undefined) continue;
    const value = Number(result.data.rates[code]);
    if (!Number.isFinite(value) || value <= 0 || value > 1e20) throw new Error("Cotação inválida.");
    rates[code] = value;
  }
  if (!Object.keys(rates).length) throw new Error("Cotações indisponíveis.");
  return spotPayload.parse({ rates });
}

async function loadMarketStats(pair: string) {
  const data = z
    .object({ open: z.string(), last: z.string() })
    .parse(
      await externalJson(
        `https://api.exchange.coinbase.com/products/${pair.replace("/", "-")}/stats`,
      ),
    );
  return marketStatsPayload.parse({ open: Number(data.open), last: Number(data.last) });
}

/** Single flight per source, even when different devices select overlapping pairs. */
function refreshOnlineSource(
  db: PrismaClient,
  key: string,
  load: () => Promise<JsonObject>,
  ttl = TTL,
  force = false,
): Promise<void> {
  let jobs = onlineRefreshes.get(db);
  if (!jobs) {
    jobs = new Map();
    onlineRefreshes.set(db, jobs);
  }
  const existing = jobs.get(key);
  if (existing) return existing;
  const job = refresh(db, key, load, force, ttl, MIN_FORCE_REFRESH_COOLDOWN_MS);
  jobs.set(key, job);
  void job
    .finally(() => {
      if (jobs.get(key) === job) jobs.delete(key);
    })
    .catch(() => {});
  return job;
}

/** Persisted cache shared by devices; currencies refresh independently of weather. */
export async function refreshOnlineWidgets(
  db: PrismaClient,
  settings: OnlineSettings,
  force = false,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (settings.weather.enabled)
    tasks.push(
      refreshOnlineSource(
        db,
        onlineWeatherKey(settings.weather.city),
        async () => {
          const cities = await searchCities(settings.weather.city);
          const city =
            cities.find((item) => /^(Brasil|Brazil)$/i.test(item.country ?? "")) ?? cities[0];
          if (!city) throw new Error("Cidade não encontrada.");
          return loadWeather(city.latitude, city.longitude, city.timezone ?? "America/Sao_Paulo");
        },
        TTL,
        force,
      ),
    );
  for (const base of new Set(selectedPairs(settings).map((pair) => pair.split("/")[0])))
    tasks.push(
      refreshOnlineSource(
        db,
        spotKey(base),
        () => loadSpot(base),
        CURRENCY_REFRESH_SECONDS * 1000,
        force,
      ),
    );
  for (const pair of selectedPairs(settings).filter(hasMarketStats))
    tasks.push(
      refreshOnlineSource(
        db,
        marketStatsKey(pair),
        () => loadMarketStats(pair),
        CURRENCY_REFRESH_SECONDS * 1000,
        force,
      ),
    );
  const rssUrl = settings.rss?.enabled ? (settings.rss.feedUrl?.trim() ?? "") : "";
  if (rssUrl && isSafePublicHttpsUrl(rssUrl)) {
    tasks.push(
      refreshOnlineSource(
        db,
        onlineRssKey(rssUrl),
        async () => {
          const { bytes, contentType } = await fetchExternalBytes(
            rssUrl,
            "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
            true,
          );
          const decoder = new TextDecoder(feedEncoding(bytes, contentType), { fatal: true });
          return parseRssXml(decoder.decode(bytes));
        },
        RSS_TTL,
        force,
      ),
    );
  }
  await Promise.all(tasks);
}

export async function onlineWidgetData(
  db: PrismaClient,
  settings: OnlineSettings,
  householdId: string,
  options?: { forceRefresh?: boolean },
) {
  if (!householdId) throw new Error("Residência autenticada necessária para os widgets.");
  const pairs = selectedPairs(settings);
  const bases = [...new Set(pairs.map((pair) => pair.split("/")[0]))];
  const statsPairs = pairs.filter(hasMarketStats);
  const rssUrl = settings.rss?.enabled ? (settings.rss.feedUrl?.trim() ?? "") : "";
  const validRssUrl = rssUrl && isSafePublicHttpsUrl(rssUrl) ? rssUrl : "";
  const wantSystem = Boolean(settings.system?.enabled);
  const wantDevMonitor = Boolean(settings.devMonitor?.enabled);
  const wantDevMetrics = Boolean(
    wantDevMonitor && settings.devMonitor?.showServerMetrics !== false,
  );
  const referencedPushKeys = wantDevMonitor
    ? [
        ...new Set(
          (settings.devMonitor?.items ?? [])
            .map((item) => item.pushKey?.trim() ?? "")
            .filter((pushKey) => pushKey.length > 0),
        ),
      ]
    : [];
  const [
    weather,
    records,
    statsRecords,
    rssRecord,
    systemMetrics,
    devMetrics,
    pushSnapshots,
    referencedPushSnapshots,
  ] = await Promise.all([
    settings.weather.enabled
      ? db.widgetSnapshot.findUnique({ where: { key: onlineWeatherKey(settings.weather.city) } })
      : null,
    Promise.all(
      bases.map((base) => db.widgetSnapshot.findUnique({ where: { key: spotKey(base) } })),
    ),
    Promise.all(
      statsPairs.map((pair) =>
        db.widgetSnapshot.findUnique({ where: { key: marketStatsKey(pair) } }),
      ),
    ),
    validRssUrl
      ? db.widgetSnapshot.findUnique({ where: { key: onlineRssKey(validRssUrl) } })
      : null,
    wantSystem ? collectSystemMetrics() : null,
    wantDevMetrics
      ? Promise.all([
          db.device.count({ where: { householdId, revokedAt: null } }),
          db.media.count({ where: { householdId, status: "ready" } }),
        ]).then(([activeDevicesCount, readyPhotosCount]) => ({
          nodeVersion: process.version,
          processUptimeSeconds: Math.max(0, Math.floor(process.uptime())),
          rssMemoryMb: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
          activeDevicesCount,
          readyPhotosCount,
          updatedAt: new Date().toISOString(),
        }))
      : null,
    wantDevMonitor
      ? db.widgetSnapshot.findMany({
          where: {
            key: { startsWith: `push:${householdId}:` },
            expiresAt: { gt: new Date() },
          },
          orderBy: { updatedAt: "desc" },
          take: 30,
        })
      : [],
    wantDevMonitor && referencedPushKeys.length > 0
      ? db.widgetSnapshot.findMany({
          where: {
            key: {
              in: referencedPushKeys.map((pushKey) => `push:${householdId}:${pushKey}`),
            },
            expiresAt: { gt: new Date() },
          },
        })
      : [],
  ]);
  // Providers may take longer than the tablet's HTTP deadline. Return the last cache
  // immediately and refresh in the background; the next normal poll receives new data.
  void refreshOnlineWidgets(db, settings, Boolean(options?.forceRefresh)).catch(() => {
    console.warn("SmartFrame: atualização dos widgets online indisponível.");
  });
  const pushedFeeds: PushedFeedEntry[] = [];
  const pushSnapshotsByKey = new Map(
    [...pushSnapshots, ...referencedPushSnapshots].map((snapshot) => [snapshot.key, snapshot]),
  );
  for (const snapshot of pushSnapshotsByKey.values()) {
    const parsedFeed = pushedFeedEntrySchema.safeParse(snapshot.payload);
    if (parsedFeed.success) pushedFeeds.push(parsedFeed.data);
  }
  const old = (record: { updatedAt: Date; failedAt: Date | null }, ttl = TTL) =>
    Date.now() - record.updatedAt.getTime() >= ttl ||
    (!!record.failedAt && record.failedAt >= record.updatedAt);
  const parsedWeather = weatherPayload.safeParse(weather?.payload);
  const parsedRss = rssCachePayload.safeParse(rssRecord?.payload);
  const rssMaxItems = Math.max(1, Math.min(10, settings.rss?.maxItems ?? 5));
  const currencies: Record<
    string,
    {
      value: number;
      source: string;
      updatedAt: string;
      stale: boolean;
      changePercent?: number;
      changePeriod?: "24h";
    } | null
  > = {};
  for (const pair of pairs) {
    const [base, target] = pair.split("/");
    const record = records[bases.indexOf(base)];
    const parsed = spotPayload.safeParse(record?.payload);
    const value = parsed.success ? parsed.data.rates[target] : null;
    const statsRecord = statsRecords[statsPairs.indexOf(pair)];
    const stats = marketStatsPayload.safeParse(statsRecord?.payload);
    const change = stats.success ? (stats.data.last / stats.data.open - 1) * 100 : NaN;
    currencies[pair] =
      record && value
        ? {
            value,
            source: "Coinbase",
            updatedAt: record.updatedAt.toISOString(),
            stale: old(record, CURRENCY_REFRESH_SECONDS * 1000),
            ...(statsRecord &&
            !old(record, CURRENCY_REFRESH_SECONDS * 1000) &&
            !old(statsRecord, CURRENCY_REFRESH_SECONDS * 1000) &&
            Number.isFinite(change)
              ? { changePercent: change, changePeriod: "24h" as const }
              : {}),
          }
        : null;
  }
  return {
    refreshSeconds: WIDGET_REFRESH_SECONDS,
    currencyRefreshSeconds: CURRENCY_REFRESH_SECONDS,
    rssPending: Boolean(validRssUrl && (!rssRecord || rssRecord.expiresAt.getTime() <= Date.now())),
    currenciesPending: [...records, ...statsRecords].some(
      (record) => !record || record.expiresAt.getTime() <= Date.now(),
    ),
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
    currencies,
    system: systemMetrics,
    rss:
      rssRecord && parsedRss.success
        ? {
            title: parsedRss.data.title,
            items: parsedRss.data.items.slice(0, rssMaxItems),
            updatedAt: rssRecord.updatedAt.toISOString(),
            stale: old(rssRecord, RSS_TTL),
          }
        : null,
    devMonitor: wantDevMetrics
      ? { ...devMetrics!, pushedFeeds }
      : wantDevMonitor
        ? { pushedFeeds }
        : null,
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
