import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@smartframe/database";
import { claimJob, runOneJob, scheduleMaintenance } from "@smartframe/jobs";

const database = createDatabase(process.env.DATABASE_URL!);
afterAll(async () => {
  await database.$disconnect();
});

describe("Fila persistida", () => {
  it("agenda manutenção uma única vez por hora", async () => {
    await database.job.deleteMany();
    const now = new Date("2026-10-30T10:15:00Z");
    await scheduleMaintenance(database, now);
    await scheduleMaintenance(database, now);
    expect(await database.job.count()).toBe(1);
  });
  it("executa manutenção e registra a conclusão", async () => {
    const userId = randomUUID();
    await database.user.create({
      data: { id: userId, name: "Teste de limpeza", email: `${userId}@smartframe.test` },
    });
    try {
      await database.session.createMany({
        data: [
          {
            id: randomUUID(),
            token: randomUUID(),
            userId,
            expiresAt: new Date("2026-10-30T09:00:00Z"),
          },
          {
            id: randomUUID(),
            token: randomUUID(),
            userId,
            expiresAt: new Date("2026-10-31T09:00:00Z"),
          },
        ],
      });
      expect(await runOneJob(database, new Date("2026-10-30T10:16:00Z"))).toBe(true);
      expect((await database.job.findFirstOrThrow()).status).toBe("completed");
      expect(await database.session.count({ where: { userId } })).toBe(1);
      expect(await runOneJob(database, new Date("2026-10-30T10:17:00Z"))).toBe(false);
    } finally {
      await database.user.delete({ where: { id: userId } });
    }
  });
  it("não entrega a mesma tarefa a dois consumidores com lease válida", async () => {
    const now = new Date("2026-10-30T11:00:00Z");
    await scheduleMaintenance(database, now);
    const first = await claimJob(database, now);
    expect(first).not.toBeNull();
    expect(await claimJob(database, now)).toBeNull();
  });
  it("recupera trabalho após expiração da lease", async () => {
    const recovered = await claimJob(database, new Date("2026-10-30T11:02:00Z"));
    expect(recovered?.attempts).toBe(2);
    await database.job.update({ where: { id: recovered!.id }, data: { status: "completed" } });
  });
  it("faz retentativas limitadas para tarefas desconhecidas", async () => {
    const id = randomUUID();
    const now = new Date("2026-10-30T12:00:00Z");
    await database.job.create({ data: { id, type: "unsupported", availableAt: now } });
    await runOneJob(database, now);
    await runOneJob(database, new Date(now.getTime() + 10_000));
    await runOneJob(database, new Date(now.getTime() + 30_000));
    const job = await database.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(3);
  });
  it("encerra tarefas abandonadas que já esgotaram suas tentativas", async () => {
    const now = new Date("2026-10-30T13:00:00Z");
    const id = randomUUID();
    await database.job.create({
      data: {
        id,
        type: "maintenance.sessions",
        status: "running",
        attempts: 3,
        leaseUntil: new Date(now.getTime() - 1000),
      },
    });
    await claimJob(database, now);
    expect((await database.job.findUniqueOrThrow({ where: { id } })).status).toBe("failed");
  });
});
