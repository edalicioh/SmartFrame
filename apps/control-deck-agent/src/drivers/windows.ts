import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ExecFileRunner, HostDriver, SpawnLauncher } from "./types";
import { commandExists, isWindowsCommandScript } from "../shortcuts";

const execFileAsync = promisify(execFile);

const SAFE_CHILD_ENV_ALLOWLIST = new Set([
  "APPDATA",
  "COLORTERM",
  "COMPUTERNAME",
  "COMSPEC",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "LOGNAME",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PSMODULEPATH",
  "PUBLIC",
  "PULSE_RUNTIME_PATH",
  "PULSE_SERVER",
  "SHELL",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TZ",
  "USER",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XAUTHORITY",
  "XDG_CONFIG_HOME",
  "XDG_CURRENT_DESKTOP",
  "XDG_DATA_DIRS",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
]);

export function buildSanitizedChildEnv(
  extraEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (!SAFE_CHILD_ENV_ALLOWLIST.has(key.toUpperCase())) continue;
    sanitized[key] = value;
  }
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined) continue;
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export const defaultExecRunner: ExecFileRunner = async (
  file,
  args,
  options,
) => {
  const result = await execFileAsync(file, [...args], {
    env: buildSanitizedChildEnv(options?.env),
    timeout: options?.timeoutMs ?? 4000,
    windowsHide: true,
    maxBuffer: 256 * 1024,
  });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
};

export const defaultSpawnLauncher: SpawnLauncher = async (
  command,
  args,
  options,
) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      detached: true,
      stdio: "ignore",
      cwd: options.cwd,
      env: buildSanitizedChildEnv(),
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};

// Static PowerShell helpers: no user input is interpolated into script strings.
const CORE_AUDIO_CS = `
using System;
using System.Runtime.InteropServices;

public static class SfAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumerator {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImpl1();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice ppDevice);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    int OpenPropertyStore(int stgmAccess, out IntPtr properties);
    int GetId(out IntPtr id);
  }

  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
  }

  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int NotImpl1();
    int NotImpl2();
    int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
  }

  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int SessionCount);
    int GetSession(int SessionCount, out IAudioSessionControl Session);
  }

  [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl {
    int NotImpl1();
  }

  [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int pRetVal);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    int NotImpl1();
    int NotImpl2();
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
    int GetProcessId(out uint pRetVal);
  }

  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float fLevel, ref Guid EventContext);
    int GetMasterVolume(out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid EventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
  }

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  static IMMDevice Device(int dataFlow, string deviceId) {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice dev;
    if (String.IsNullOrEmpty(deviceId))
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(dataFlow, 0, out dev));
    else
      Marshal.ThrowExceptionForHR(enumerator.GetDevice(deviceId, out dev));
    return dev;
  }
  static IAudioEndpointVolume Endpoint(int dataFlow, string deviceId) {
    var dev = Device(dataFlow, deviceId);
    object obj;
    var iid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out obj));
    return (IAudioEndpointVolume)obj;
  }
  public static string EndpointId(int dataFlow) {
    IntPtr id;
    Marshal.ThrowExceptionForHR(Device(dataFlow, "").GetId(out id));
    try { return Marshal.PtrToStringUni(id); } finally { Marshal.FreeCoTaskMem(id); }
  }

  public static void SendKey(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    keybd_event(vk, 0, 2, UIntPtr.Zero);
  }

  public static Tuple<int, bool> ControlEndpoint(int dataFlow, string mode, int step, int level, bool muted, string deviceId) {
    var ep = Endpoint(dataFlow, deviceId);
    Guid ctx = Guid.Empty;
    if (mode == "set_level") {
      ep.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, level / 100f)), ref ctx);
    } else if (mode == "step_up") {
      float cur; ep.GetMasterVolumeLevelScalar(out cur);
      ep.SetMasterVolumeLevelScalar(Math.Min(1f, cur + (step / 100f)), ref ctx);
    } else if (mode == "step_down") {
      float cur; ep.GetMasterVolumeLevelScalar(out cur);
      ep.SetMasterVolumeLevelScalar(Math.Max(0f, cur - (step / 100f)), ref ctx);
    } else if (mode == "set_mute") {
      ep.SetMute(muted, ref ctx);
    } else if (mode == "mute_toggle" || mode == "toggle_mute") {
      bool cur; ep.GetMute(out cur);
      ep.SetMute(!cur, ref ctx);
    }
    float outLvl; ep.GetMasterVolumeLevelScalar(out outLvl);
    bool outMute; ep.GetMute(out outMute);
    return Tuple.Create((int)Math.Round(outLvl * 100f), outMute);
  }

  public static Tuple<bool, int, bool> ControlApp(string appName, string mode, int level) {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 0, out dev));
    object mgrObj;
    var mgrIid = typeof(IAudioSessionManager2).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref mgrIid, 23, IntPtr.Zero, out mgrObj));
    var mgr = (IAudioSessionManager2)mgrObj;
    IAudioSessionEnumerator sessEnum;
    Marshal.ThrowExceptionForHR(mgr.GetSessionEnumerator(out sessEnum));
    int count; sessEnum.GetCount(out count);
    Guid ctx = Guid.Empty;
    string target = (appName ?? "").Trim();
    for (int i = 0; i < count; i++) {
      IAudioSessionControl ctrl;
      sessEnum.GetSession(i, out ctrl);
      var ctrl2 = ctrl as IAudioSessionControl2;
      var vol = ctrl as ISimpleAudioVolume;
      if (ctrl2 == null || vol == null) continue;
      uint pid; ctrl2.GetProcessId(out pid);
      if (pid == 0) continue;
      try {
        var proc = System.Diagnostics.Process.GetProcessById((int)pid);
        if (!string.Equals(proc.ProcessName, target, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(proc.ProcessName + ".exe", target, StringComparison.OrdinalIgnoreCase)) continue;
        if (mode == "set_level") {
          vol.SetMasterVolume(Math.Max(0f, Math.Min(1f, level / 100f)), ref ctx);
        } else if (mode == "mute_toggle") {
          bool cur; vol.GetMute(out cur);
          vol.SetMute(!cur, ref ctx);
        }
        float outLvl; vol.GetMasterVolume(out outLvl);
        bool outMute; vol.GetMute(out outMute);
        return Tuple.Create(true, (int)Math.Round(outLvl * 100f), outMute);
      } catch {}
    }
    return Tuple.Create(false, 0, false);
  }
}
`;

