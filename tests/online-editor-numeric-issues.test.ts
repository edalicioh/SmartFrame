import { describe, expect, it } from "vitest";
import {
  clearNumericIssuesForDisabledWidgets,
  widgetKeyFromNumericIssue,
} from "../apps/web/src/lib/online-editor/numeric-issues";

describe("clearNumericIssuesForDisabledWidgets", () => {
  it("deriva o widget a partir do prefixo do campo numérico", () => {
    expect(widgetKeyFromNumericIssue("notes.interval")).toBe("notes");
    expect(widgetKeyFromNumericIssue("birthdays.day.pessoa-1")).toBe("birthdays");
    expect(widgetKeyFromNumericIssue("pomodoro.work")).toBe("pomodoro");
  });

  it("remove somente os erros do widget desativado", () => {
    const previous = { notes: { enabled: true }, pomodoro: { enabled: true } };
    const next = { notes: { enabled: false }, pomodoro: { enabled: true } };
    expect(
      clearNumericIssuesForDisabledWidgets(
        { "notes.interval": "Informe um valor.", "pomodoro.work": "Use um valor entre 1 e 180." },
        previous,
        next,
      ),
    ).toEqual({ "pomodoro.work": "Use um valor entre 1 e 180." });
  });

  it("cobre aniversários com IDs dinâmicos e vários campos do mesmo widget", () => {
    const previous = { birthdays: { enabled: true }, pomodoro: { enabled: true } };
    const next = { birthdays: { enabled: false }, pomodoro: { enabled: true } };
    expect(
      clearNumericIssuesForDisabledWidgets(
        {
          "birthdays.day.a": "Informe um número inteiro.",
          "birthdays.month.a": "Use um valor entre 1 e 12.",
          "birthdays.displayCount": "Use um valor entre 1 e 10.",
          "pomodoro.break": "Informe um número inteiro.",
        },
        previous,
        next,
      ),
    ).toEqual({ "pomodoro.break": "Informe um número inteiro." });
  });

  it("aplica o mesmo comportamento quando um template desativa widgets locais", () => {
    const previous = { photos: { enabled: true }, notes: { enabled: true } };
    const next = { photos: { enabled: true }, notes: { enabled: false } };
    expect(
      clearNumericIssuesForDisabledWidgets(
        { "photos.interval": "Informe um valor.", "notes.interval": "Informe um valor." },
        previous,
        next,
      ),
    ).toEqual({ "photos.interval": "Informe um valor." });
  });

  it("mantém erros de campos que continuam montados ao desativar o widget", () => {
    const previous = {
      photos: { enabled: true },
      currencies: { enabled: true },
      notes: { enabled: true },
    };
    const next = {
      photos: { enabled: false },
      currencies: { enabled: false },
      notes: { enabled: false },
    };
    expect(
      clearNumericIssuesForDisabledWidgets(
        {
          "photos.interval": "Use um valor entre 5 e 3600.",
          "currencies.interval": "Informe um valor.",
          "notes.interval": "Informe um número inteiro.",
        },
        previous,
        next,
      ),
    ).toEqual({
      "photos.interval": "Use um valor entre 5 e 3600.",
      "currencies.interval": "Informe um valor.",
    });
  });

  it("mantém erros montados ao reativar widgets e trocar de aba", () => {
    const enabled = { photos: { enabled: true }, currencies: { enabled: true } };
    const disabled = { photos: { enabled: false }, currencies: { enabled: false } };
    const issue = { "photos.interval": "Informe um valor." };
    expect(clearNumericIssuesForDisabledWidgets(issue, enabled, disabled)).toBe(issue);
    expect(clearNumericIssuesForDisabledWidgets(issue, disabled, enabled)).toBe(issue);
  });

  it("não remove nada quando nenhum widget foi desativado", () => {
    const issues = { "notes.interval": "Informe um valor." };
    const previous = { notes: { enabled: true } };
    expect(clearNumericIssuesForDisabledWidgets(issues, previous, previous)).toBe(issues);
    expect(
      clearNumericIssuesForDisabledWidgets(issues, { notes: { enabled: false } }, previous),
    ).toBe(issues);
  });

  it("devolve a mesma referência quando não há erros a remover", () => {
    const issues = { "pomodoro.work": "Informe um valor." };
    expect(
      clearNumericIssuesForDisabledWidgets(
        issues,
        { notes: { enabled: true } },
        { notes: { enabled: false } },
      ),
    ).toBe(issues);
  });
});
