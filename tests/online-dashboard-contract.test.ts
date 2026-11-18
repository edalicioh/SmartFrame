import { describe, expect, it } from "vitest";
import {
  applyPanelTemplate,
  defaultOnlineDashboard,
  isSafePublicHttpsUrl,
  onlineDashboardSchema,
  pageSettingsSchema,
  panelTemplates,
  resolveScopedAppearance,
  smartStackSchema,
} from "@smartframe/contracts";

describe("contrato do dashboard online", () => {
  it("define defaults de layout e atualização", () => {
    expect(defaultOnlineDashboard.layoutOptions.photoWidthPercent).toBe(62);
    expect(defaultOnlineDashboard.refreshSeconds).toBe(15);
    expect(defaultOnlineDashboard.widgets.clock.showDate).toBe(false);
    expect(
      onlineDashboardSchema.parse({ widgets: { clock: { showDate: true } } }).widgets.clock
        .showDate,
    ).toBe(false);
  });

  it("aceita no máximo 100 IDs de foto únicos", () => {
    const photoIds = Array.from({ length: 100 }, (_, index) => `photo-${index}`);
    expect(onlineDashboardSchema.safeParse({ widgets: { photos: { photoIds } } }).success).toBe(
      true,
    );
    expect(
      onlineDashboardSchema.safeParse({ widgets: { photos: { photoIds: [...photoIds, "extra"] } } })
        .success,
    ).toBe(false);
    expect(
      onlineDashboardSchema.safeParse({ widgets: { photos: { photoIds: ["same", "same"] } } })
        .success,
    ).toBe(false);
  });

  it("preserva o estilo padrão de publicações antigas e valida fundo e tamanho por widget", () => {
    const original = onlineDashboardSchema.parse({ widgets: { clock: { format: "12h" } } });
    for (const key of ["clock", "weather", "currencies", "calendar"] as const) {
      expect(original.widgets[key].backgroundColor).toBe("");
      expect(original.widgets[key].cardSize).toBe("normal");
      expect(
        onlineDashboardSchema.safeParse({ widgets: { [key]: { cardSize: "huge" } } }).success,
      ).toBe(false);
      expect(
        onlineDashboardSchema.safeParse({ widgets: { [key]: { backgroundColor: "red" } } }).success,
      ).toBe(false);
    }
    expect(original.widgets.photos.backgroundColor).toBe("");
    const updated = onlineDashboardSchema.parse({
      widgets: {
        photos: { backgroundColor: "#123456" },
        clock: { backgroundColor: "#abc", cardSize: "large" },
        weather: { backgroundColor: "#ffffff", cardSize: "small" },
        currencies: { backgroundColor: "#222326", cardSize: "large" },
        calendar: { backgroundColor: "#000000", cardSize: "small" },
      },
    });
    expect(onlineDashboardSchema.parse(updated)).toEqual(updated);
  });

  it("migra as moedas antigas e permite pares com destinos diferentes", () => {
    const legacy = onlineDashboardSchema.parse({
      widgets: { currencies: { symbols: ["BTC", "USD"] } },
    });
    expect(legacy.widgets.currencies.pairs).toEqual(["BTC/BRL", "USD/BRL"]);
    expect(legacy.widgets.currencies).not.toHaveProperty("symbols");
    const config = onlineDashboardSchema.parse({
      widgets: {
        currencies: {
          pairs: ["USD/BRL", "BTC/USD", "ETH/EUR", "BRL/BTC"],
          displayCount: 3,
        },
      },
    });
    expect(config.widgets.currencies.pairs).toHaveLength(4);
    expect(config.widgets.currencies.displayCount).toBe(3);
    expect(onlineDashboardSchema.parse(config)).toEqual(config);
  });

  it("rejeita pares inválidos, duplicados e quantidades fora dos limites", () => {
    for (const currencies of [
      { pairs: [] },
      { pairs: ["USD/BRL", "USD/BRL"] },
      { pairs: ["USD/USD"] },
      { pairs: ["XYZ/BRL"] },
      { pairs: ["USD/BRL/ETH"] },
      { pairs: ["usd/brl"] },
      { displayCount: 0 },
      { displayCount: 5 },
      { displayCount: 1.5 },
      { pairs: Array.from({ length: 21 }, () => "BTC/USD") },
    ])
      expect(onlineDashboardSchema.safeParse({ widgets: { currencies } }).success).toBe(false);
  });

  it("rejeita valores fora dos limites e propriedades não previstas", () => {
    expect(onlineDashboardSchema.safeParse({ refreshSeconds: 9 }).success).toBe(false);
    expect(
      onlineDashboardSchema.safeParse({ layoutOptions: { photoWidthPercent: 39 } }).success,
    ).toBe(false);
    expect(onlineDashboardSchema.safeParse({ credential: "secret" }).success).toBe(false);
  });

  it("valida aparência em camadas, limites, descarte no widget e resolução de herança", () => {
    for (const preset of ["default", "cards", "flat", "borderless", "seamless"] as const) {
      const parsed = onlineDashboardSchema.parse({
        appearance: {
          preset,
          cornerRadius: 0,
          widgetSpacing: 24,
          innerPadding: 0,
          pageEdgePadding: 32,
          border: false,
          shadow: true,
        },
        widgets: {
          clock: {
            appearance: { preset, cornerRadius: 32, innerPadding: 24, border: true, shadow: false },
          },
          notes: { backgroundColor: "#112233", appearance: { preset: "default" } },
        },
      });
      expect(parsed.appearance.preset).toBe(preset);
      expect(parsed.appearance.cornerRadius).toBe(0);
      expect(parsed.appearance.border).toBe(false);
      expect(parsed.widgets.clock.appearance?.cornerRadius).toBe(32);
      expect(parsed.widgets.notes.backgroundColor).toBe("#112233");
    }

    for (const bad of [
      { appearance: { cornerRadius: -1 } },
      { appearance: { cornerRadius: 33 } },
      { appearance: { widgetSpacing: 25 } },
      { appearance: { innerPadding: -1 } },
      { appearance: { pageEdgePadding: 33 } },
      { appearance: { preset: "glass" } },
      { widgets: { clock: { appearance: { cornerRadius: 33 } } } },
      { widgets: { clock: { appearance: { unknownField: 1 } } } },
    ]) {
      expect(onlineDashboardSchema.safeParse(bad).success).toBe(false);
    }

    const stripped = onlineDashboardSchema.parse({
      widgets: {
        clock: {
          appearance: {
            cornerRadius: 8,
            widgetSpacing: 20,
            pageEdgePadding: 16,
          },
        },
      },
    });
    expect(stripped.widgets.clock.appearance).toEqual({ cornerRadius: 8 });

    const cards = resolveScopedAppearance({ preset: "cards" });
    expect(cards).toMatchObject({
      preset: "cards",
      surfaceMode: "cards",
      cornerRadius: 18,
      widgetSpacing: 12,
      innerPadding: 12,
      pageEdgePadding: 12,
      border: true,
      shadow: false,
    });

    const explicitZeroFalse = resolveScopedAppearance(
      { preset: "cards", cornerRadius: 0, border: false },
      { shadow: true },
    );
    expect(explicitZeroFalse).toMatchObject({
      preset: "cards",
      cornerRadius: 0,
      border: false,
      shadow: true,
      widgetSpacing: 12,
    });

    const restoredWidget = resolveScopedAppearance(
      { preset: "flat", cornerRadius: 20, widgetSpacing: 16, pageEdgePadding: 24 },
      { preset: "default" },
    );
    expect(restoredWidget).toEqual({
      preset: "default",
      surfaceMode: "default",
      cornerRadius: null,
      widgetSpacing: 16,
      innerPadding: null,
      pageEdgePadding: 24,
      border: null,
      shadow: null,
    });
  });

  it("valida grade livre opcional (limites, mínimos e colisão apenas entre ativos)", () => {
    const valid = onlineDashboardSchema.parse({
      gridLayout: {
        enabled: true,
        landscape: [
          { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
          { widgetId: "clock", x: 14, y: 0, w: 10, h: 6 },
          { widgetId: "weather", x: 14, y: 6, w: 10, h: 6 },
          { widgetId: "currencies", x: 14, y: 12, w: 10, h: 6 },
          { widgetId: "calendar", x: 14, y: 18, w: 10, h: 6 },
          // Posição armazenada de widget desativado pode sobrepor sem bloquear.
          { widgetId: "notes", x: 0, y: 0, w: 4, h: 3 },
        ],
        portrait: [
          { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
          { widgetId: "clock", x: 0, y: 20, w: 12, h: 5 },
          { widgetId: "weather", x: 0, y: 25, w: 12, h: 5 },
          { widgetId: "currencies", x: 0, y: 30, w: 12, h: 5 },
          { widgetId: "calendar", x: 0, y: 35, w: 12, h: 5 },
          { widgetId: "notes", x: 0, y: 0, w: 4, h: 3 },
        ],
      },
    });
    expect(valid.gridLayout?.enabled).toBe(true);
    expect(onlineDashboardSchema.parse(valid)).toEqual(valid);

    // Colisão entre widgets ativos quando gridLayout.enabled === true deve falhar.
    expect(
      onlineDashboardSchema.safeParse({
        gridLayout: {
          enabled: true,
          landscape: [
            { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
            { widgetId: "clock", x: 10, y: 0, w: 10, h: 6 },
          ],
        },
      }).success,
    ).toBe(false);

    // Quando gridLayout.enabled === false (modo clássico), manter posições antigas não bloqueia.
    expect(
      onlineDashboardSchema.safeParse({
        gridLayout: {
          enabled: false,
          landscape: [
            { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
            { widgetId: "clock", x: 10, y: 0, w: 10, h: 6 },
          ],
        },
      }).success,
    ).toBe(true);

    // Limites da grade e tamanhos mínimos do catálogo (incluindo Pomodoro 3x3).
    for (const invalid of [
      {
        gridLayout: { enabled: true, landscape: [{ widgetId: "photos", x: 21, y: 0, w: 4, h: 4 }] },
      },
      { gridLayout: { enabled: true, portrait: [{ widgetId: "clock", x: 0, y: 39, w: 4, h: 2 }] } },
      {
        gridLayout: {
          enabled: true,
          landscape: [{ widgetId: "pomodoro", x: 0, y: 0, w: 3, h: 2 }],
        },
      },
      {
        gridLayout: { enabled: true, landscape: [{ widgetId: "photos", x: 0, y: 0, w: 3, h: 4 }] },
      },
    ]) {
      expect(onlineDashboardSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("exige posição para todo widget ativado quando a grade está em uso", () => {
    const landscape = [
      { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
      { widgetId: "clock", x: 14, y: 0, w: 10, h: 6 },
      { widgetId: "weather", x: 14, y: 6, w: 10, h: 6 },
      { widgetId: "currencies", x: 14, y: 12, w: 10, h: 6 },
      { widgetId: "calendar", x: 14, y: 18, w: 10, h: 6 },
    ];
    const portrait = [
      { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
      { widgetId: "clock", x: 0, y: 20, w: 12, h: 5 },
      { widgetId: "weather", x: 0, y: 25, w: 12, h: 5 },
      { widgetId: "currencies", x: 0, y: 30, w: 12, h: 5 },
      { widgetId: "calendar", x: 0, y: 35, w: 12, h: 5 },
    ];

    expect(
      onlineDashboardSchema.safeParse({ gridLayout: { enabled: true, landscape, portrait } })
        .success,
    ).toBe(true);

    // Falta um widget ativado em apenas uma das orientações.
    for (const { grid, missing } of [
      { grid: { enabled: true, landscape: landscape.slice(1), portrait }, missing: "landscape" },
      { grid: { enabled: true, landscape, portrait: portrait.slice(1) }, missing: "portrait" },
      { grid: { enabled: true, landscape: [], portrait: [] }, missing: "ambas" },
    ] as const) {
      const result = onlineDashboardSchema.safeParse({ gridLayout: grid });
      expect(result.success).toBe(false);
      const messages = result.error?.issues.map((issue) => issue.message) ?? [];
      const orientations = missing === "ambas" ? ["landscape", "portrait"] : [missing];
      for (const orientation of orientations) {
        expect(messages).toContain(`Widget ativado sem posição na grade de ${orientation}`);
      }
      if (missing !== "ambas") {
        const other = missing === "landscape" ? "portrait" : "landscape";
        expect(messages).not.toContain(`Widget ativado sem posição na grade de ${other}`);
      }
    }

    // Widget local ativado também precisa de posição nas duas orientações.
    expect(
      onlineDashboardSchema.safeParse({
        widgets: { notes: { enabled: true } },
        gridLayout: { enabled: true, landscape, portrait },
      }).success,
    ).toBe(false);

    // Widget desativado pode manter (ou não) posições armazenadas.
    expect(
      onlineDashboardSchema.safeParse({
        gridLayout: { enabled: false, landscape: [], portrait: [] },
      }).success,
    ).toBe(true);
  });

  it("valida todos os 6 templates e preserva dados do usuário ao aplicar", () => {
    expect(panelTemplates).toHaveLength(6);

    const base = onlineDashboardSchema.parse({
      timezone: "America/Manaus",
      widgets: {
        photos: { photoIds: ["foto-1", "foto-2"], intervalSeconds: 30, fit: "contain" },
        clock: { format: "12h", backgroundColor: "#112233" },
        weather: { city: "Florianópolis" },
        calendar: { highlightToday: false },
        notes: { messages: [{ id: "m1", text: "Buscar pão" }], intervalSeconds: 20 },
        tasks: { items: [{ id: "t1", text: "Regar plantas", completed: false }] },
        pomodoro: { workMinutes: 40, breakMinutes: 10 },
      },
    });

    for (const template of panelTemplates) {
      const applied = applyPanelTemplate(base, template.id);
      expect(() => onlineDashboardSchema.parse(applied)).not.toThrow();
      expect(applied.gridLayout?.enabled).toBe(true);
      expect(applied.timezone).toBe("America/Manaus");
      expect(applied.widgets.photos.photoIds).toEqual(["foto-1", "foto-2"]);
      expect(applied.widgets.photos.intervalSeconds).toBe(30);
      expect(applied.widgets.clock.format).toBe("12h");
      expect(applied.widgets.clock.backgroundColor).toBe("#112233");
      expect(applied.widgets.weather.city).toBe("Florianópolis");
      expect(applied.widgets.calendar.highlightToday).toBe(false);
      expect(applied.widgets.notes.messages).toEqual([{ id: "m1", text: "Buscar pão" }]);
      expect(applied.widgets.tasks.items).toEqual([
        { id: "t1", text: "Regar plantas", completed: false },
      ]);
      expect(applied.widgets.pomodoro.workMinutes).toBe(40);
    }
  });

  it("valida Smart Stack com até 12 widgets únicos, intervalo >= 5s (ou 0) e slot compartilhado na grade", () => {
    expect(smartStackSchema.parse({})).toEqual({
      enabled: false,
      title: "Smart Stack",
      widgets: [],
      intervalSeconds: 10,
      showIndicators: true,
    });
    expect(smartStackSchema.safeParse({ intervalSeconds: 0 }).success).toBe(true);
    expect(smartStackSchema.safeParse({ intervalSeconds: 4 }).success).toBe(false);
    expect(smartStackSchema.safeParse({ widgets: ["clock", "clock"] }).success).toBe(false);

    // Membros da mesma pilha podem ocupar o mesmo slot na grade sem acusar colisão.
    const validStacked = onlineDashboardSchema.safeParse({
      widgets: {
        photos: { enabled: true },
        clock: { enabled: true },
        weather: { enabled: true },
        currencies: { enabled: false },
        calendar: { enabled: false },
      },
      smartStack: {
        enabled: true,
        title: "Rotativo",
        widgets: ["clock", "weather"],
        intervalSeconds: 15,
        showIndicators: true,
      },
      gridLayout: {
        enabled: true,
        landscape: [
          { widgetId: "photos", x: 0, y: 0, w: 14, h: 24 },
          { widgetId: "clock", x: 14, y: 0, w: 10, h: 12 },
          { widgetId: "weather", x: 14, y: 0, w: 10, h: 12 },
        ],
        portrait: [
          { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
          { widgetId: "clock", x: 0, y: 20, w: 12, h: 10 },
          { widgetId: "weather", x: 0, y: 20, w: 12, h: 10 },
        ],
      },
    });
    expect(validStacked.success).toBe(true);

    const undersizedAnchor = onlineDashboardSchema.safeParse({
      widgets: {
        photos: { enabled: true },
        clock: { enabled: true },
        weather: { enabled: false },
        currencies: { enabled: false },
        calendar: { enabled: false },
      },
      smartStack: { enabled: true, widgets: ["clock", "photos"] },
      gridLayout: {
        enabled: true,
        landscape: [
          { widgetId: "clock", x: 0, y: 0, w: 3, h: 2 },
          { widgetId: "photos", x: 4, y: 0, w: 4, h: 4 },
        ],
        portrait: [
          { widgetId: "clock", x: 0, y: 0, w: 3, h: 2 },
          { widgetId: "photos", x: 4, y: 0, w: 4, h: 4 },
        ],
      },
    });
    expect(undersizedAnchor.success).toBe(false);

    // A non-stack widget may occupy a secondary member's obsolete position:
    // the player renders that member in the first stack member's anchor box.
    const oldSecondaryPositionOverlap = onlineDashboardSchema.safeParse({
      widgets: {
        photos: { enabled: true },
        clock: { enabled: true },
        weather: { enabled: true },
        currencies: { enabled: false },
        calendar: { enabled: false },
      },
      smartStack: { enabled: true, widgets: ["clock", "weather"] },
      gridLayout: {
        enabled: true,
        landscape: [
          { widgetId: "clock", x: 0, y: 0, w: 4, h: 4 },
          { widgetId: "weather", x: 8, y: 8, w: 4, h: 4 },
          { widgetId: "photos", x: 8, y: 8, w: 4, h: 4 },
        ],
        portrait: [
          { widgetId: "clock", x: 0, y: 0, w: 4, h: 4 },
          { widgetId: "weather", x: 6, y: 6, w: 4, h: 4 },
          { widgetId: "photos", x: 6, y: 6, w: 4, h: 4 },
        ],
      },
    });
    expect(oldSecondaryPositionOverlap.success).toBe(true);

    // Ainda rejeita colisão entre membro da pilha e widget fora da pilha.
    const overlappingNonStack = onlineDashboardSchema.safeParse({
      widgets: {
        photos: { enabled: true },
        clock: { enabled: true },
        weather: { enabled: true },
        currencies: { enabled: false },
        calendar: { enabled: false },
      },
      smartStack: {
        enabled: true,
        title: "Rotativo",
        widgets: ["clock", "weather"],
      },
      gridLayout: {
        enabled: true,
        landscape: [
          { widgetId: "photos", x: 0, y: 0, w: 16, h: 24 },
          { widgetId: "clock", x: 14, y: 0, w: 10, h: 12 },
          { widgetId: "weather", x: 14, y: 0, w: 10, h: 12 },
        ],
        portrait: [
          { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
          { widgetId: "clock", x: 0, y: 20, w: 12, h: 10 },
          { widgetId: "weather", x: 0, y: 20, w: 12, h: 10 },
        ],
      },
    });
    expect(overlappingNonStack.success).toBe(false);
  });

  it("valida múltiplas páginas (1..8) com IDs únicos e pageSettings", () => {
    expect(pageSettingsSchema.parse({})).toEqual({
      autoRotateSeconds: 0,
      showIndicators: true,
      swipeEnabled: true,
    });
    expect(pageSettingsSchema.safeParse({ autoRotateSeconds: 3 }).success).toBe(false);
    expect(pageSettingsSchema.safeParse({ autoRotateSeconds: 5 }).success).toBe(true);

    const validPages = onlineDashboardSchema.safeParse({
      pageSettings: { autoRotateSeconds: 20, showIndicators: true, swipeEnabled: true },
      pages: [
        {
          id: "page-1",
          title: "Principal",
          enabledWidgets: ["photos", "clock"],
          gridLayout: {
            enabled: true,
            landscape: [
              { widgetId: "photos", x: 0, y: 0, w: 16, h: 24 },
              { widgetId: "clock", x: 16, y: 0, w: 8, h: 8 },
            ],
            portrait: [
              { widgetId: "photos", x: 0, y: 0, w: 12, h: 20 },
              { widgetId: "clock", x: 0, y: 20, w: 12, h: 8 },
            ],
          },
        },
        {
          id: "page-2",
          title: "Resumo",
          enabledWidgets: ["weather"],
        },
      ],
    });
    expect(validPages.success).toBe(true);

    // IDs duplicados ou 9 páginas devem falhar.
    expect(
      onlineDashboardSchema.safeParse({
        pages: [
          { id: "dup", title: "A", enabledWidgets: ["photos"] },
          { id: "dup", title: "B", enabledWidgets: ["clock"] },
        ],
      }).success,
    ).toBe(false);
    expect(
      onlineDashboardSchema.safeParse({
        pages: Array.from({ length: 9 }, (_, i) => ({
          id: `p-${i + 1}`,
          title: `P${i + 1}`,
          enabledWidgets: ["photos"],
        })),
      }).success,
    ).toBe(false);
    expect(
      onlineDashboardSchema.safeParse({
        pages: [],
      }).success,
    ).toBe(false);
  });

  it("valida os novos widgets da Fase 4, URL HTTPS pública sem SSRF e tasks.interactive", () => {
    expect(defaultOnlineDashboard.widgets.tasks.interactive).toBe(true);
    expect(defaultOnlineDashboard.widgets.system.enabled).toBe(false);
    expect(defaultOnlineDashboard.widgets.worldClock.zones.length).toBeGreaterThanOrEqual(3);
    expect(defaultOnlineDashboard.widgets.rss.rotateSeconds).toBe(15);
    expect(defaultOnlineDashboard.widgets.devMonitor.showServerMetrics).toBe(true);

    expect(isSafePublicHttpsUrl("https://feeds.bbci.co.uk/news/rss.xml")).toBe(true);
    for (const unsafe of [
      "http://example.com/feed.xml",
      "https://localhost/feed.xml",
      "https://127.0.0.1/feed.xml",
      "https://10.0.0.5/feed.xml",
      "https://192.168.1.1/feed.xml",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/feed.xml",
      "https://[fd00::1]/feed.xml",
      "https://user:pass@example.com/feed.xml",
      "https://printer.local/feed.xml",
      "https://localhost./feed.xml",
      "https://printer.local./feed.xml",
      "https://router.internal./feed.xml",
      "https://[febf::1]/feed.xml",
      "https://[::ffff:127.0.0.1]/feed.xml",
      "https://[2002:7f00:1::]/feed.xml",
      "https://224.0.0.1/feed.xml",
      "https://192.0.2.1/feed.xml",
    ]) {
      expect(isSafePublicHttpsUrl(unsafe)).toBe(false);
      expect(
        onlineDashboardSchema.safeParse({ widgets: { rss: { enabled: true, feedUrl: unsafe } } })
          .success,
      ).toBe(false);
    }

    expect(
      onlineDashboardSchema.safeParse({
        widgets: {
          tasks: { interactive: false },
          system: { enabled: true, showCpu: true, showDisk: false },
          worldClock: {
            enabled: true,
            format: "12h",
            zones: [{ id: "z1", label: "Lisboa", timezone: "Europe/Lisbon" }],
          },
          rss: {
            enabled: true,
            feedUrl: "https://feeds.example.org/rss.xml",
            maxItems: 8,
            rotateSeconds: 30,
          },
          devMonitor: {
            enabled: true,
            showServerMetrics: true,
            items: [
              { id: "d1", name: "API Core", category: "service", status: "healthy", detail: "OK" },
              { id: "d2", name: "Agente IA", category: "ai", status: "running", detail: "12s" },
            ],
          },
        },
      }).success,
    ).toBe(true);

    // Fuso inválido e rotação < 5s (diferente de 0) devem ser rejeitados.
    expect(
      onlineDashboardSchema.safeParse({
        widgets: {
          worldClock: { zones: [{ id: "bad", label: "Marte", timezone: "Mars/Phobos" }] },
        },
      }).success,
    ).toBe(false);
    expect(
      onlineDashboardSchema.safeParse({ widgets: { rss: { rotateSeconds: 3 } } }).success,
    ).toBe(false);
  });
});
