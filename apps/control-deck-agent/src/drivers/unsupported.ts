import type { HostDriver } from "./types";

export function createUnsupportedDriver(): HostDriver {
  return {
    platform: "unsupported",
    async getStatus() {
      return {
        available: false,
        platform: "unsupported",
        capabilities: {
          shortcuts: false,
          media: false,
          volume: false,
          appVolume: false,
          brightness: false,
          mic: false,
        },
        volume: { available: false, level: null, muted: null },
        brightness: { available: false, level: null },
        mic: { available: false, muted: null },
        media: { available: false, playbackState: "unknown" },
      };
    },
    async triggerMedia() {
      return {
        available: false,
        playbackState: "unknown",
        message: "Plataforma sem suporte para mídia.",
      };
    },
    async controlVolume() {
      return {
        available: false,
        level: null,
        muted: null,
        message: "Plataforma sem suporte para volume.",
      };
    },
    async controlAppVolume() {
      return {
        available: false,
        level: null,
        muted: null,
        message: "Plataforma sem suporte para volume por aplicativo.",
      };
    },
    async controlBrightness() {
      return {
        available: false,
        level: null,
        message: "Plataforma sem suporte para brilho.",
      };
    },
    async controlMic() {
      return {
        available: false,
        muted: null,
        message: "Plataforma sem suporte para microfone.",
      };
    },
    async launchShortcut() {
      return {
        available: false,
        message: "Plataforma sem suporte para atalhos.",
      };
    },
  };
}