const PS_STATUS_SCRIPT = `${CORE_AUDIO_CS}
Add-Type -TypeDefinition $code -Language CSharp -ErrorAction SilentlyContinue | Out-Null
`;

function psHeader(): string {
  return `$sfCode = @'\n${CORE_AUDIO_CS}\n'@\nAdd-Type -TypeDefinition $sfCode -Language CSharp | Out-Null`;
}

const WIN_STATUS_SCRIPT = `${psHeader()}
$volAvail = $false; $volLevel = $null; $volMuted = $null
try {
  $r = [SfAudio]::ControlEndpoint(0, "read", 0, 0, $false, "")
  $volAvail = $true; $volLevel = $r.Item1; $volMuted = $r.Item2
} catch {}
$micAvail = $false; $micMuted = $null
try {
  $m = [SfAudio]::ControlEndpoint(1, "read", 0, 0, $false, "")
  $micAvail = $true; $micMuted = $m.Item2
} catch {}
$briAvail = $false; $briLevel = $null
try {
  $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
  if ($null -ne $b) { $briAvail = $true; $briLevel = [int]$b.CurrentBrightness }
} catch {}
@{
  volAvail = $volAvail; volLevel = $volLevel; volMuted = $volMuted;
  micAvail = $micAvail; micMuted = $micMuted;
  briAvail = $briAvail; briLevel = $briLevel
} | ConvertTo-Json -Compress
`;

const WIN_VOLUME_SCRIPT = `${psHeader()}
$r = [SfAudio]::ControlEndpoint(0, $env:SF_MODE, [int]$env:SF_STEP, [int]$env:SF_LEVEL, ($env:SF_MUTED -eq "1"), "")
@{ available = $true; level = $r.Item1; muted = $r.Item2 } | ConvertTo-Json -Compress
`;

const WIN_MIC_ENDPOINT_SCRIPT = `${psHeader()}
$id = [SfAudio]::EndpointId(1)
@{ available = (-not [string]::IsNullOrEmpty($id)); endpointId = $id } | ConvertTo-Json -Compress
`;

