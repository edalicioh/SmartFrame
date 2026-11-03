"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultOnlineDashboard,
  onlineDashboardSchema,
  type OnlineDashboard,
  type OnlineDashboardState,
} from "@smartframe/contracts";

type Device = {
  id: string;
  name: string;
  lastSeenAt: string | null;
  appliedRevision: string | null;
};
type Photo = {
  id: string;
  filename: string;
  status: string;
  width?: number | null;
  height?: number | null;
};
type Pairing = { code: string; expiresAt: string; serverURL: string };

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir a operação.");
  return data;
}

const pendingPhoto = (photo: Photo) => photo.status === "pending" || photo.status === "processing";

export function OnlineFrameEditor() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [state, setState] = useState<OnlineDashboardState | null>(null);
  const [config, setConfig] = useState<OnlineDashboard>(defaultOnlineDashboard);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [photoPollExpired, setPhotoPollExpired] = useState(false);
  const [photoPollRetry, setPhotoPollRetry] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const operation = useRef(false);
  const selectedId = useRef(deviceId);

  const readyPhotos = useMemo(() => photos.filter((photo) => photo.status === "ready"), [photos]);
  const hasPendingPhotos = photos.some(pendingPhoto);
  const previewConfig = useMemo(() => {
    const byId = new Map(readyPhotos.map((photo) => [photo.id, photo]));
    return {
      ...config,
      widgets: {
        ...config.widgets,
        photos: {
          ...config.widgets.photos,
          items: config.widgets.photos.photoIds.flatMap((id) => {
            const photo = byId.get(id);
            return photo ? [{ id, src: `/api/photos/${id}/image`, alt: photo.filename }] : [];
          }),
        },
      },
    };
  }, [config, readyPhotos]);

  const sendPreview = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      { type: "smartframe:online-preview", config: previewConfig },
      window.location.origin,
    );
  }, [previewConfig]);
  useEffect(() => {
    sendPreview();
  }, [sendPreview]);

  const refreshDevices = useCallback(async () => {
    const result = await api("/api/devices");
    setDevices(result.data ?? []);
  }, []);
  const refreshPhotos = useCallback(async () => {
    const result = await api("/api/photos");
    setPhotos(result.photos ?? []);
    return (result.photos ?? []) as Photo[];
  }, []);

  useEffect(() => {
    let active = true;
    api("/api/devices")
      .then((result) => {
        if (active) setDevices(result.data ?? []);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    api("/api/photos")
      .then((result) => {
        if (active) setPhotos(result.photos ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let active = true;
    // Loading and clearing old device data must happen before its response can render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setState(null);
    setError("");
    api(`/api/online-frame?deviceId=${encodeURIComponent(deviceId)}`)
      .then((next: OnlineDashboardState) => {
        if (!active || selectedId.current !== deviceId) return;
        setState(next);
        setConfig(next.config);
        setDirty(false);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deviceId]);

  useEffect(() => {
    if (!pairing) return;
    let active = true;
    const timer = window.setInterval(() => {
      refreshDevices().catch((failure) => {
        if (active) setError(failure.message);
      });
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pairing, refreshDevices]);

  useEffect(() => {
    if (!deviceId || !state) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (!active || operation.current) return;
      try {
        const latest: OnlineDashboardState = await api(
          `/api/online-frame?deviceId=${encodeURIComponent(deviceId)}`,
        );
        if (!active || selectedId.current !== deviceId) return;
        setState((current) =>
          current && current.deviceId === deviceId
            ? {
                ...current,
                publishedRevision: latest.publishedRevision,
                appliedRevision: latest.appliedRevision,
                lastSeenAt: latest.lastSeenAt,
                ...(!dirty && !operation.current
                  ? { draftRevision: latest.draftRevision, config: latest.config }
                  : {}),
              }
            : current,
        );
        if (!dirty && !operation.current) setConfig(latest.config);
      } catch {
        /* Keep the last known device status on transient errors. */
      }
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // The polling response intentionally does not depend on the full state object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, state?.deviceId, dirty]);

  useEffect(() => {
    if (!hasPendingPhotos) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhotoPollExpired(false);
      return;
    }
    let active = true;
    let inFlight = false;
    let attempts = 0;
    setPhotoPollExpired(false);
    const timer = window.setInterval(async () => {
      if (!active || inFlight || attempts >= 36) return;
      inFlight = true;
      attempts += 1;
      try {
        const updated = await refreshPhotos();
        if (!updated.some(pendingPhoto)) window.clearInterval(timer);
        if (attempts >= 36 && updated.some(pendingPhoto)) {
          setPhotoPollExpired(true);
          window.clearInterval(timer);
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error
              ? `Não foi possível atualizar o processamento das fotos: ${failure.message}`
              : "Não foi possível atualizar as fotos.",
          );
      } finally {
        inFlight = false;
        if (attempts >= 36 && active) {
          setPhotoPollExpired(true);
          window.clearInterval(timer);
        }
      }
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hasPendingPhotos, photoPollRetry, refreshPhotos]);

  function change(next: OnlineDashboard) {
    setConfig(next);
    setDirty(true);
    setNotice("");
  }
  function changeTheme(theme: OnlineDashboard["theme"]) {
    const palettes = {
      light: { backgroundColor: "#E8EEF5", accentColor: "#2563EB", textColor: "#172033" },
      dark: { backgroundColor: "#101C2B", accentColor: "#2563EB", textColor: "#F1F5F9" },
    };
    const previous = palettes[config.theme];
    const next = { ...config.appearance };
    for (const key of ["backgroundColor", "accentColor", "textColor"] as const) {
      if (next[key].toUpperCase() === previous[key]) next[key] = palettes[theme][key];
    }
    change({ ...config, theme, appearance: next });
  }
  function chooseDevice(nextId: string) {
    if (operation.current || loading) return;
    if (dirty && !window.confirm("Há alterações não salvas. Descartar para trocar de dispositivo?"))
      return;
    selectedId.current = nextId;
    setDeviceId(nextId);
    setState(null);
    setDirty(false);
  }

  async function save(publish: boolean) {
    if (!state || !deviceId || operation.current) return;
    const parsed = onlineDashboardSchema.safeParse(config);
    if (!parsed.success) {
      setError("Confira as configurações antes de salvar.");
      return;
    }
    operation.current = true;
    setBusy(publish ? "Publicando…" : "Salvando…");
    setError("");
    setNotice("");
    try {
      let revision = state.draftRevision;
      const savedConfig = parsed.data;
      if (dirty || revision === 0) {
        const result = await api("/api/online-frame", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, config: savedConfig, expectedRevision: revision }),
        });
        revision = result.draftRevision;
        setState((current) =>
          current?.deviceId === deviceId
            ? { ...current, draftRevision: revision, config: savedConfig }
            : current,
        );
        setDirty(false);
      }
      let publishedRevision = state.publishedRevision;
      if (publish) {
        const result = await api("/api/online-frame/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId, expectedRevision: revision }),
        });
        publishedRevision = result.revision;
      }
      setState((current) =>
        current?.deviceId === deviceId
          ? { ...current, config: savedConfig, draftRevision: revision, publishedRevision }
          : current,
      );
      setDirty(false);
      setNotice(
        publish
          ? "Publicado. Aguardando confirmação de aplicação pelo dispositivo."
          : "Rascunho salvo; o dispositivo não foi alterado.",
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao salvar.");
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  async function upload(files: FileList | null) {
    if (!files || operation.current) return;
    operation.current = true;
    setBusy("Enviando fotos…");
    setError("");
    try {
      for (const file of Array.from(files)) {
        if (file.size > 12 * 1024 ** 2)
          throw new Error(`${file.name}: escolha uma imagem de até 12 MB.`);
        const form = new FormData();
        form.set("photo", file);
        const added: Photo = await api("/api/photos", { method: "POST", body: form });
        setPhotos((current) => [{ ...added }, ...current.filter((photo) => photo.id !== added.id)]);
        if (added.status === "ready")
          setConfig((current) => ({
            ...current,
            widgets: {
              ...current.widgets,
              photos: {
                ...current.widgets.photos,
                photoIds: [...current.widgets.photos.photoIds, added.id],
              },
            },
          }));
        setDirty(true);
      }
      setNotice(
        "Fotos enviadas. As que estão sendo processadas serão selecionáveis quando prontas.",
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao enviar fotos.");
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  async function pair() {
    if (operation.current) return;
    operation.current = true;
    setBusy("Gerando código…");
    try {
      setPairing(await api("/api/devices/pairing-code", { method: "POST" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao gerar código.");
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  async function revoke(device: Device) {
    if (operation.current || !window.confirm(`Desvincular ${device.name}?`)) return;
    operation.current = true;
    setBusy("Desvinculando…");
    try {
      await api(`/api/devices/${device.id}`, { method: "DELETE" });
      setDevices((current) => current.filter((item) => item.id !== device.id));
      if (device.id === deviceId) {
        selectedId.current = "";
        setDeviceId("");
        setState(null);
        setDirty(false);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao desvincular.");
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  const widget = (key: keyof OnlineDashboard["widgets"], enabled: boolean) =>
    change({
      ...config,
      widgets: { ...config.widgets, [key]: { ...config.widgets[key], enabled } },
    });
  const movePhoto = (index: number, delta: number) => {
    const ids = [...config.widgets.photos.photoIds];
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    change({
      ...config,
      widgets: { ...config.widgets, photos: { ...config.widgets.photos, photoIds: ids } },
    });
  };
  const controlsDisabled = !!busy || loading || !state;
  const selectedPhotoIds = config.widgets.photos.photoIds;
  const orderedSelected = selectedPhotoIds.flatMap((id) => {
    const photo = photos.find((item) => item.id === id);
    return photo ? [photo] : [];
  });

  return (
    <main className="online-editor">
      <div className="online-title">
        <div>
          <p className="online-eyebrow">SMARTFRAME ONLINE</p>
          <h1>Personalize seu porta-retratos</h1>
          <p>Configure, visualize e publique o conteúdo do seu dispositivo.</p>
        </div>
        <label>
          Dispositivo
          <select
            disabled={!!busy || loading}
            value={deviceId}
            onChange={(event) => chooseDevice(event.target.value)}
          >
            <option value="">Selecione um dispositivo</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!devices.length && (
        <div className="online-callout">
          Nenhum dispositivo vinculado. Gere um código e vincule o SmartFrame para começar.
          <button disabled={!!busy} onClick={() => void pair()}>
            Vincular dispositivo
          </button>
        </div>
      )}
      {pairing && (
        <div className="online-callout">
          Código <strong>{pairing.code}</strong> · expira{" "}
          {new Date(pairing.expiresAt).toLocaleTimeString("pt-BR")} · Servidor:{" "}
          <strong>{pairing.serverURL}</strong>
          <button disabled={!!busy} onClick={() => setPairing(null)}>
            Fechar
          </button>
        </div>
      )}
      {devices.length > 0 && (
        <div className="online-device-actions">
          <button disabled={!!busy} onClick={() => void pair()}>
            Gerar código para novo dispositivo
          </button>
          {deviceId && (
            <button
              disabled={!!busy}
              className="online-danger"
              onClick={() => {
                const device = devices.find((item) => item.id === deviceId);
                if (device) void revoke(device);
              }}
            >
              Desvincular selecionado
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="online-error" role="alert">
          {error}
        </div>
      )}
      {notice && <div className="online-notice">{notice}</div>}
      {!deviceId ? (
        <p className="online-empty">Selecione um dispositivo para editar seu painel.</p>
      ) : loading ? (
        <p className="online-empty">Carregando configuração do dispositivo…</p>
      ) : !state ? (
        <p className="online-error">
          A configuração deste dispositivo não pôde ser carregada. Verifique a conexão e selecione
          novamente para tentar.
        </p>
      ) : (
        <div className="online-grid">
          <section className="online-controls">
            {busy && <p className="online-busy">{busy}</p>}
            <fieldset disabled={controlsDisabled}>
              <legend>Fotos</legend>
              <label className="online-upload">
                Adicionar várias fotos
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => {
                    void upload(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <div className="online-photo-list">
                {photos.map((photo) => (
                  <div className="online-photo" key={photo.id}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={controlsDisabled || photo.status !== "ready"}
                        checked={selectedPhotoIds.includes(photo.id)}
                        onChange={(event) => {
                          const ids = event.target.checked
                            ? [...selectedPhotoIds, photo.id]
                            : selectedPhotoIds.filter((id) => id !== photo.id);
                          change({
                            ...config,
                            widgets: {
                              ...config.widgets,
                              photos: { ...config.widgets.photos, photoIds: ids },
                            },
                          });
                        }}
                      />
                      {photo.filename}
                      <small>
                        {photo.status === "ready"
                          ? `${photo.width ?? ""} × ${photo.height ?? ""}`
                          : `${photo.status} — indisponível até concluir`}
                      </small>
                    </label>
                  </div>
                ))}
              </div>
              <div className="online-ordered-photos">
                <strong>Ordem do painel</strong>
                {orderedSelected.map((photo, index) => (
                  <div className="online-photo" key={photo.id}>
                    <span>
                      {index + 1}. {photo.filename}
                    </span>
                    <span>
                      <button
                        disabled={controlsDisabled || index === 0}
                        onClick={() => movePhoto(index, -1)}
                        aria-label="Mover foto para cima"
                      >
                        ↑
                      </button>
                      <button
                        disabled={controlsDisabled || index === orderedSelected.length - 1}
                        onClick={() => movePhoto(index, 1)}
                        aria-label="Mover foto para baixo"
                      >
                        ↓
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <label>
                Troca de foto (segundos)
                <input
                  type="number"
                  min="5"
                  max="3600"
                  value={config.widgets.photos.intervalSeconds}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        photos: {
                          ...config.widgets.photos,
                          intervalSeconds: Number(event.target.value),
                        },
                      },
                    })
                  }
                />
              </label>
              <label>
                Ajuste da imagem
                <select
                  value={config.widgets.photos.fit}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        photos: {
                          ...config.widgets.photos,
                          fit: event.target.value as "cover" | "contain",
                        },
                      },
                    })
                  }
                >
                  <option value="cover">Preencher</option>
                  <option value="contain">Conter</option>
                </select>
              </label>
            </fieldset>
            {photoPollExpired && (
              <div className="online-callout">
                O processamento continua pendente após 90 segundos.
                <button
                  disabled={!!busy}
                  onClick={() => {
                    setPhotoPollExpired(false);
                    setPhotoPollRetry((retry) => retry + 1);
                    void refreshPhotos().catch((failure) => setError(failure.message));
                  }}
                >
                  Atualizar fotos
                </button>
              </div>
            )}
            <fieldset disabled={controlsDisabled}>
              <legend>Widgets</legend>
              {(
                [
                  ["clock", "Relógio"],
                  ["weather", "Clima"],
                  ["currencies", "Moedas"],
                  ["calendar", "Calendário"],
                ] as const
              ).map(([key, label]) => (
                <label className="online-toggle" key={key}>
                  <input
                    type="checkbox"
                    checked={config.widgets[key].enabled}
                    onChange={(event) => widget(key, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
              <label className="online-toggle">
                <input
                  type="checkbox"
                  checked={config.widgets.photos.enabled}
                  onChange={(event) => widget("photos", event.target.checked)}
                />
                Fotos
              </label>
              <label>
                Formato do relógio
                <select
                  value={config.widgets.clock.format}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        clock: {
                          ...config.widgets.clock,
                          format: event.target.value as "12h" | "24h",
                        },
                      },
                    })
                  }
                >
                  <option value="24h">24 horas</option>
                  <option value="12h">12 horas</option>
                </select>
              </label>
              <label>
                Tamanho do relógio
                <select
                  value={config.widgets.clock.size}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        clock: {
                          ...config.widgets.clock,
                          size: event.target.value as "small" | "normal" | "large",
                        },
                      },
                    })
                  }
                >
                  <option value="small">Pequeno</option>
                  <option value="normal">Normal</option>
                  <option value="large">Grande</option>
                </select>
              </label>
              <label className="online-toggle">
                <input
                  type="checkbox"
                  checked={config.widgets.clock.showDate}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        clock: { ...config.widgets.clock, showDate: event.target.checked },
                      },
                    })
                  }
                />
                Mostrar data
              </label>
              <label>
                Cor do relógio
                <input
                  type="color"
                  value={config.widgets.clock.color || config.appearance.textColor}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        clock: { ...config.widgets.clock, color: event.target.value },
                      },
                    })
                  }
                />
              </label>
              <label>
                Cidade do clima
                <input
                  value={config.widgets.weather.city}
                  maxLength={80}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        weather: { ...config.widgets.weather, city: event.target.value },
                      },
                    })
                  }
                />
              </label>
              <label>
                Moedas
                <select
                  multiple
                  value={config.widgets.currencies.symbols}
                  onChange={(event) => {
                    const symbols = Array.from(
                      event.target.selectedOptions,
                      (option) => option.value as "USD" | "EUR" | "BTC",
                    );
                    if (symbols.length)
                      change({
                        ...config,
                        widgets: {
                          ...config.widgets,
                          currencies: { ...config.widgets.currencies, symbols },
                        },
                      });
                  }}
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="BTC">BTC</option>
                </select>
                <small>Use Ctrl/Cmd para selecionar várias (mínimo uma).</small>
              </label>
              <label>
                Intervalo das moedas (segundos)
                <input
                  type="number"
                  min="5"
                  max="3600"
                  value={config.widgets.currencies.intervalSeconds}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        currencies: {
                          ...config.widgets.currencies,
                          intervalSeconds: Number(event.target.value),
                        },
                      },
                    })
                  }
                />
              </label>
              <label className="online-toggle">
                <input
                  type="checkbox"
                  checked={config.widgets.calendar.highlightToday}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        calendar: {
                          ...config.widgets.calendar,
                          highlightToday: event.target.checked,
                        },
                      },
                    })
                  }
                />
                Destacar o dia atual
              </label>
            </fieldset>
            <fieldset disabled={controlsDisabled}>
              <legend>Aparência e layout</legend>
              <label>
                Tema
                <select
                  value={config.theme}
                  onChange={(event) => changeTheme(event.target.value as "light" | "dark")}
                >
                  <option value="light">Claro</option>
                  <option value="dark">Escuro</option>
                </select>
              </label>
              {(
                [
                  ["backgroundColor", "Fundo"],
                  ["accentColor", "Destaque"],
                  ["textColor", "Texto"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="color"
                    value={config.appearance[key]}
                    onChange={(event) =>
                      change({
                        ...config,
                        appearance: { ...config.appearance, [key]: event.target.value },
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Orientação do painel
                <select
                  value={config.orientation}
                  onChange={(event) =>
                    change({
                      ...config,
                      orientation: event.target.value as "landscape" | "portrait",
                    })
                  }
                >
                  <option value="landscape">Paisagem</option>
                  <option value="portrait">Retrato</option>
                </select>
                <small>
                  A apresentação se adapta à proporção da tela; não bloqueia a orientação física.
                </small>
              </label>
              <label>
                Proporção da foto · {config.layoutOptions.photoWidthPercent}%
                <input
                  type="range"
                  min="40"
                  max="75"
                  value={config.layoutOptions.photoWidthPercent}
                  onChange={(event) =>
                    change({
                      ...config,
                      layoutOptions: {
                        ...config.layoutOptions,
                        photoWidthPercent: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                Posição da foto
                <select
                  value={config.layoutOptions.photoPosition}
                  onChange={(event) =>
                    change({
                      ...config,
                      layoutOptions: {
                        ...config.layoutOptions,
                        photoPosition: event.target.value as "left" | "right",
                      },
                    })
                  }
                >
                  <option value="left">Esquerda</option>
                  <option value="right">Direita</option>
                </select>
              </label>
              <label>
                Atualização geral (segundos)
                <input
                  type="number"
                  min="10"
                  max="3600"
                  value={config.refreshSeconds}
                  onChange={(event) =>
                    change({ ...config, refreshSeconds: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Fuso horário
                <input
                  value={config.timezone}
                  onChange={(event) => change({ ...config, timezone: event.target.value })}
                />
              </label>
            </fieldset>
            <div className="online-save">
              <button disabled={controlsDisabled} onClick={() => void save(false)}>
                Salvar rascunho
              </button>
              <button
                disabled={
                  controlsDisabled ||
                  !selectedPhotoIds.every((id) => readyPhotos.some((photo) => photo.id === id))
                }
                onClick={() => void save(true)}
              >
                Publicar
              </button>
              {dirty && <small>Alterações não salvas</small>}
            </div>
          </section>
          <section className="online-preview">
            <header>
              <strong>Prévia ao vivo</strong>
              <span>
                {state.publishedRevision
                  ? `Publicado ${state.publishedRevision}`
                  : "Ainda não publicado"}
              </span>
            </header>
            <iframe
              ref={frame}
              onLoad={sendPreview}
              src="/player-dashboard/index.html?preview=1"
              title="Prévia do painel"
            />
            <p>
              Rascunho r{state.draftRevision} · Publicado {state.publishedRevision ?? "—"} ·
              Aplicado pelo dispositivo {state.appliedRevision ?? "—"}
            </p>
            {state.lastSeenAt && (
              <small>Visto por último: {new Date(state.lastSeenAt).toLocaleString("pt-BR")}</small>
            )}
            {state.publishedRevision && state.appliedRevision !== state.publishedRevision && (
              <p>Publicação enviada; aguardando confirmação do dispositivo conectado.</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
