import { randomUUID } from "node:crypto";

export type MicSetMuteResult = {
  available: boolean;
  muted: boolean | null;
  message?: string;
};

export type MicLeaseInfo = {
  leaseId: string;
  expiresAt: string;
  leaseSeconds: number;
};

export type MicLeaseSnapshot = {
  pttActive: boolean;
  leaseId: string | null;
  leaseExpiresAt: string | null;
};

type ActiveLease = {
  leaseId: string;
  deviceId: string;
  bindingId: string;
  leaseRequestId: string;
  leaseSeconds: number;
  expiresAtMs: number;
  timer: ReturnType<typeof setTimeout>;
};

function clampLeaseSeconds(seconds: number | undefined): number {
  if (!Number.isInteger(seconds)) return 10;
  return Math.max(2, Math.min(30, seconds!));
}

export class MicPttLeaseManager {
  private active: ActiveLease | null = null;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private muteRecovery: Promise<void> | null = null;
  private readonly cancelledRequests = new Map<string, number>();
  private readonly cancelledRequestTtlMs = 60_000;
  private microphoneMayBeOpen = false;
  private readonly setMicMuted: (muted: boolean) => Promise<MicSetMuteResult>;
  private readonly now: () => number;

  constructor(
    setMicMuted: (muted: boolean) => Promise<MicSetMuteResult>,
    now: () => number = () => Date.now(),
  ) {
    this.setMicMuted = setMicMuted;
    this.now = now;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private clearActiveTimer() {
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active = null;
    }
  }

  private cancelKey(deviceId: string, requestId: string): string {
    return `${deviceId}:${requestId}`;
  }

  private pruneCancelledRequests(now = this.now()): void {
    for (const [id, expiresAt] of this.cancelledRequests) {
      if (expiresAt <= now) this.cancelledRequests.delete(id);
    }
  }

  private isRequestCancelled(deviceId: string, requestId: string): boolean {
    this.pruneCancelledRequests();
    return this.cancelledRequests.has(this.cancelKey(deviceId, requestId));
  }

  private cancelRequest(deviceId: string, requestId: string): void {
    const now = this.now();
    this.pruneCancelledRequests(now);
    this.cancelledRequests.set(this.cancelKey(deviceId, requestId), now + this.cancelledRequestTtlMs);
  }

  private scheduleExpiration(leaseId: string, leaseSeconds: number) {
    const timer = setTimeout(() => {
      void this.enqueue(async () => {
        if (this.active?.leaseId !== leaseId) return false;
        this.active = null;
        return true;
      }).then((expired) => (expired ? this.recoverMute() : undefined));
    }, leaseSeconds * 1000);
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  }

