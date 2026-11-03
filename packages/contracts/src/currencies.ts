import { z } from "zod";

export const currencyCodes = [
  "USD",
  "BRL",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "BTC",
  "ETH",
] as const;
export const defaultCurrencyPairs = ["USD/BRL", "EUR/BRL", "BTC/BRL"];
export const currencyPairSchema = z.string().refine((pair) => {
  const parts = pair.split("/");
  return (
    parts.length === 2 &&
    parts[0] !== parts[1] &&
    parts.every((code) => (currencyCodes as readonly string[]).includes(code))
  );
}, "Par de moedas inválido");

/** Migrate older publications without changing their selected currencies. */
export const onlineCurrenciesSchema = z
  .object({
    enabled: z.boolean().default(true),
    symbols: z
      .array(z.enum(["USD", "EUR", "BTC"]))
      .min(1)
      .max(3)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
    pairs: z
      .array(currencyPairSchema)
      .min(1)
      .max(20)
      .refine((values) => new Set(values).size === values.length, "Pares duplicados")
      .optional(),
    displayCount: z.number().int().min(1).max(4).default(2),
    intervalSeconds: z.number().int().min(5).max(3600).default(10),
  })
  .strict()
  .transform(({ symbols, pairs, ...settings }) => ({
    ...settings,
    pairs: pairs ?? symbols?.map((code) => `${code}/BRL`) ?? [...defaultCurrencyPairs],
  }));
