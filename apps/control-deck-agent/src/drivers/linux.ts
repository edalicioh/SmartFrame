import type { ExecFileRunner, HostDriver, SpawnLauncher } from "./types";
import { commandExists } from "../shortcuts";
import { defaultExecRunner, defaultSpawnLauncher } from "./windows";

function parsePercent(text: string): number | null {
  const match = /(\d{1,3})%/.exec(text);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isInteger(num) ? Math.max(0, Math.min(100, num)) : null;
}

function parseBoolYes(text: string): boolean | null {
  if (/:\s*yes\b/i.test(text)) return true;
  if (/:\s*no\b/i.test(text)) return false;
  return null;
}

function parseSinkInputIds(stdout: string, appName: string): string[] {
  const target = appName.trim().toLowerCase();
  const blocks = stdout.split(/Sink Input #(\d+)/g);
  const matched: string[] = [];
  for (let i = 1; i + 1 < blocks.length; i += 2) {
    const id = blocks[i];
    const body = blocks[i + 1] ?? "";
    const bin = /application\.process\.binary\s*=\s*"([^"]+)"/i.exec(body)?.[1]?.toLowerCase() ?? "";
    const name = /application\.name\s*=\s*"([^"]+)"/i.exec(body)?.[1]?.toLowerCase() ?? "";
    if (bin === target || name === target || bin.endsWith(`/${target}`)) {
      matched.push(id);
    }
  }
  return matched;
}

