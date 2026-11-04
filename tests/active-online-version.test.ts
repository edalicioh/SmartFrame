import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@smartframe/database";

vi.mock("server-only", () => ({}));
import { activeOnlineVersion } from "../apps/web/src/lib/active-online-version";

describe("versão online ativa", () => {
  const device = {
    id: "device",
    householdId: "household",
    activePanelId: "panel",
    activePanelVersionId: "version",
  };

  it("restringe versão, painel e residência ao buscar a publicação fixada", async () => {
    const version = { id: "version", layoutId: "panel" };
    const findFirst = vi.fn().mockResolvedValue(version);
    const legacy = vi.fn();
    const db = {
      layoutVersion: { findFirst },
      layout: { findFirst: legacy },
    } as unknown as PrismaClient;
    expect(await activeOnlineVersion(db, device)).toBe(version);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "version", layoutId: "panel", layout: { householdId: "household" } },
    });
    expect(legacy).not.toHaveBeenCalled();
  });

  it("restringe o fallback legado à residência e rejeita versões de outro painel", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "legacy-panel",
      publishedVersion: { id: "version", layoutId: "different-panel" },
    });
    const db = { layout: { findFirst } } as unknown as PrismaClient;
    const legacy = { ...device, activePanelId: null, activePanelVersionId: null };
    expect(await activeOnlineVersion(db, legacy)).toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { key: "online:device", householdId: "household" },
      include: { publishedVersion: true },
    });
    findFirst.mockResolvedValue({
      id: "legacy-panel",
      publishedVersion: { id: "version", layoutId: "legacy-panel" },
    });
    expect(await activeOnlineVersion(db, legacy)).toEqual({
      id: "version",
      layoutId: "legacy-panel",
    });
  });
});
