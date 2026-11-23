import { readStoredOnlineDashboard } from "@smartframe/contracts";
import { getDatabase, type PrismaClient } from "@smartframe/database";
import { authorizePlayer, FrameError } from "@smartframe/frames";
import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import { activeOnlineVersion } from "@/lib/active-online-version";
import { frameResponse, jsonBody, privateHeaders } from "@/lib/frame-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredJsonConfig = Parameters<PrismaClient["layoutVersion"]["update"]>[0]["data"]["config"];

class ConcurrentTaskUpdate extends Error {}

async function withTaskWriteRetry<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      const retryable =
        error instanceof ConcurrentTaskUpdate ||
        (error !== null &&
          typeof error === "object" &&
          "code" in error &&
          (error.code === "P2034" || error.code === "P1008"));
      if (!retryable) throw error;
      if (attempt >= 4)
        throw new FrameError(
          409,
          "Painel alterado simultaneamente. Tente marcar a tarefa novamente.",
        );
      // Each attempt starts a new transaction and reads both snapshots again.
      await delay(10 * (attempt + 1));
    }
  }
}

const toggleTaskBody = z
  .object({
    revision: z.string().regex(/^online:[A-Za-z0-9_-]{1,128}$/),
    taskId: z.string().min(1).max(128),
    completed: z.boolean(),
  })
  .strict();

export async function POST(request: Request) {
  return frameResponse(async () => {
    const db = getDatabase();
    const device = await authorizePlayer(db, request.headers.get("authorization"));
    const params = new URL(request.url).searchParams;
    if (params.has("deviceId") && params.get("deviceId") !== device.id) {
      throw new FrameError(403, "Dispositivo não autorizado.");
    }
    const body = toggleTaskBody.parse(await jsonBody(request));

    const result = await withTaskWriteRetry(() =>
      db.$transaction(async (tx) => {
        const txClient = tx as unknown as PrismaClient;
        // Re-read on every attempt: activation may have changed since authorization.
        const currentDevice = await tx.device.findFirst({
          where: { id: device.id, tokenHash: device.tokenHash, revokedAt: null },
        });
        if (!currentDevice) throw new FrameError(401, "Dispositivo não autorizado.");
        const version = await activeOnlineVersion(txClient, currentDevice, {
          consistentRead: false,
        });
        if (!version) {
          throw new FrameError(
            409,
            "Este dispositivo ainda não possui uma configuração publicada.",
          );
        }
        if (body.revision !== `online:${version.id}`) {
          throw new FrameError(409, "O painel exibido mudou. Atualize antes de marcar a tarefa.");
        }

        const config = readStoredOnlineDashboard(version.config);
        if (!config.widgets.tasks.interactive) {
          throw new FrameError(403, "Interação de tarefas desativada neste painel.");
        }

        const existing = config.widgets.tasks.items;
        if (!existing.some((item) => item.id === body.taskId)) {
          throw new FrameError(404, "Tarefa não encontrada.");
        }

        const nextItems = existing.map((item) =>
          item.id === body.taskId ? { ...item, completed: body.completed } : item,
        );
        const nextConfig = {
          ...config,
          widgets: {
            ...config.widgets,
            tasks: {
              ...config.widgets.tasks,
              items: nextItems,
            },
          },
        };

        const changedVersion = await tx.layoutVersion.updateMany({
          where: { id: version.id, config: { equals: version.config ?? {} } },
          data: { config: nextConfig as StoredJsonConfig },
        });
        if (!changedVersion.count) throw new ConcurrentTaskUpdate("Published tasks changed.");

        const layout = await tx.layout.findUnique({ where: { id: version.layoutId } });
        let shouldSyncDraft = Boolean(layout?.draft && layout.publishedVersionId === version.id);
        if (layout?.draft && layout.key?.startsWith("online:")) {
          // Legacy panels preserve Layout.publishedVersionId as fallback; compare against
          // the newest LayoutVersion instead so cross-device publications still sync tasks.
          const latestVersions = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "LayoutVersion"
            WHERE "layoutId" = ${layout.id}
            ORDER BY "createdAt" DESC, "rowid" DESC
            LIMIT 1
          `;
          shouldSyncDraft = latestVersions[0]?.id === version.id;
        }
        // A device pinned to an older publication may update that version only.
        if (layout?.draft && shouldSyncDraft) {
          let draftConfig: ReturnType<typeof readStoredOnlineDashboard> | null = null;
          try {
            draftConfig = readStoredOnlineDashboard(layout.draft);
          } catch (error) {
            if (!(error instanceof z.ZodError)) throw error;
            // A partially edited draft must not prevent completion on the tablet.
          }
          if (draftConfig?.widgets.tasks.items.some((item) => item.id === body.taskId)) {
            const nextDraft = {
              ...draftConfig,
              widgets: {
                ...draftConfig.widgets,
                tasks: {
                  ...draftConfig.widgets.tasks,
                  items: draftConfig.widgets.tasks.items.map((item) =>
                    item.id === body.taskId ? { ...item, completed: body.completed } : item,
                  ),
                },
              },
            };
            const changedDraft = await tx.layout.updateMany({
              where: {
                id: layout.id,
                householdId: device.householdId,
                publishedVersionId: layout.publishedVersionId,
                draftRevision: layout.draftRevision,
              },
              data: {
                draft: nextDraft as StoredJsonConfig,
                draftRevision: { increment: 1 },
              },
            });
            // Throw outside the parsing catch so the published write is rolled back too.
            if (!changedDraft.count) throw new ConcurrentTaskUpdate("Draft changed.");
          }
        }

        const unchangedDevice = await tx.device.updateMany({
          where: {
            id: device.id,
            tokenHash: device.tokenHash,
            revokedAt: null,
            activePanelId: currentDevice.activePanelId,
            activePanelVersionId: currentDevice.activePanelVersionId,
          },
          data: { lastSeenAt: new Date() },
        });
        if (!unchangedDevice.count) throw new ConcurrentTaskUpdate("Active panel changed.");

        return nextItems;
      }),
    );

    return Response.json(
      { ok: true, taskId: body.taskId, completed: body.completed, items: result },
      { headers: privateHeaders },
    );
  });
}