export function createLinuxDriver(
  runner: ExecFileRunner = defaultExecRunner,
  launcher: SpawnLauncher = defaultSpawnLauncher,
  existsCheck: (command: string) => Promise<boolean> = commandExists,
): HostDriver {
  let pttSource: string | null = null;
  async function resolveDefaultSource(): Promise<string> {
    const out = await runner("pactl", ["get-default-source"]);
    const source = out.stdout.trim();
    if (!source || /[\r\n\0]/.test(source)) throw new Error("Fonte de áudio indisponível.");
    return source;
  }

  async function readVolume() {
    try {
      const [volOut, muteOut] = await Promise.all([
        runner("pactl", ["get-sink-volume", "@DEFAULT_SINK@"]),
        runner("pactl", ["get-sink-mute", "@DEFAULT_SINK@"]),
      ]);
      const level = parsePercent(volOut.stdout);
      const muted = parseBoolYes(muteOut.stdout);
      return { available: level !== null, level, muted };
    } catch {
      return { available: false, level: null, muted: null };
    }
  }

  async function readMic(source = "@DEFAULT_SOURCE@") {
    try {
      const muteOut = await runner("pactl", ["get-source-mute", source]);
      const muted = parseBoolYes(muteOut.stdout);
      return { available: muted !== null, muted };
    } catch {
      return { available: false, muted: null };
    }
  }

  async function readBrightness() {
    try {
      const [curOut, maxOut] = await Promise.all([
        runner("brightnessctl", ["get"]),
        runner("brightnessctl", ["max"]),
      ]);
      const cur = Number(curOut.stdout.trim());
      const max = Number(maxOut.stdout.trim());
      if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) {
        return { available: false, level: null };
      }
      return {
        available: true,
        level: Math.max(0, Math.min(100, Math.round((cur / max) * 100))),
      };
    } catch {
      return { available: false, level: null };
    }
  }

  async function readMedia() {
    try {
      const out = await runner("playerctl", ["status"]);
      const status = out.stdout.trim().toLowerCase();
      const playbackState =
        status === "playing"
          ? "playing"
          : status === "paused"
            ? "paused"
            : status === "stopped"
              ? "stopped"
              : "unknown";
      return { available: true, playbackState } as const;
    } catch {
      return { available: false, playbackState: "unknown" } as const;
    }
  }

  return {
    platform: "linux",
    async getStatus() {
      const [volume, mic, brightness, media] = await Promise.all([
        readVolume(),
        readMic(),
        readBrightness(),
        readMedia(),
      ]);
      // Shortcuts are checked against their allowlisted executable separately by the agent.
      const shortcutExecutionSupported = true;
      const anyAvailable =
        shortcutExecutionSupported ||
        volume.available ||
        mic.available ||
        brightness.available ||
        media.available;
      return {
        available: anyAvailable,
        platform: "linux",
        capabilities: {
          shortcuts: shortcutExecutionSupported,
          media: media.available,
          volume: volume.available,
          appVolume: volume.available,
          brightness: brightness.available,
          mic: mic.available,
        },
        volume,
        brightness,
        mic,
        media,
      };
    },

    async triggerMedia(action) {
      const arg = action === "play_pause" ? "play-pause" : action;
      let mutated = false;
      try {
        await runner("playerctl", [arg]);
        mutated = true;
        const next = await readMedia();
        if (!next.available) {
          return {
            available: true,
            uncertain: true,
            playbackState: "unknown",
            message: "Comando enviado sem confirmação de retorno no host.",
          };
        }
        return {
          available: true,
          playbackState: next.playbackState,
          message: `Comando de mídia ${action} enviado.`,
        };
      } catch {
        return {
          available: mutated,
          ...(mutated ? { uncertain: true } : {}),
          playbackState: "unknown",
          message: mutated
            ? "Comando enviado sem confirmação de retorno no host."
            : "playerctl indisponível ou nenhum player ativo.",
        };
      }
    },

    async controlVolume(params) {
      let mutated = false;
      try {
        if (params.mode === "set_level") {
          const pct = Math.max(0, Math.min(100, Math.trunc(params.level ?? 0)));
          await runner("pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${pct}%`]);
        } else if (params.mode === "step_up") {
          const step = Math.max(1, Math.min(25, Math.trunc(params.step ?? 5)));
          await runner("pactl", ["set-sink-volume", "@DEFAULT_SINK@", `+${step}%`]);
        } else if (params.mode === "step_down") {
          const step = Math.max(1, Math.min(25, Math.trunc(params.step ?? 5)));
          await runner("pactl", ["set-sink-volume", "@DEFAULT_SINK@", `-${step}%`]);
        } else if (params.mode === "set_mute") {
          await runner("pactl", ["set-sink-mute", "@DEFAULT_SINK@", params.muted ? "1" : "0"]);
        } else {
          await runner("pactl", ["set-sink-mute", "@DEFAULT_SINK@", "toggle"]);
        }
        mutated = true;
        const status = await readVolume();
        if (!status.available) {
          return {
            available: true,
            uncertain: true,
            level: null,
            muted: null,
            message: "Comando enviado sem confirmação de retorno no host.",
          };
        }
        return { ...status, message: "Volume atualizado." };
      } catch {
        return {
          available: mutated,
          ...(mutated ? { uncertain: true } : {}),
          level: null,
          muted: null,
          message: mutated
            ? "Comando enviado sem confirmação de retorno no host."
            : "Controle de volume (pactl) indisponível.",
        };
      }
    },

    async controlAppVolume(params) {
      let mutated = false;
      try {
        const list = await runner("pactl", ["list", "sink-inputs"]);
        const ids = parseSinkInputIds(list.stdout, params.appName);
        if (ids.length === 0) {
          return {
            available: false,
            level: null,
            muted: null,
            message: `Sessão de áudio não encontrada para ${params.appName}.`,
          };
        }
        for (const id of ids) {
          if (params.mode === "set_level") {
            const pct = Math.max(0, Math.min(100, Math.trunc(params.level ?? 0)));
            await runner("pactl", ["set-sink-input-volume", id, `${pct}%`]);
          } else {
            await runner("pactl", ["set-sink-input-mute", id, "toggle"]);
          }
          mutated = true;
        }
        return {
          available: true,
          level: params.mode === "set_level" ? Math.max(0, Math.min(100, params.level ?? 0)) : null,
          muted: null,
          message: "Volume do aplicativo atualizado.",
        };
      } catch {
        return {
          available: mutated,
          ...(mutated ? { uncertain: true } : {}),
          level: null,
          muted: null,
          message: mutated
            ? "Comando enviado sem confirmação de retorno no host."
            : "Controle de volume por aplicativo indisponível.",
        };
      }
    },

    async controlBrightness(params) {
      let mutated = false;
      try {
        if (params.mode === "set_level") {
          const pct = Math.max(0, Math.min(100, Math.trunc(params.level ?? 50)));
          await runner("brightnessctl", ["set", `${pct}%`]);
        } else if (params.mode === "step_up") {
          const step = Math.max(1, Math.min(25, Math.trunc(params.step ?? 10)));
          await runner("brightnessctl", ["set", `+${step}%`]);
        } else {
          const step = Math.max(1, Math.min(25, Math.trunc(params.step ?? 10)));
          await runner("brightnessctl", ["set", `${step}%-`]);
        }
        mutated = true;
        const status = await readBrightness();
        if (!status.available) {
          return {
            available: true,
            uncertain: true,
            level: null,
            message: "Comando enviado sem confirmação de retorno no host.",
          };
        }
        return { ...status, message: "Brilho atualizado." };
      } catch {
        return {
          available: mutated,
          ...(mutated ? { uncertain: true } : {}),
          level: null,
          message: mutated
            ? "Comando enviado sem confirmação de retorno no host."
            : "Controle de brilho (brightnessctl) indisponível.",
        };
      }
    },

    async controlMic(params) {
      let mutated = false;
      try {
        const pinEndpoint = params.pinEndpoint !== false;
        const acquiring = pinEndpoint && params.mode === "set_mute" && params.muted === false;
        const source = acquiring
          ? pttSource ?? (pttSource = await resolveDefaultSource())
          : pinEndpoint && params.mode === "set_mute" && params.muted === true && pttSource
            ? pttSource
            : await resolveDefaultSource();
        if (params.mode === "set_mute") {
          await runner("pactl", ["set-source-mute", source, params.muted ? "1" : "0"]);
        } else {
          await runner("pactl", ["set-source-mute", source, "toggle"]);
        }
        mutated = true;
        const status = await readMic(source);
        if (!status.available) {
          return {
            available: true,
            uncertain: true,
            muted: null,
            message: "Comando enviado sem confirmação de retorno no host.",
          };
        }
        if (
          pinEndpoint &&
          params.mode === "set_mute" &&
          params.muted === true &&
          status.muted === true
        ) {
          pttSource = null;
        }
        return { ...status, message: "Microfone atualizado." };
      } catch {
        return {
          available: mutated,
          ...(mutated ? { uncertain: true } : {}),
          muted: null,
          message: mutated
            ? "Comando enviado sem confirmação de retorno no host."
            : "Controle de microfone (pactl) indisponível.",
        };
      }
    },

    async launchShortcut(shortcut) {
      if (!(await existsCheck(shortcut.command))) {
        return {
          available: false,
          message: "Executável do atalho não encontrado no host.",
        };
      }
      try {
        await launcher(shortcut.command, shortcut.args, { cwd: shortcut.cwd });
        return { available: true, message: "Atalho iniciado no host." };
      } catch {
        return { available: false, message: "Falha ao iniciar o atalho no host." };
      }
    },
  };
}
