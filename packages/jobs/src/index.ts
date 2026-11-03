import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@smartframe/database";
import { optimizeBackground } from "@smartframe/frames";
import { refreshPublishedWidgets } from "@smartframe/widgets";

const MAX_ATTEMPTS = 3;
const LEASE_MS = 60_000;

export async function scheduleMaintenance(database: PrismaClient, now = new Date()) {
  const id = `maintenance:${now.toISOString().slice(0, 13)}`;
  await database.job.upsert({
    where: { id },
    create: { id, type: "maintenance.sessions", availableAt: now },
    update: {},
  });
}

export async function scheduleWidgetRefresh(database: PrismaClient, now = new Date()) {
  const id = `widgets:scheduled:${Math.floor(now.getTime() / 300_000)}`;
  await database.job.upsert({
    where: { id },
    create: { id, type: "widgets.refresh", availableAt: now },
    update: {},
  });
}

export async function claimJob(database: PrismaClient, now = new Date()) {
  // Uma tarefa que esgotou tentativas não deve permanecer eternamente em execução.
  await database.job.updateMany({
    where: { status: "running", leaseUntil: { lte: now }, attempts: { gte: MAX_ATTEMPTS } },
    data: {
      status: "failed",
      lastError: "Número máximo de tentativas excedido.",
      leaseUntil: null,
      lockedBy: null,
      finishedAt: now,
    },
  });
  const eligible = {
    attempts: { lt: MAX_ATTEMPTS },
    availableAt: { lte: now },
    OR: [{ status: "pending" }, { status: "running", leaseUntil: { lte: now } }],
  };
  const candidate = await database.job.findFirst({
    where: eligible,
    orderBy: [{ availableAt: "asc" }, { id: "asc" }],
  });
  if (!candidate) return null;
  const lockedBy = randomUUID();
  const claimed = await database.job.updateMany({
    where: { id: candidate.id, ...eligible },
    data: {
      status: "running",
      attempts: { increment: 1 },
      lockedBy,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
    },
  });
  if (claimed.count !== 1) return null;
  return { ...candidate, attempts: candidate.attempts + 1, lockedBy };
}

export async function runOneJob(database: PrismaClient, now = new Date()) {
  const job = await claimJob(database, now);
  if (!job) return false;
  const renewal = setInterval(() => {
    void database.job
      .updateMany({
        where: { id: job.id, lockedBy: job.lockedBy, status: "running" },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      })
      .catch(() => {});
  }, 20_000);
  renewal.unref();
  try {
    if (job.type === "background.optimize") {
      await optimizeBackground(database, job.id);
    } else if (job.type === "widgets.refresh") {
      await refreshPublishedWidgets(database);
    } else if (job.type === "maintenance.sessions") {
      // Este handler é idempotente. Novos handlers devem ser idempotentes ou renovar a lease.
      await database.$transaction([
        database.session.deleteMany({ where: { expiresAt: { lt: now } } }),
        database.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
        database.pairingCode.deleteMany({
          where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
        }),
        database.requestLimit.deleteMany({
          where: { windowStart: { lt: new Date(now.getTime() - 86_400_000) } },
        }),
        database.job.deleteMany({
          where: {
            status: "completed",
            finishedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) },
          },
        }),
      ]);
    } else {
      throw new Error("Tipo de tarefa não suportado.");
    }
    await database.job.updateMany({
      where: { id: job.id, lockedBy: job.lockedBy, status: "running" },
      data: {
        status: "completed",
        finishedAt: now,
        lockedBy: null,
        leaseUntil: null,
        lastError: null,
      },
    });
  } catch {
    await database.job.updateMany({
      where: { id: job.id, lockedBy: job.lockedBy, status: "running" },
      data: {
        status: job.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        availableAt: new Date(now.getTime() + 1000 * 2 ** job.attempts),
        finishedAt: job.attempts >= MAX_ATTEMPTS ? now : null,
        lockedBy: null,
        leaseUntil: null,
        lastError: "Falha ao executar a tarefa. Verifique o tipo e a disponibilidade do banco.",
      },
    });
  } finally {
    clearInterval(renewal);
  }
  return true;
}
