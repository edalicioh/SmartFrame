import { describe, expect, it } from "vitest";
import {
  dashboardRuleSchema,
  defaultOnlineDashboard,
  evaluateEventRules,
  evaluateScheduleNotifications,
  evaluateScheduleRules,
  filterPollSafeScheduleRules,
  gotoPayloadSchema,
  notifyPayloadSchema,
  onlineDashboardSchema,
  pushPayloadSchema,
  readStoredOnlineDashboard,
  webhookKeyCreateSchema,
  webhookTestPayloadSchema,
  type DashboardRule,
} from "@smartframe/contracts";

describe("contratos de regras e webhooks (Fase 5)", () => {
  it("não agenda janelas menores que o intervalo de polling e preserva as demais", () => {
    const rules = [
      {
        id: "short",
        name: "Janela curta",
        enabled: true,
        trigger: { type: "time_range", startTime: "10:00", endTime: "10:01", daysOfWeek: [1] },
        action: { type: "goto_page", pageId: "page-a", durationSeconds: 0 },
      },
      {
        id: "long",
        name: "Janela longa",
        enabled: true,
        trigger: { type: "time_range", startTime: "10:00", endTime: "10:06", daysOfWeek: [1] },
        action: { type: "goto_page", pageId: "page-a", durationSeconds: 0 },
      },
    ] as DashboardRule[];
    expect(filterPollSafeScheduleRules(rules, 300).map(({ id }) => id)).toEqual(["long"]);
    expect(filterPollSafeScheduleRules(rules, 60).map(({ id }) => id)).toEqual(["short", "long"]);
  });

  it("valida regras declarativas e rejeita configurações inconsistentes", () => {
    const valid = onlineDashboardSchema.parse({
      ...defaultOnlineDashboard,
      widgets: {
        ...defaultOnlineDashboard.widgets,
        devMonitor: {
          ...defaultOnlineDashboard.widgets.devMonitor,
          enabled: true,
          items: [
            {
              id: "ci-1",
              name: "CI Principal",
              category: "ci",
              status: "healthy",
              detail: "",
              pushKey: "ci-main",
            },
          ],
        },
      },
      pages: [
        { id: "home", title: "Início", enabledWidgets: ["photos", "clock"] },
        { id: "alerts", title: "Alertas", enabledWidgets: ["devMonitor"] },
      ],
      rules: [
        {
          id: "r-push",
          name: "Falha no CI",
          enabled: true,
          trigger: { type: "push_event", feedKey: "ci-main", status: "failing" },
          action: { type: "goto_page", pageId: "alerts", durationSeconds: 60 },
        },
        {
          id: "r-time",
          name: "Horário comercial",
          enabled: true,
          trigger: {
            type: "time_range",
            startTime: "09:00",
            endTime: "18:00",
            daysOfWeek: [1, 2, 3, 4, 5],
          },
          action: { type: "goto_page", pageId: "home", durationSeconds: 0 },
        },
      ],
    });
    expect(valid.rules).toHaveLength(2);

    // Rejeita goto_page em página inexistente ou em painel de página única.
    expect(() =>
      onlineDashboardSchema.parse({
        ...defaultOnlineDashboard,
        pages: [{ id: "home", title: "Início", enabledWidgets: ["photos"] }],
        rules: [
          {
            id: "r1",
            name: "Inexistente",
            enabled: true,
            trigger: { type: "notify_event", minSeverity: "alert" },
            action: { type: "goto_page", pageId: "missing" },
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      onlineDashboardSchema.parse({
        ...defaultOnlineDashboard,
        rules: [
          {
            id: "r1",
            name: "Sem páginas",
            enabled: true,
            trigger: { type: "notify_event", minSeverity: "alert" },
            action: { type: "goto_page", pageId: "home" },
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      dashboardRuleSchema.parse({
        id: "r-eq",
        name: "Horário igual",
        enabled: true,
        trigger: { type: "time_range", startTime: "10:00", endTime: "10:00", daysOfWeek: [1] },
        action: { type: "show_notification", message: "Teste" },
      }),
    ).toThrow();
  });

  it("avalia regras de evento de forma determinística", () => {
    const rules: DashboardRule[] = [
      {
        id: "r-disabled",
        name: "Desativada",
        enabled: false,
        trigger: { type: "push_event", feedKey: "ci" },
        action: { type: "goto_page", pageId: "alerts", durationSeconds: 0 },
      },
      {
        id: "r-ci-fail",
        name: "CI falhou",
        enabled: true,
        trigger: { type: "push_event", feedKey: "ci", status: "failing" },
        action: { type: "goto_page", pageId: "alerts", durationSeconds: 120 },
      },
      {
        id: "r-notify-warn",
        name: "Aviso ou crítico",
        enabled: true,
        trigger: { type: "notify_event", minSeverity: "warning" },
        action: {
          type: "show_notification",
          title: "Escalonado",
          message: "Verifique painel",
          severity: "alert",
          durationSeconds: 15,
        },
      },
    ];

    expect(
      evaluateEventRules(rules, { type: "push_event", feedKey: "ci", status: "healthy" }),
    ).toEqual([]);
    expect(
      evaluateEventRules(rules, { type: "push_event", feedKey: "ci", status: "failing" }).map(
        (r) => r.id,
      ),
    ).toEqual(["r-ci-fail"]);

    expect(evaluateEventRules(rules, { type: "notify_event", severity: "info" })).toEqual([]);
    expect(
      evaluateEventRules(rules, { type: "notify_event", severity: "alert" }).map((r) => r.id),
    ).toEqual(["r-notify-warn"]);
  });

  it("avalia regras de horário no fuso horário e na virada da meia-noite", () => {
    const rules: DashboardRule[] = [
      {
        id: "r-work",
        name: "Trabalho",
        enabled: true,
        trigger: {
          type: "time_range",
          startTime: "09:00",
          endTime: "18:00",
          daysOfWeek: [1, 2, 3, 4, 5],
        },
        action: { type: "goto_page", pageId: "work", durationSeconds: 0 },
      },
      {
        id: "r-night",
        name: "Madrugada",
        enabled: true,
        trigger: {
          type: "time_range",
          startTime: "22:00",
          endTime: "06:00",
          daysOfWeek: [5], // sexta-feira à noite até sábado 06h
        },
        action: { type: "goto_page", pageId: "night", durationSeconds: 0 },
      },
    ];

    // 2026-11-20 é sexta-feira. 13:00 UTC = 10:00 em America/Sao_Paulo (-03:00).
    const workMatch = evaluateScheduleRules(
      rules,
      new Date("2026-11-20T13:00:00Z"),
      "America/Sao_Paulo",
    );
    expect(workMatch?.pageId).toBe("work");
    expect(workMatch?.directiveId).toBe("schedule:r-work:2026-11-20:09:00-18:00");

    // 2026-11-21 04:00Z é sábado em UTC, dentro da janela que iniciou sexta 22:00Z.
    const overnightMatch = evaluateScheduleRules(rules, new Date("2026-11-21T04:00:00Z"), "UTC");
    expect(overnightMatch?.pageId).toBe("night");
    expect(overnightMatch?.directiveId).toBe("schedule:r-night:2026-11-20:22:00-06:00");

    // Fora da janela (sábado 06:00 UTC)
    expect(evaluateScheduleRules(rules, new Date("2026-11-21T06:00:00Z"), "UTC")).toBeNull();

    const notifyRules: DashboardRule[] = [
      ...rules,
      {
        id: "r-standup",
        name: "Aviso diário",
        enabled: true,
        trigger: {
          type: "time_range",
          startTime: "09:00",
          endTime: "10:00",
          daysOfWeek: [1, 2, 3, 4, 5],
        },
        action: {
          type: "show_notification",
          title: "Daily",
          message: "Hora da reunião",
          severity: "info",
          durationSeconds: 15,
        },
      },
    ];
    const scheduledNotifs = evaluateScheduleNotifications(
      notifyRules,
      new Date("2026-11-20T12:30:00Z"),
      "America/Sao_Paulo",
    );
    expect(scheduledNotifs).toHaveLength(1);
    expect(scheduledNotifs[0]).toMatchObject({
      id: "schedule:r-standup:2026-11-20:09:00-10:00",
      title: "Daily",
      message: "Hora da reunião",
      severity: "info",
      durationSeconds: 15,
    });
    expect(
      evaluateScheduleNotifications(
        notifyRules,
        new Date("2026-11-20T14:00:00Z"),
        "America/Sao_Paulo",
      ),
    ).toEqual([]);
  });

  it("valida payloads de push, notify, goto, chaves e testes e sanitiza caracteres de controle", () => {
    expect(() => pushPayloadSchema.parse({})).toThrow();
    expect(pushPayloadSchema.parse({ value: "42°C", category: "service" }).ttlSeconds).toBe(86_400);
    expect(
      pushPayloadSchema.parse({ name: "  CI\x00\x07 Main ", detail: "ok\x1f!" }),
    ).toMatchObject({ name: "CI Main", detail: "ok!" });
    expect(() => pushPayloadSchema.parse({ name: "\x00\x01", status: "healthy" })).toThrow();

    expect(() => notifyPayloadSchema.parse({ message: "Alerta", durationSeconds: 1 })).toThrow();
    expect(() => notifyPayloadSchema.parse({ message: "\x00\x07" })).toThrow();
    expect(
      notifyPayloadSchema.parse({ title: "A\x00viso", message: "Deploy\x07 ok" }),
    ).toMatchObject({
      title: "Aviso",
      message: "Deploy ok",
      severity: "info",
      durationSeconds: 8,
    });
    expect(gotoPayloadSchema.parse({})).toEqual({ durationSeconds: 0, refresh: false });
    expect(webhookKeyCreateSchema.parse({ name: "Home\x00 Assistant" })).toMatchObject({
      name: "Home Assistant",
      permissions: ["push", "notify", "goto", "refresh"],
    });
    expect(() => webhookTestPayloadSchema.parse({ action: "push", key: "ci" })).toThrow();
  });

  it("cobre bordas de time_range (início inclusivo, fim exclusivo, madrugada e virada de fuso)", () => {
    const overnightRules: DashboardRule[] = [
      {
        id: "r-madrugada",
        name: "Silêncio noturno",
        enabled: true,
        trigger: {
          type: "time_range",
          startTime: "22:00",
          endTime: "06:00",
          daysOfWeek: [5], // apenas sexta
        },
        action: {
          type: "show_notification",
          title: "Modo noturno",
          message: "Silenciar alertas",
          severity: "info",
          durationSeconds: 10,
        },
      },
    ];

    // Início inclusivo: sexta 22:00 em America/Sao_Paulo = sábado 01:00 UTC.
    expect(
      evaluateScheduleNotifications(
        overnightRules,
        new Date("2026-11-21T01:00:00Z"),
        "America/Sao_Paulo",
      ),
    ).toHaveLength(1);

    // Madrugada de sábado 05:59 local (-03:00 -> 08:59 UTC) ainda pertence à janela de sexta.
    expect(
      evaluateScheduleNotifications(
        overnightRules,
        new Date("2026-11-21T08:59:00Z"),
        "America/Sao_Paulo",
      )[0]?.id,
    ).toBe("schedule:r-madrugada:2026-11-20:22:00-06:00");

    // Fim exclusivo: sábado 06:00 local (-03:00 -> 09:00 UTC) não dispara.
    expect(
      evaluateScheduleNotifications(
        overnightRules,
        new Date("2026-11-21T09:00:00Z"),
        "America/Sao_Paulo",
      ),
    ).toEqual([]);

    // Domingo 02:00 local (-03:00 -> 05:00 UTC): prevWeekday é sábado (6), fora de daysOfWeek [5].
    expect(
      evaluateScheduleNotifications(
        overnightRules,
        new Date("2026-11-22T05:00:00Z"),
        "America/Sao_Paulo",
      ),
    ).toEqual([]);
  });

  it("rejeita regra time_range habilitada menor que refreshSeconds ao salvar, preservando leitura de legados", () => {
    const legacyConfig = {
      ...defaultOnlineDashboard,
      refreshSeconds: 300,
      pages: [
        { id: "home", title: "Início", enabledWidgets: ["photos"] },
        { id: "alerts", title: "Alertas", enabledWidgets: ["devMonitor"] },
      ],
      rules: [
        {
          id: "r-too-short",
          name: "Janela 2 min",
          enabled: true,
          trigger: {
            type: "time_range",
            startTime: "10:00",
            endTime: "10:02",
            daysOfWeek: [1, 2, 3, 4, 5],
          },
          action: { type: "goto_page", pageId: "alerts", durationSeconds: 60 },
        },
      ],
    };
    expect(onlineDashboardSchema.safeParse(legacyConfig).success).toBe(false);

    // Se desabilitada, permite manter no rascunho; se já salva em publicação antiga, preserva leitura.
    const disabledRule = {
      ...legacyConfig,
      rules: [{ ...legacyConfig.rules[0], enabled: false }],
    };
    expect(onlineDashboardSchema.safeParse(disabledRule).success).toBe(true);
    const restored = readStoredOnlineDashboard(legacyConfig);
    expect(restored.rules).toHaveLength(1);
    expect(restored.rules?.[0]?.id).toBe("r-too-short");
  });
});