const WIN_MIC_SCRIPT = `${psHeader()}
$id = $env:SF_ENDPOINT_ID
$r = [SfAudio]::ControlEndpoint(1, $env:SF_MODE, 0, 0, ($env:SF_MUTED -eq "1"), $id)
@{ available = $true; muted = $r.Item2; endpointId = $id } | ConvertTo-Json -Compress
`;

const WIN_APP_VOLUME_SCRIPT = `${psHeader()}
$r = [SfAudio]::ControlApp($env:SF_TARGET_APP, $env:SF_MODE, [int]$env:SF_LEVEL)
@{ available = $r.Item1; level = $r.Item2; muted = $r.Item3 } | ConvertTo-Json -Compress
`;

const WIN_MEDIA_SCRIPT = `${psHeader()}
[SfAudio]::SendKey([byte][int]$env:SF_VK)
@{ available = $true } | ConvertTo-Json -Compress
`;

const WIN_BRIGHTNESS_SCRIPT = `
$b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
if ($null -eq $b) { @{ available = $false; level = $null } | ConvertTo-Json -Compress; exit 0 }
$cur = [int]$b.CurrentBrightness
$next = $cur
if ($env:SF_MODE -eq "set_level") { $next = [int]$env:SF_LEVEL }
elseif ($env:SF_MODE -eq "step_up") { $next = [Math]::Min(100, $cur + [int]$env:SF_STEP) }
elseif ($env:SF_MODE -eq "step_down") { $next = [Math]::Max(0, $cur - [int]$env:SF_STEP) }
$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
if ($null -eq $m) { @{ available = $false; level = $null } | ConvertTo-Json -Compress; exit 0 }
$result = Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$next }
if ($null -eq $result -or [int]$result.ReturnValue -ne 0) {
  @{ available = $false; level = $cur } | ConvertTo-Json -Compress; exit 0
}
$actual = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
if ($null -eq $actual) { @{ available = $false; level = $null } | ConvertTo-Json -Compress; exit 0 }
@{ available = $true; level = [int]$actual.CurrentBrightness } | ConvertTo-Json -Compress
`;

void PS_STATUS_SCRIPT;

const MEDIA_VK: Record<"play_pause" | "next" | "previous" | "stop", string> = {
  play_pause: "179",
  next: "176",
  previous: "177",
  stop: "178",
};

