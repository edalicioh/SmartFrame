import type { ControlDeckHostStatus } from "@smartframe/contracts";

export type ExecFileRunner = (
  file: string,
  args: readonly string[],
  options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

export type SpawnLauncher = (
  command: string,
  args: readonly string[],
  options: { cwd?: string },
) => Promise<void>;

export type DriverRawStatus = Omit<
  ControlDeckHostStatus,
  "checkedAt" | "shortcuts" | "mic"
> & {
  mic: {
    available: boolean;
    muted: boolean | null;
  };
};

export interface HostDriver {
  readonly platform: "win32" | "linux" | "unsupported";
  getStatus(): Promise<DriverRawStatus>;
  triggerMedia(
    action: "play_pause" | "next" | "previous" | "stop",
  ): Promise<{
    available: boolean;
    uncertain?: boolean;
    playbackState: "playing" | "paused" | "stopped" | "unknown";
    message: string;
  }>;
  controlVolume(params: {
    mode: "mute_toggle" | "set_mute" | "step_up" | "step_down" | "set_level";
    step?: number;
    level?: number;
    muted?: boolean;
  }): Promise<{
    available: boolean;
    uncertain?: boolean;
    level: number | null;
    muted: boolean | null;
    message: string;
  }>;
  controlAppVolume(params: {
    appName: string;
    mode: "mute_toggle" | "set_level";
    level?: number;
  }): Promise<{
    available: boolean;
    uncertain?: boolean;
    level: number | null;
    muted: boolean | null;
    message: string;
  }>;
  controlBrightness(params: {
    mode: "step_up" | "step_down" | "set_level";
    step?: number;
    level?: number;
  }): Promise<{
    available: boolean;
    uncertain?: boolean;
    level: number | null;
    message: string;
  }>;
  controlMic(params: {
    mode: "toggle_mute" | "set_mute";
    muted?: boolean;
    pinEndpoint?: boolean;
  }): Promise<{
    available: boolean;
    uncertain?: boolean;
    muted: boolean | null;
    message: string;
  }>;
  launchShortcut(shortcut: {
    command: string;
    args: readonly string[];
    cwd?: string;
  }): Promise<{
    available: boolean;
    message: string;
  }>;
}
