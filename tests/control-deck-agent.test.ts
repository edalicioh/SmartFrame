import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSanitizedChildEnv,
  createWindowsDriver,
} from "../apps/control-deck-agent/src/drivers/windows";
import { createLinuxDriver } from "../apps/control-deck-agent/src/drivers/linux";
import { createUnsupportedDriver } from "../apps/control-deck-agent/src/drivers/unsupported";
import type { HostDriver } from "../apps/control-deck-agent/src/drivers/types";
import { MicPttLeaseManager } from "../apps/control-deck-agent/src/lease-manager";
import { createControlDeckAgentServer } from "../apps/control-deck-agent/src/server";
import { isWindowsCommandScript } from "../apps/control-deck-agent/src/shortcuts";

function mockDriver(): HostDriver & { calls: string[]; micMuted: boolean } {
  const driver: HostDriver & { calls: string[]; micMuted: boolean } = {
    platform: "win32",
    calls: [],
    micMuted: true,
    async getStatus() {
      return {
        available: true,
        platform: "win32",
        capabilities: {
          shortcuts: true,
          media: true,
          volume: true,
          appVolume: true,
          brightness: true,
          mic: true,
        },
        volume: { available: true, level: 45, muted: false },
        brightness: { available: true, level: 80 },
        mic: { available: true, muted: driver.micMuted },
        media: { available: true, playbackState: "playing" },
      };
    },
    async triggerMedia(action) {
      driver.calls.push(`media:${action}`);
      return { available: true, playbackState: "paused", message: "OK" };
    },
    async controlVolume(params) {
      driver.calls.push(`volume:${params.mode}:${params.level ?? ""}`);
      return { available: true, level: params.level ?? 50, muted: Boolean(params.muted), message: "OK" };
    },
    async controlAppVolume(params) {
      driver.calls.push(`app_volume:${params.appName}:${params.mode}`);
      return { available: true, level: params.level ?? 60, muted: false, message: "OK" };
    },
    async controlBrightness(params) {
      driver.calls.push(`brightness:${params.mode}:${params.level ?? ""}`);
      return { available: true, level: params.level ?? 70, message: "OK" };
    },
    async controlMic(params) {
      driver.calls.push(`mic:${params.mode}:${String(params.muted)}`);
      if (params.mode === "set_mute") driver.micMuted = Boolean(params.muted);
      else driver.micMuted = !driver.micMuted;
      return { available: true, muted: driver.micMuted, message: "OK" };
    },
    async launchShortcut(shortcut) {
      driver.calls.push(`shortcut:${shortcut.command}`);
      return { available: true, message: "OK" };
    },
  };
  return driver;
}

const VALID_TOKEN = "a".repeat(32);
let openAgent: ReturnType<typeof createControlDeckAgentServer> | null = null;

afterEach(async () => {
  vi.useRealTimers();
  if (openAgent) {
    await openAgent.close();
    openAgent = null;
  }
});

