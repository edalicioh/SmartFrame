import { describe, expect, it } from "vitest";
import { manifestSchema, type PlayerManifest } from "@smartframe/contracts";

function manifest(): PlayerManifest {
  return {
    schemaVersion: 1,
    revision: "rev-1",
    deviceId: "device-1",
    generatedAt: "2026-10-30T10:00:00Z",
    timezone: "America/Sao_Paulo",
    layout: {
      width: 1024,
      height: 600,
      mode: "photo",
      theme: "dark",
      widgets: [
        {
          id: "photo-1",
          type: "photos",
          schemaVersion: 1,
          x: 0,
          y: 0,
          width: 1024,
          height: 600,
          zIndex: 0,
          properties: {
            intervalSeconds: 15,
            order: "sequential",
            fit: "cover",
            transition: "fade",
          },
        },
      ],
    },
    media: [
      { id: "image-1", bytes: 120000, sha256: "a".repeat(64), path: "/api/player/media/image-1" },
    ],
    sync: { pollIntervalSeconds: 30, cacheLimitBytes: 2 * 1024 ** 3 },
  };
}

describe("Contrato do manifesto", () => {
  it("aceita a configuração inicial", () => {
    expect(manifestSchema.parse(manifest()).schemaVersion).toBe(1);
  });
  it("rejeita versões incompatíveis", () => {
    expect(manifestSchema.safeParse({ ...manifest(), schemaVersion: 2 }).success).toBe(false);
  });
  it("rejeita URLs externas para mídia", () => {
    const data = manifest();
    data.media[0].path = "https://outro-servidor/foto.jpg";
    expect(manifestSchema.safeParse(data).success).toBe(false);
  });
  it("rejeita propriedades não conhecidas, inclusive scripts", () => {
    expect(manifestSchema.safeParse({ ...manifest(), script: "alert(1)" }).success).toBe(false);
  });
  it("rejeita widgets fora da área lógica", () => {
    const data = manifest();
    data.layout.widgets[0].x = 100;
    expect(manifestSchema.safeParse(data).success).toBe(false);
  });
  it("rejeita identificadores repetidos", () => {
    const data = manifest();
    data.media.push(data.media[0]);
    expect(manifestSchema.safeParse(data).success).toBe(false);
  });
  it("rejeita fuso inválido e cache abaixo do mínimo", () => {
    expect(manifestSchema.safeParse({ ...manifest(), timezone: "inexistente" }).success).toBe(
      false,
    );
    expect(
      manifestSchema.safeParse({
        ...manifest(),
        sync: { pollIntervalSeconds: 30, cacheLimitBytes: 1 },
      }).success,
    ).toBe(false);
  });
});