  /**
   * Keep retrying until the host confirms that the microphone is muted.
   * The retry operation itself is serialized with acquire/release operations.
   */
  private recoverMute(): Promise<void> {
    if (this.muteRecovery) return this.muteRecovery;
    this.muteRecovery = (async () => {
      for (;;) {
        let confirmed = false;
        try {
          const result = await this.enqueue(() => this.setMicMuted(true));
          confirmed = result.available && result.muted === true;
        } catch {
          // A failed command/readback is not confirmation; keep recovering.
        }
        if (confirmed) {
          this.microphoneMayBeOpen = false;
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    })().finally(() => {
      this.muteRecovery = null;
    });
    return this.muteRecovery;
  }

  async acquire(
    bindingId: string,
    requestedSeconds?: number,
    leaseRequestId: string = randomUUID(),
    deviceId: string = "default-device",
  ): Promise<{
    ok: boolean;
    available: boolean;
    muted: boolean | null;
    lease: MicLeaseInfo | null;
    message: string;
  }> {
    if (this.isRequestCancelled(deviceId, leaseRequestId)) {
      this.cancelledRequests.delete(this.cancelKey(deviceId, leaseRequestId));
      return {
        ok: false,
        available: true,
        muted: true,
        lease: null,
        message: "Aquisição Push-to-Talk cancelada.",
      };
    }
    const outcome = await this.enqueue(async () => {
      if (this.isRequestCancelled(deviceId, leaseRequestId)) {
        this.cancelledRequests.delete(this.cancelKey(deviceId, leaseRequestId));
        return {
          response: {
            ok: false,
            available: true,
            muted: true,
            lease: null,
            message: "Aquisição Push-to-Talk cancelada.",
          },
          recover: false,
        };
      }
      if (this.closed) {
        return {
          response: {
            ok: false,
            available: false,
            muted: true,
            lease: null,
            message: "Agente em encerramento.",
          },
          recover: true,
        };
      }
      // A mic lease is host-global: never silently transfer an open endpoint.
      if (this.active || this.microphoneMayBeOpen) {
        return {
          response: {
            ok: false,
            available: true,
            muted: this.microphoneMayBeOpen ? false : null,
            lease: null,
            message: "Já existe uma lease ou recuperação ativa do microfone.",
          },
          recover: false,
        };
      }
      const leaseSeconds = clampLeaseSeconds(requestedSeconds);
      let result: MicSetMuteResult;
      this.microphoneMayBeOpen = true;
      try {
        result = await this.setMicMuted(false);
      } catch (error) {
        this.clearActiveTimer();
        return {
          response: {
            ok: false,
            available: false,
            muted: null,
            lease: null,
            message: error instanceof Error ? error.message : "Falha ao desmutar o microfone.",
          },
          recover: true,
        };
      }
      if (this.closed) {
        this.clearActiveTimer();
        return {
          response: {
            ok: false,
            available: false,
            muted: true,
            lease: null,
            message: "Agente em encerramento.",
          },
          recover: true,
        };
      }
      if (this.isRequestCancelled(deviceId, leaseRequestId)) {
        this.cancelledRequests.delete(this.cancelKey(deviceId, leaseRequestId));
        this.clearActiveTimer();
        return {
          response: {
            ok: false,
            available: true,
            muted: true,
            lease: null,
            message: "Aquisição Push-to-Talk cancelada.",
          },
          recover: true,
        };
      }
      if (!result.available || result.muted !== false) {
        this.clearActiveTimer();
        return {
          response: {
            ok: false,
            available: false,
            muted: result.muted,
            lease: null,
            message: result.message ?? "Não foi possível confirmar o estado do microfone.",
          },
          recover: true,
        };
      }

      this.clearActiveTimer();
      const leaseId = randomUUID();
      const expiresAtMs = this.now() + leaseSeconds * 1000;
      const timer = this.scheduleExpiration(leaseId, leaseSeconds);
      this.active = {
        leaseId,
        deviceId,
        bindingId,
        leaseRequestId,
        leaseSeconds,
        expiresAtMs,
        timer,
      };
      return {
        response: {
          ok: true,
          available: true,
          muted: false,
          lease: {
            leaseId,
            expiresAt: new Date(expiresAtMs).toISOString(),
            leaseSeconds,
          },
          message: "Push-to-Talk ativo com expiração automática.",
        },
        recover: false,
      };
    });
    if (outcome.recover) {
      await this.recoverMute();
      this.microphoneMayBeOpen = false;
    }
    return outcome.response;
  }

  async renew(
    leaseId: string,
    requestedSeconds?: number,
    bindingId?: string,
    deviceId: string = "default-device",
  ): Promise<{
    ok: boolean;
    available: boolean;
    muted: boolean | null;
    lease: MicLeaseInfo | null;
    message: string;
  }> {
    return this.enqueue(async () => {
      if (
        this.closed ||
        !this.active ||
        this.active.leaseId !== leaseId ||
        this.active.deviceId !== deviceId ||
        (bindingId !== undefined && this.active.bindingId !== bindingId)
      ) {
        return {
          ok: false,
          available: !this.closed,
          muted: true,
          lease: null,
          message: "Lease Push-to-Talk expirado ou inexistente.",
        };
      }
      const leaseSeconds = clampLeaseSeconds(requestedSeconds ?? this.active.leaseSeconds);
      clearTimeout(this.active.timer);
      const expiresAtMs = this.now() + leaseSeconds * 1000;
      this.active.leaseSeconds = leaseSeconds;
      this.active.expiresAtMs = expiresAtMs;
      this.active.timer = this.scheduleExpiration(leaseId, leaseSeconds);
      return {
        ok: true,
        available: true,
        muted: false,
        lease: {
          leaseId,
          expiresAt: new Date(expiresAtMs).toISOString(),
          leaseSeconds,
        },
        message: "Lease Push-to-Talk renovado.",
      };
    });
  }

  async release(
    bindingId: string,
    leaseId?: string,
    leaseRequestId?: string,
    deviceId: string = "default-device",
  ): Promise<{
    ok: boolean;
    available: boolean;
    muted: boolean | null;
    message: string;
  }> {
    if (leaseRequestId) this.cancelRequest(deviceId, leaseRequestId);
    const outcome = await this.enqueue(async () => {
      if (
        this.active &&
        (this.active.deviceId !== deviceId ||
          this.active.bindingId !== bindingId ||
          (leaseId !== undefined && this.active.leaseId !== leaseId) ||
          (leaseId === undefined && this.active.leaseRequestId !== leaseRequestId) ||
          (leaseRequestId !== undefined &&
            this.active.leaseRequestId !== leaseRequestId))
      ) {
        return {
          response: {
            ok: false,
            available: true,
            muted: null,
            message: "Lease Push-to-Talk não corresponde à aquisição ativa.",
          },
          recover: false,
        };
      }
      if (!this.microphoneMayBeOpen) {
        return {
          response: {
            ok: true,
            available: true,
            muted: true,
            message: "Microfone já está silenciado.",
          },
          recover: false,
        };
      }
      this.clearActiveTimer();
      return { recover: true };
    });
    if (!outcome.recover) return outcome.response!;
    try {
      await this.recoverMute();
      this.microphoneMayBeOpen = false;
      return {
        ok: true,
        available: true,
        muted: true,
        message: "Microfone silenciado.",
      };
    } catch (error) {
      return {
        ok: false,
        available: false,
        muted: null,
        message: error instanceof Error ? error.message : "Não foi possível silenciar o microfone.",
      };
    }
  }

  async runManualMic<T>(
    operation: () => Promise<T>,
  ): Promise<{ blocked: true } | { blocked: false; result: T }> {
    return this.enqueue(async () => {
      if (this.closed || this.active || this.microphoneMayBeOpen) {
        return { blocked: true };
      }
      return { blocked: false, result: await operation() };
    });
  }

  snapshot(): MicLeaseSnapshot {
    if (!this.active) {
      return { pttActive: false, leaseId: null, leaseExpiresAt: null };
    }
    return {
      pttActive: true,
      leaseId: this.active.leaseId,
      leaseExpiresAt: new Date(this.active.expiresAtMs).toISOString(),
    };
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await this.enqueue(async () => {
      this.clearActiveTimer();
    });
    if (this.microphoneMayBeOpen) {
      await this.recoverMute();
      this.microphoneMayBeOpen = false;
    }
  }
}