describe("Control Deck Local Agent", () => {
  it("não considera scripts .cmd/.bat executáveis por spawn shell:false", () => {
    expect(isWindowsCommandScript("setup.cmd")).toBe(true);
    expect(isWindowsCommandScript("C:\\tools\\launch.BAT")).toBe(true);
    expect(isWindowsCommandScript("C:\\tools\\launch.exe")).toBe(false);
  });

  it("rejeita bind não-loopback e exige token Bearer de >= 32 caracteres", async () => {
    const driver = mockDriver();
    expect(() =>
      createControlDeckAgentServer({ host: "0.0.0.0", token: VALID_TOKEN, driver }),
    ).toThrow(/Somente loopback/);
    expect(() =>
      createControlDeckAgentServer({ host: "127.0.0.1", token: "curto", driver }),
    ).toThrow(/mínimo de 32/);

    openAgent = createControlDeckAgentServer({
      host: "127.0.0.1",
      port: 0,
      token: VALID_TOKEN,
      driver,
      shortcuts: {
        ide: {
          label: "Abrir Editor",
          command: "C:\\Secret\\Path\\editor.exe",
          args: ["--secret-flag"],
          cwd: "C:\\Secret",
        },
      },
      existsCheck: async () => true,
    });
    const bound = await openAgent.listen();
    const base = `http://${bound.host}:${bound.port}`;

    expect((await fetch(`${base}/health`)).status).toBe(401);
    expect(
      (await fetch(`${base}/status`, { headers: { authorization: "Bearer errado" } })).status,
    ).toBe(401);

    const statusRes = await fetch(`${base}/status`, {
      headers: { authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(statusRes.status).toBe(200);
    expect(statusRes.headers.get("cache-control")).toBe("no-store");
    const statusBody = await statusRes.json();
    expect(statusBody.shortcuts).toEqual([
      { shortcutId: "ide", label: "Abrir Editor", available: true },
    ]);
    // Caminhos físicos, args e cwd nunca são expostos pela API.
    const serialized = JSON.stringify(statusBody);
    expect(serialized).not.toContain("Secret");
    expect(serialized).not.toContain("--secret-flag");
  });

  it("deduplica executionId em comandos não idempotentes e gerencia lease PTT no servidor", async () => {
    const driver = mockDriver();
    openAgent = createControlDeckAgentServer({
      host: "127.0.0.1",
      port: 0,
      token: VALID_TOKEN,
      driver,
      shortcuts: {
        ide: { label: "Editor", command: "/usr/bin/editor", args: [] },
      },
      existsCheck: async () => true,
    });
    const bound = await openAgent.listen();
    const base = `http://${bound.host}:${bound.port}`;
    const headers = {
      authorization: `Bearer ${VALID_TOKEN}`,
      "content-type": "application/json",
    };

    const execPayload = {
      deviceId: "dev-1",
      executionId: "exec-nonidemp-1",
      bindingId: "bind-media-1",
      kind: "media",
      action: "play_pause",
      target: {},
      idempotent: false,
      command: "trigger",
    };

    const first = await (
      await fetch(`${base}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify(execPayload),
      })
    ).json();
    const second = await (
      await fetch(`${base}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify(execPayload),
      })
    ).json();
    expect(first.status).toBe("ok");
    expect(second).toEqual(first);
    expect(driver.calls).toEqual(["media:play_pause"]);

    driver.controlAppVolume = async () => ({
      available: false,
      level: null,
      muted: null,
      message: "Sessão de áudio não encontrada para InternalAppName.",
    });
    const appVolume = await (
      await fetch(`${base}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          deviceId: "dev-1",
          executionId: "exec-app-volume-error",
          bindingId: "bind-app-1",
          kind: "app_volume",
          action: "set_level",
          target: { appName: "InternalAppName" },
          idempotent: true,
          command: "set_level",
          value: 30,
        }),
      })
    ).json();
    expect(appVolume.message).toBe("Sessão de áudio indisponível.");
    expect(JSON.stringify(appVolume)).not.toContain("InternalAppName");

    // Adquirir lease PTT desmuta; fechar o agente re-muta automaticamente.
    const ptt = await (
      await fetch(`${base}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          deviceId: "dev-1",
          executionId: "exec-ptt-acq-1",
          leaseRequestId: "exec-ptt-acq-1",
          bindingId: "bind-mic-1",
          kind: "mic_ptt",
          action: "hold_unmute",
          target: { leaseSeconds: 5 },
          idempotent: true,
          command: "ptt_acquire",
          leaseSeconds: 5,
        }),
      })
    ).json();
    expect(ptt.status).toBe("ok");
    expect(ptt.lease.leaseId).toBeTypeOf("string");
    expect(driver.micMuted).toBe(false);

    await openAgent.close();
    openAgent = null;
    expect(driver.micMuted).toBe(true);
  });

  it("expira lease PTT automaticamente e re-muta o microfone", async () => {
    vi.useFakeTimers();
    let muted = true;
    let muteAttempts = 0;
    const manager = new MicPttLeaseManager(async (nextMuted) => {
      if (nextMuted && ++muteAttempts === 1) {
        return { available: false, muted: null };
      }
      muted = nextMuted;
      return { available: true, muted };
    });

    const acq = await manager.acquire("b-mic", 3);
    expect(acq.ok).toBe(true);
    expect(muted).toBe(false);
    expect(manager.snapshot().pttActive).toBe(true);

    // Renovar estende o prazo sem silenciar.
    await vi.advanceTimersByTimeAsync(2000);
    expect(muted).toBe(false);
    const ren = await manager.renew(acq.lease!.leaseId, 4);
    expect(ren.ok).toBe(true);

    // Avançar além do novo prazo de 4s dispara auto-mute de segurança.
    await vi.advanceTimersByTimeAsync(4600);
    expect(muted).toBe(true);
    expect(muteAttempts).toBe(2);
    expect(manager.snapshot().pttActive).toBe(false);
    const afterExpiration = await manager.acquire("b-mic", 3);
    expect(afterExpiration.ok).toBe(true);
    await manager.release("b-mic", afterExpiration.lease!.leaseId);
  });

  it("recupera unmute sem readback e repete mute até confirmação no release e shutdown", async () => {
    const calls: boolean[] = [];
    const manager = new MicPttLeaseManager(async (nextMuted) => {
      calls.push(nextMuted);
      if (!nextMuted) return { available: true, muted: null };
      if (calls.filter((value) => value).length === 1) {
        return { available: false, muted: null, message: "Readback indisponível" };
      }
      return { available: true, muted: true };
    });

    const failedAcquire = await manager.acquire("binding-a", 5, "acquire-request-a");
    expect(failedAcquire.ok).toBe(false);
    expect(calls).toEqual([false, true, true]);
    expect(manager.snapshot().pttActive).toBe(false);

    const acquireManager = new MicPttLeaseManager(async (nextMuted) => ({
      available: true,
      muted: nextMuted,
    }));
    const acquired = await acquireManager.acquire("binding-a", 5, "acquire-request-b");
    expect(acquired.ok).toBe(true);
    const wrongBindingRelease = await acquireManager.release("binding-b");
    expect(wrongBindingRelease.ok).toBe(false);
    expect(acquireManager.snapshot().leaseId).toBe(acquired.lease?.leaseId);
    await acquireManager.shutdown();
  });

  it("release sem leaseId só afeta o binding correlacionado e retry de mute também no shutdown", async () => {
    const releaseCalls: boolean[] = [];
    const manager = new MicPttLeaseManager(async (nextMuted) => {
      releaseCalls.push(nextMuted);
      if (nextMuted && releaseCalls.filter(Boolean).length === 1) {
        return { available: false, muted: null };
      }
      return { available: true, muted: nextMuted };
    });
    const acquired = await manager.acquire("binding-a", 5, "acquire-request-a");

    const unrelatedRelease = await manager.release("binding-b");
    expect(unrelatedRelease.ok).toBe(false);
    expect(manager.snapshot().leaseId).toBe(acquired.lease?.leaseId);

    const earlyStyleRelease = await manager.release("binding-a", undefined, "acquire-request-a");
    expect(earlyStyleRelease).toMatchObject({ ok: true, muted: true });
    expect(releaseCalls).toEqual([false, true, true]);
    expect(manager.snapshot().pttActive).toBe(false);

    let shutdownMuteAttempts = 0;
    const shutdownManager = new MicPttLeaseManager(async (nextMuted) => {
      if (nextMuted && ++shutdownMuteAttempts === 1) {
        return { available: false, muted: null };
      }
      return { available: true, muted: nextMuted };
    });
    await shutdownManager.acquire("binding-a", 5);
    await shutdownManager.shutdown();
    expect(shutdownMuteAttempts).toBe(2);
  });

  it("rejects overlapping acquisition and releases only the active request", async () => {
    let muted = true;
    const manager = new MicPttLeaseManager(async (nextMuted) => {
      muted = nextMuted;
      return { available: true, muted };
    });
    await manager.acquire("shared-binding", 5, "request-tablet-one");
    const newer = await manager.acquire("shared-binding", 5, "request-tablet-two");
    expect(newer.ok).toBe(false);

    const staleRelease = await manager.release(
      "shared-binding",
      undefined,
      "request-tablet-one",
    );
    expect(staleRelease.ok).toBe(true);
    expect(manager.snapshot().leaseId).toBeNull();
    expect(muted).toBe(true);
    await manager.shutdown();
  });

  it("rejects overlapping host-global microphone leases without transferring the open endpoint", async () => {
    const calls: boolean[] = [];
    const manager = new MicPttLeaseManager(async (muted) => {
      calls.push(muted);
      return { available: true, muted };
    });
    const first = await manager.acquire("binding-one", 5, "overlap-one");
    const second = await manager.acquire("binding-two", 5, "overlap-two");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(manager.snapshot().leaseId).toBe(first.lease?.leaseId);
    expect(calls).toEqual([false]);
    await manager.release("binding-one", first.lease!.leaseId);
    expect(calls).toEqual([false, true]);
    await manager.shutdown();
  });

  it("cancela uma aquisição atrasada e não abre o microfone depois de release antecipado", async () => {
    let finishUnmute!: (value: { available: boolean; muted: boolean }) => void;
    const calls: boolean[] = [];
    const manager = new MicPttLeaseManager((nextMuted) => {
      calls.push(nextMuted);
      if (!nextMuted) return new Promise((resolve) => { finishUnmute = resolve; });
      return Promise.resolve({ available: true, muted: true });
    });
    const acquiring = manager.acquire("binding-a", 5, "delayed-request");
    await Promise.resolve();
    const releasing = manager.release("binding-a", undefined, "delayed-request");
    finishUnmute({ available: true, muted: false });
    const [acquired, released] = await Promise.all([acquiring, releasing]);
    expect(acquired.ok).toBe(false);
    expect(released.ok).toBe(true);
    expect(manager.snapshot().pttActive).toBe(false);
    expect(calls).toEqual([false, true]);
    await manager.shutdown();
  });

  it("expira registros de cancelamento para não acumular IDs indefinidamente", async () => {
    let now = 10_000;
    const manager = new MicPttLeaseManager(
      async (muted) => ({ available: true, muted }),
      () => now,
    );
    await manager.release("binding-a", undefined, "cancel-id");
    now += 60_001;
    const acquired = await manager.acquire("binding-a", 5, "cancel-id");
    expect(acquired.ok).toBe(true);
    await manager.release("binding-a", acquired.lease!.leaseId);
    await manager.shutdown();
  });

  it("shutdown sem lease não tenta mute recovery", async () => {
    const calls: boolean[] = [];
    const manager = new MicPttLeaseManager(async (muted) => {
      calls.push(muted);
      return { available: true, muted };
    });
    await manager.shutdown();
    expect(calls).toEqual([]);
  });

  it("mantém o input original do lease PTT para silenciar mesmo após trocar o default", async () => {
    const linuxCalls: Array<{ args: readonly string[] }> = [];
    let defaultSource = "source-a";
    const linux = createLinuxDriver(async (_file, args) => {
      linuxCalls.push({ args });
      if (args[0] === "get-default-source") {
        const source = defaultSource;
        defaultSource = "source-b";
        return { stdout: source, stderr: "" };
      }
      return { stdout: "Mute: no", stderr: "" };
    });
    await linux.controlMic({ mode: "set_mute", muted: false });
    await linux.controlMic({ mode: "set_mute", muted: true });
    expect(
      linuxCalls.filter(({ args }) => args[0] === "set-source-mute").map(({ args }) => args[1]),
    ).toEqual(["source-a", "source-a"]);

    const windowsCalls: Array<{ env?: NodeJS.ProcessEnv }> = [];
    let windowsUnmuteThrows = false;
    const windows = createWindowsDriver(async (_file, args, options) => {
      windowsCalls.push({ env: options?.env });
      if (args[3]?.includes("EndpointId(1)")) {
        return { stdout: JSON.stringify({ available: true, endpointId: "endpoint-a" }), stderr: "" };
      }
      if (windowsUnmuteThrows && options?.env?.SF_MUTED === "0") {
        throw new Error("powershell aborted after unmute");
      }
      return {
        stdout: JSON.stringify({
          available: true,
          muted: options?.env?.SF_MUTED === "1",
          endpointId: options?.env?.SF_ENDPOINT_ID ?? "",
        }),
        stderr: "",
      };
    });
    await windows.controlMic({ mode: "set_mute", muted: false });
    await windows.controlMic({ mode: "set_mute", muted: true });
    expect(windowsCalls.map(({ env }) => env?.SF_ENDPOINT_ID)).toEqual([
      undefined,
      "endpoint-a",
      "endpoint-a",
    ]);

    windowsCalls.length = 0;
    windowsUnmuteThrows = true;
    const failedAcquire = await windows.controlMic({ mode: "set_mute", muted: false });
    expect(failedAcquire.available).toBe(false);
    expect(failedAcquire.uncertain).toBe(true);
    windowsUnmuteThrows = false;
    await windows.controlMic({ mode: "set_mute", muted: true });
    expect(windowsCalls.map(({ env }) => env?.SF_ENDPOINT_ID)).toEqual([
      undefined,
      "endpoint-a",
      "endpoint-a",
    ]);
    const statusScripts: string[] = [];
    const comDriver = createWindowsDriver(async (_file, args) => {
      statusScripts.push(args[3] ?? "");
      return { stdout: JSON.stringify({ volAvail: false, micAvail: false, briAvail: false }), stderr: "" };
    });
    await comDriver.getStatus();
    expect(statusScripts[0]).toMatch(/Activate[\s\S]*OpenPropertyStore[\s\S]*GetId/);
  });

  it("drivers Windows, Linux e Unsupported respeitam args sem shell e reportam indisponibilidade real", async () => {
    const winCalls: Array<{ file: string; args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
    const winDriver = createWindowsDriver(
      async (file, args, options) => {
        winCalls.push({ file, args, env: options?.env });
        if (args[3]?.includes("WmiMonitorBrightness")) {
          return { stdout: JSON.stringify({ available: false, level: null }), stderr: "" };
        }
        return { stdout: JSON.stringify({ available: true, level: 75, muted: false }), stderr: "" };
      },
      async () => {},
      async () => true,
    );
    const winVol = await winDriver.controlVolume({ mode: "set_level", level: 75 });
    expect(winVol).toMatchObject({ available: true, level: 75, muted: false });
    expect(winCalls[0].file).toBe("powershell.exe");
    expect(winCalls[0].env?.SF_LEVEL).toBe("75");
    const launchedCommands: string[] = [];
    const winShortcuts = createWindowsDriver(
      async () => ({ stdout: "{}", stderr: "" }),
      async (command) => { launchedCommands.push(command); },
      async () => true,
    );
    expect(await winShortcuts.launchShortcut({ command: "script.cmd", args: [] }))
      .toMatchObject({ available: false });
    expect(launchedCommands).toEqual([]);

    const winBri = await winDriver.controlBrightness({ mode: "step_up", step: 10 });
    expect(winBri).toEqual({
      available: false,
      level: null,
      message: "Controle de brilho WMI indisponível neste monitor.",
    });

    const linuxCalls: Array<{ file: string; args: readonly string[] }> = [];
    const linuxDriver = createLinuxDriver(
      async (file, args) => {
        linuxCalls.push({ file, args });
        if (file === "brightnessctl") throw new Error("not installed");
        if (file === "pactl" && args[0] === "get-sink-volume") {
          return { stdout: "Volume: front-left: 39321 / 60% / -13.31 dB", stderr: "" };
        }
        if (file === "pactl" && args[0] === "get-sink-mute") {
          return { stdout: "Mute: no", stderr: "" };
        }
        if (file === "pactl" && args[0] === "get-source-mute") {
          return { stdout: "Mute: yes", stderr: "" };
        }
        if (file === "playerctl") {
          return { stdout: "Playing\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
      async () => {},
      async () => false,
    );
    const lStatus = await linuxDriver.getStatus();
    expect(lStatus.volume).toEqual({ available: true, level: 60, muted: false });
    expect(lStatus.mic).toEqual({ available: true, muted: true });
    expect(lStatus.brightness).toEqual({ available: false, level: null });
    expect(lStatus.media).toEqual({ available: true, playbackState: "playing" });
    expect(await linuxDriver.launchShortcut({ command: "/missing", args: [] })).toMatchObject({
      available: false,
    });
    expect(linuxCalls.some((c) => c.file === "pactl")).toBe(true);

    const launchCalls: Array<{ command: string; args: readonly string[] }> = [];
    const shortcutOnlyLinux = createLinuxDriver(
      async () => {
        throw new Error("host control unavailable");
      },
      async (command, args) => {
        launchCalls.push({ command, args });
      },
      async () => true,
    );
    const shortcutOnlyStatus = await shortcutOnlyLinux.getStatus();
    expect(shortcutOnlyStatus).toMatchObject({
      available: true,
      capabilities: {
        shortcuts: true,
        media: false,
        volume: false,
        appVolume: false,
        brightness: false,
        mic: false,
      },
    });
    expect(
      await shortcutOnlyLinux.launchShortcut({
        command: "/usr/bin/allowlisted-tool",
        args: ["--safe-arg"],
      }),
    ).toMatchObject({ available: true });
    expect(launchCalls).toEqual([
      { command: "/usr/bin/allowlisted-tool", args: ["--safe-arg"] },
    ]);

    const unsupported = createUnsupportedDriver();
    expect(await unsupported.getStatus()).toMatchObject({
      available: false,
      volume: { available: false, level: null, muted: null },
      brightness: { available: false, level: null },
    });
  });

  it("evita corrida em executionId concorrente, serializa corrida PTT e sanitiza SMARTFRAME_* e segredos .env", async () => {
    const prevToken = process.env.SMARTFRAME_CONTROL_DECK_TOKEN;
    const prevAuthSecret = process.env.BETTER_AUTH_SECRET;
    const prevDbUrl = process.env.DATABASE_URL;
    process.env.SMARTFRAME_CONTROL_DECK_TOKEN = VALID_TOKEN;
    process.env.BETTER_AUTH_SECRET = "super-secret-auth-value";
    process.env.DATABASE_URL = "file:./secret.db";
    try {
      const sanitized = buildSanitizedChildEnv();
      expect(sanitized.SMARTFRAME_CONTROL_DECK_TOKEN).toBeUndefined();
      expect(sanitized.BETTER_AUTH_SECRET).toBeUndefined();
      expect(sanitized.DATABASE_URL).toBeUndefined();
      const withScriptEnv = buildSanitizedChildEnv({ SF_LEVEL: "55" });
      expect(withScriptEnv.SMARTFRAME_CONTROL_DECK_TOKEN).toBeUndefined();
      expect(withScriptEnv.BETTER_AUTH_SECRET).toBeUndefined();
      expect(withScriptEnv.SF_LEVEL).toBe("55");
    } finally {
      if (prevToken === undefined) delete process.env.SMARTFRAME_CONTROL_DECK_TOKEN;
      else process.env.SMARTFRAME_CONTROL_DECK_TOKEN = prevToken;
      if (prevAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = prevAuthSecret;
      if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDbUrl;
    }

    const baseDriver = mockDriver();
    expect(() =>
      createControlDeckAgentServer({
        host: "127.0.0.1",
        token: `${"a".repeat(20)} ${"b".repeat(12)}`,
        driver: baseDriver,
      }),
    ).toThrow(/espaços/);

    let releaseFirstExec!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirstExec = resolve;
    });
    const concurrentDriver: HostDriver & { calls: string[] } = {
      ...baseDriver,
      calls: [],
      async triggerMedia(action) {
        concurrentDriver.calls.push(`media:${action}`);
        await gate;
        return { available: true, playbackState: "paused", message: "OK" };
      },
    };
    openAgent = createControlDeckAgentServer({
      host: "127.0.0.1",
      port: 0,
      token: VALID_TOKEN,
      driver: concurrentDriver,
    });
    const bound = await openAgent.listen();
    const base = `http://${bound.host}:${bound.port}`;
    const headers = {
      authorization: `Bearer ${VALID_TOKEN}`,
      "content-type": "application/json",
    };
    const body = {
      deviceId: "dev-1",
      executionId: "exec-concurrent-1",
      bindingId: "bind-m",
      kind: "media",
      action: "play_pause",
      target: {},
      idempotent: false,
      command: "trigger",
    };
    const p1 = fetch(`${base}/execute`, { method: "POST", headers, body: JSON.stringify(body) });
    const p2 = fetch(`${base}/execute`, { method: "POST", headers, body: JSON.stringify(body) });
    const pConflict = fetch(`${base}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, bindingId: "other-binding" }),
    });
    const pOtherDevice = fetch(`${base}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, deviceId: "dev-2" }),
    });
    releaseFirstExec();
    const [r1, r2, rConflict, rOtherDevice] = await Promise.all([p1, p2, pConflict, pOtherDevice]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(rConflict.status).toBe(409);
    expect(rOtherDevice.status).toBe(200);
    expect(concurrentDriver.calls).toEqual(["media:play_pause", "media:play_pause"]);

    const invalidExec = await fetch(`${base}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        deviceId: "dev-1",
        executionId: "exec-invalid-cmd",
        bindingId: "b-vol",
        kind: "volume",
        action: "set_level",
        target: { step: 5 },
        idempotent: true,
        command: "set_level",
      }),
    });
    expect(invalidExec.status).toBe(400);

    // Isolamento de lease PTT por deviceId e bloqueio de set_mute manual durante lease ativo.
    const acqA = await (
      await fetch(`${base}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          deviceId: "dev-a",
          executionId: "exec-ptt-dev-a",
          leaseRequestId: "exec-ptt-dev-a",
          bindingId: "b-ptt",
          kind: "mic_ptt",
          action: "hold_unmute",
          target: { leaseSeconds: 8 },
          idempotent: true,
          command: "ptt_acquire",
          leaseSeconds: 8,
        }),
      })
    ).json();
    expect(acqA.status).toBe("ok");

    const stealRenewB = await (
      await fetch(`${base}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          deviceId: "dev-b",
          executionId: "exec-ptt-steal-b",
          bindingId: "b-ptt",
          kind: "mic_ptt",
          action: "hold_unmute",
          target: { leaseSeconds: 8 },
          idempotent: true,
          command: "ptt_renew",
          leaseId: acqA.lease.leaseId,
        }),
      })
    ).json();
    expect(stealRenewB.status).toBe("rejected");

    const manualDuringPtt = await (
      await fetch(`${base}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          deviceId: "dev-a",
          executionId: "exec-manual-mute-1",
          bindingId: "b-mute",
          kind: "mic_ptt",
          action: "set_mute",
          target: { leaseSeconds: 8 },
          idempotent: true,
          command: "set_mute",
          muted: false,
        }),
      })
    ).json();
    expect(manualDuringPtt.status).toBe("rejected");

    const relA = await (
      await fetch(`${base}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          deviceId: "dev-a",
          executionId: "exec-ptt-rel-a",
          bindingId: "b-ptt",
          kind: "mic_ptt",
          action: "hold_unmute",
          target: { leaseSeconds: 8 },
          idempotent: true,
          command: "ptt_release",
          leaseId: acqA.lease.leaseId,
        }),
      })
    ).json();
    expect(relA.status).toBe("ok");

    // Corrida em MicPttLeaseManager: release/shutdown antes do fim de acquire termina mutado.
    let mutedState = true;
    let releaseMic!: () => void;
    const micGate = new Promise<void>((resolve) => {
      releaseMic = resolve;
    });
    const racingManager = new MicPttLeaseManager(async (nextMuted) => {
      if (!nextMuted) await micGate;
      mutedState = nextMuted;
      return { available: true, muted: nextMuted };
    });
    const acqP = racingManager.acquire("b-mic", 5, "race-acquire");
    const relP = racingManager.release("b-mic", undefined, "race-acquire");
    releaseMic();
    await acqP;
    const relRes = await relP;
    expect(relRes.ok).toBe(true);
    expect(mutedState).toBe(true);
    expect(racingManager.snapshot().pttActive).toBe(false);

    let mutedAfterShutdown = true;
    let releaseMic2!: () => void;
    const micGate2 = new Promise<void>((resolve) => {
      releaseMic2 = resolve;
    });
    const closingManager = new MicPttLeaseManager(async (nextMuted) => {
      if (!nextMuted) await micGate2;
      mutedAfterShutdown = nextMuted;
      return { available: true, muted: nextMuted };
    });
    const acq2 = closingManager.acquire("b-mic", 5);
    const shutP = closingManager.shutdown();
    releaseMic2();
    const acq2Res = await acq2;
    await shutP;
    expect(acq2Res.ok).toBe(false);
    expect(mutedAfterShutdown).toBe(true);
    expect(closingManager.snapshot().pttActive).toBe(false);
  });

  it("retorna HTTP 504 unknown e deduplica quando confirmação pós-execução falha em ação não idempotente no Linux", async () => {
    let volumeSetCalls = 0;
    const flakyLinux = createLinuxDriver(async (file, args) => {
      if (file === "pactl" && args[0] === "set-sink-volume") {
        volumeSetCalls += 1;
        return { stdout: "", stderr: "" };
      }
      if (file === "pactl" && args[0] === "get-sink-volume") {
        throw new Error("readback timed out");
      }
      return { stdout: "", stderr: "" };
    });

    openAgent = createControlDeckAgentServer({
      host: "127.0.0.1",
      port: 0,
      token: VALID_TOKEN,
      driver: flakyLinux,
    });
    const bound = await openAgent.listen();
    const base = `http://${bound.host}:${bound.port}`;
    const headers = {
      authorization: `Bearer ${VALID_TOKEN}`,
      "content-type": "application/json",
    };
    const payload = {
      deviceId: "dev-linux",
      executionId: "exec-uncertain-1",
      bindingId: "b-vol-up",
      kind: "volume",
      action: "step_up",
      target: { step: 5 },
      idempotent: false,
      command: "trigger",
    };

    const res1 = await fetch(`${base}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(504);
    const json1 = await res1.json();
    expect(json1).toMatchObject({ status: "unknown", idempotent: false });

    const res2 = await fetch(`${base}/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    expect(res2.status).toBe(504);
    expect(await res2.json()).toEqual(json1);
    expect(volumeSetCalls).toBe(1);
  });
});
