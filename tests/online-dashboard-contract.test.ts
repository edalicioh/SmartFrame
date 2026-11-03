import { describe, expect, it } from "vitest";
import { defaultOnlineDashboard, onlineDashboardSchema } from "@smartframe/contracts";

describe("contrato do dashboard online", () => {
  it("define defaults de layout e atualização", () => {
    expect(defaultOnlineDashboard.layoutOptions.photoWidthPercent).toBe(62);
    expect(defaultOnlineDashboard.refreshSeconds).toBe(15);
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

  it("rejeita valores fora dos limites e propriedades não previstas", () => {
    expect(onlineDashboardSchema.safeParse({ refreshSeconds: 9 }).success).toBe(false);
    expect(
      onlineDashboardSchema.safeParse({ layoutOptions: { photoWidthPercent: 39 } }).success,
    ).toBe(false);
    expect(onlineDashboardSchema.safeParse({ credential: "secret" }).success).toBe(false);
  });
});
