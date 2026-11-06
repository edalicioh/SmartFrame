import { describe, expect, it } from "vitest";
import { onlineDashboardSchema } from "@smartframe/contracts";

describe("widgets adicionais do painel online", () => {
  it("mantém painéis antigos compatíveis, sem ativar cartões novos", () => {
    const config = onlineDashboardSchema.parse({});
    for (const key of ["notes", "countdown", "birthdays", "tasks", "pomodoro"] as const)
      expect(config.widgets[key].enabled).toBe(false);
  });

  it("preserva os dados e rejeita datas e durações inválidas", () => {
    const config = onlineDashboardSchema.parse({
      widgets: {
        notes: { enabled: true, messages: [{ id: "1", text: "Olá" }] },
        birthdays: { people: [{ id: "2", name: "Ana", day: 29, month: 2 }] },
        tasks: { items: [{ id: "3", text: "Estudar", completed: false }] },
        pomodoro: { enabled: true, workMinutes: 30, breakMinutes: 10 },
      },
    });
    expect(config.widgets.notes.messages[0].text).toBe("Olá");
    expect(config.widgets.pomodoro.workMinutes).toBe(30);
    expect(
      onlineDashboardSchema.safeParse({ widgets: { pomodoro: { workMinutes: 0 } } }).success,
    ).toBe(false);
    expect(
      onlineDashboardSchema.safeParse({
        widgets: { birthdays: { people: [{ id: "x", name: "Ana", day: 31, month: 2 }] } },
      }).success,
    ).toBe(false);
  });
});