export function createWindowsDriver(
  runner: ExecFileRunner = defaultExecRunner,
  launcher: SpawnLauncher = defaultSpawnLauncher,
  existsCheck: (command: string) => Promise<boolean> = commandExists,
): HostDriver {
  let pttEndpointId: string | null = null;
  async function runPs(script: string, env: Record<string, string>) {
    const { stdout } = await runner(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { env },
    );
    return JSON.parse(stdout.trim()) as Record<string, unknown>;
  }

  return {
    platform: "win32",
    async getStatus() {
      try {
        const res = await runPs(WIN_STATUS_SCRIPT, {});
        const volAvail = res.volAvail === true;
        const micAvail = res.micAvail === true;
        const briAvail = res.briAvail === true;
        return {
          available: true,
          platform: "win32",
          capabilities: {
            shortcuts: true,
            media: true,
            volume: volAvail,
            appVolume: volAvail,
            brightness: briAvail,
            mic: micAvail,
          },
          volume: {
            available: volAvail,
            level: volAvail && typeof res.volLevel === "number" ? res.volLevel : null,
            muted: volAvail && typeof res.volMuted === "boolean" ? res.volMuted : null,
          },
          brightness: {
            available: briAvail,
            level: briAvail && typeof res.briLevel === "number" ? res.briLevel : null,
          },
          mic: {
            available: micAvail,
            muted: micAvail && typeof res.micMuted === "boolean" ? res.micMuted : null,
          },
          media: { available: true, playbackState: "unknown" },
        };
      } catch {
        return {
          available: false,
          platform: "win32",
          capabilities: {
            shortcuts: true,
            media: true,
            volume: false,
            appVolume: false,
            brightness: false,
            mic: false,
          },
          volume: { available: false, level: null, muted: null },
          brightness: { available: false, level: null },
          mic: { available: false, muted: null },
          media: { available: true, playbackState: "unknown" },
        };
      }
    },

    async triggerMedia(action) {
      try {
        await runPs(WIN_MEDIA_SCRIPT, { SF_VK: MEDIA_VK[action] });
        return {
          available: true,
          playbackState: "unknown",
          message: `Comando de mídia ${action} enviado.`,
        };
      } catch {
        return {
          available: false,
          playbackState: "unknown",
          message: "Controle de mídia indisponível neste host.",
        };
      }
    },

    async controlVolume(params) {
      try {
        const safeStep = Number.isFinite(params.step)
          ? Math.max(1, Math.min(25, Math.trunc(params.step!)))
          : 5;
        const res = await runPs(WIN_VOLUME_SCRIPT, {
          SF_MODE: params.mode,
          SF_STEP: String(safeStep),
          SF_LEVEL: String(params.level ?? 0),
          SF_MUTED: params.muted ? "1" : "0",
        });
        return {
          available: res.available === true,
          level: typeof res.level === "number" ? res.level : null,
          muted: typeof res.muted === "boolean" ? res.muted : null,
          message: "Volume atualizado.",
        };
      } catch {
        return {
          available: false,
          level: null,
          muted: null,
          message: "Controle de volume indisponível neste host.",
        };
      }
    },

    async controlAppVolume(params) {
      try {
        const res = await runPs(WIN_APP_VOLUME_SCRIPT, {
          SF_TARGET_APP: params.appName,
          SF_MODE: params.mode,
          SF_LEVEL: String(params.level ?? 0),
        });
        if (res.available !== true) {
          return {
            available: false,
            level: null,
            muted: null,
            message: `Sessão de áudio não encontrada para ${params.appName}.`,
          };
        }
        return {
          available: true,
          level: typeof res.level === "number" ? res.level : null,
          muted: typeof res.muted === "boolean" ? res.muted : null,
          message: "Volume do aplicativo atualizado.",
        };
      } catch {
        return {
          available: false,
          level: null,
          muted: null,
          message: "Controle de volume por aplicativo indisponível.",
        };
      }
    },

    async controlBrightness(params) {
      try {
        const safeStep = Number.isFinite(params.step)
          ? Math.max(1, Math.min(25, Math.trunc(params.step!)))
          : 10;
        const res = await runPs(WIN_BRIGHTNESS_SCRIPT, {
          SF_MODE: params.mode,
          SF_STEP: String(safeStep),
          SF_LEVEL: String(params.level ?? 50),
        });
        if (res.available !== true) {
          return {
            available: false,
            level: null,
            message: "Controle de brilho WMI indisponível neste monitor.",
          };
        }
        return {
          available: true,
          level: typeof res.level === "number" ? res.level : null,
          message: "Brilho atualizado.",
        };
      } catch {
        return {
          available: false,
          level: null,
          message: "Controle de brilho indisponível neste host.",
        };
      }
    },

    async controlMic(params) {
      let prepared = false;
      try {
        const pinEndpoint = params.pinEndpoint !== false;
        const acquiring = pinEndpoint && params.mode === "set_mute" && params.muted === false;
        if (acquiring && !pttEndpointId) {
          const epRes = await runPs(WIN_MIC_ENDPOINT_SCRIPT, {});
          if (epRes.available !== true || typeof epRes.endpointId !== "string" || !epRes.endpointId) {
            return {
              available: false,
              muted: null,
              message: "Microfone indisponível neste host.",
            };
          }
          pttEndpointId = epRes.endpointId;
        }
        const targetId =
          pinEndpoint && (acquiring || (params.mode === "set_mute" && params.muted === true))
            ? (pttEndpointId ?? "")
            : "";
        prepared = true;
        const res = await runPs(WIN_MIC_SCRIPT, {
          SF_MODE: params.mode,
          SF_MUTED: params.muted ? "1" : "0",
          SF_ENDPOINT_ID: targetId,
        });
        if (
          pinEndpoint &&
          params.mode === "set_mute" &&
          params.muted === true &&
          res.available === true &&
          res.muted === true
        ) {
          pttEndpointId = null;
        }
        return {
          available: res.available === true,
          muted: typeof res.muted === "boolean" ? res.muted : null,
          message: "Microfone atualizado.",
        };
      } catch {
        return {
          available: false,
          ...(prepared ? { uncertain: true } : {}),
          muted: null,
          message: "Microfone indisponível neste host.",
        };
      }
    },

    async launchShortcut(shortcut) {
      if (isWindowsCommandScript(shortcut.command)) {
        return {
          available: false,
          message: "Scripts .cmd/.bat não são suportados por spawn sem shell.",
        };
      }
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
