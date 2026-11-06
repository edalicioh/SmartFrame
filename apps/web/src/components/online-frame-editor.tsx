"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalWidgetEditor } from "./local-widget-editor";
import {
  defaultOnlineDashboard,
  onlineDashboardSchema,
  type OnlineDashboard,
  currencyCodes,
} from "@smartframe/contracts";

type Device = {
  id: string;
  name: string;
  lastSeenAt: string | null;
  appliedRevision: string | null;
  activePanelId: string | null;
  activePanelVersionId: string | null;
};
type Panel = { id: string; name: string };
type PanelAccess = { panelId: string; versionId: string };
type PanelState = Panel & { config: OnlineDashboard; draftRevision: number };
type Photo = {
  id: string;
  filename: string;
  status: string;
  width?: number | null;
  height?: number | null;
};
type Pairing = { code: string; expiresAt: string; serverURL: string };
type WidgetData = Awaited<ReturnType<typeof import("@smartframe/widgets").onlineWidgetData>>;

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
  const [panels, setPanels] = useState<Panel[]>([]);
  const [access, setAccess] = useState<PanelAccess[]>([]);
  const [accessDevice, setAccessDevice] = useState("");
  const [panelId, setPanelId] = useState("");
  const [state, setState] = useState<PanelState | null>(null);
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
  const [widgetData, setWidgetData] = useState<WidgetData | null>(null);
  const [currencyBase, setCurrencyBase] = useState("USD");
  const [currencyTarget, setCurrencyTarget] = useState("BRL");
  const frame = useRef<HTMLIFrameElement>(null);
  const operation = useRef(false);
  const selectedId = useRef(panelId);
  const selectedDevice = devices.find((device) => device.id === deviceId);
  const activePanel = panels.find((panel) => panel.id === selectedDevice?.activePanelId);
  const publishedRevision = selectedDevice?.activePanelVersionId
    ? `online:${selectedDevice.activePanelVersionId}`
    : null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const readyPhotos = useMemo(() => photos.filter((photo) => photo.status === "ready"), [photos]);
  const hasPendingPhotos = photos.some(pendingPhoto);
  const previewConfig = useMemo(() => {
    const byId = new Map(readyPhotos.map((photo) => [photo.id, photo]));
    return {
      ...config,
      widgetData,
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
  }, [config, readyPhotos, widgetData]);

  // The preview iframe never polls or receives device credentials. Its parent uses
  // the authenticated, shared server cache, including for unsaved pair selections.
  const widgetSettings = JSON.stringify({
    weather: { enabled: config.widgets.weather.enabled, city: config.widgets.weather.city },
    currencies: {
      enabled: config.widgets.currencies.enabled,
      pairs: config.widgets.currencies.pairs,
    },
  });
  useEffect(() => {
    if (!panelId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    async function load() {
      let delay = 60000;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const response = await fetch("/api/online-frame/widgets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ widgets: JSON.parse(widgetSettings) }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) {
          const data: WidgetData = await response.json();
          if (data.currenciesPending) delay = 2000;
          if (active) setWidgetData(data);
        }
      } catch {
        // Preserve the last quote; the player marks it as old by its timestamp.
      } finally {
        clearTimeout(timeout);
        if (active) timer = setTimeout(load, delay);
      }
    }
    timer = setTimeout(load, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [panelId, widgetSettings]);

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
  const refreshPanels = useCallback(async () => {
    const result = await api("/api/panels");
    setPanels(result.panels ?? []);
  }, []);
  const refreshPhotos = useCallback(async () => {
    const result = await api("/api/photos");
    setPhotos(result.photos ?? []);
    return (result.photos ?? []) as Photo[];
  }, []);

  const refreshAccess = useCallback(async (id: string) => {
    const result = await api(`/api/devices/panels?deviceId=${encodeURIComponent(id)}`);
    return result.access as PanelAccess[];
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    let active = true;
    refreshAccess(deviceId)
      .then((items) => {
        if (active) {
          setAccess(items);
          setAccessDevice(deviceId);
        }
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [deviceId, refreshAccess]);

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
    api("/api/panels")
      .then((result) => {
        if (active) setPanels(result.panels ?? []);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!panelId) return;
    let active = true;
    // Loading and clearing old device data must happen before its response can render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setState(null);
    setError("");
    api(`/api/panels?id=${encodeURIComponent(panelId)}`)
      .then((next: PanelState) => {
        if (!active || selectedId.current !== panelId) return;
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
  }, [panelId]);

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
    if (!panelId || !state) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (!active || operation.current) return;
      try {
        const latest: PanelState = await api(`/api/panels?id=${encodeURIComponent(panelId)}`);
        await refreshDevices();
        if (!active || selectedId.current !== panelId) return;
        setState((current) =>
          current && current.id === panelId
            ? {
                ...current,
                name: latest.name,
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
  }, [panelId, state?.id, dirty, refreshDevices]);

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
    setDeviceId(nextId);
  }
  function choosePanel(nextId: string) {
    if (operation.current || loading) return;
    if (dirty && !window.confirm("Há alterações não salvas. Descartar para trocar de painel?"))
      return;
    selectedId.current = nextId;
    setPanelId(nextId);
    setState(null);
    setDirty(false);
  }

  async function managePanel(action: "create" | "duplicate" | "rename" | "delete") {
    if (operation.current || loading) return;
    if (
      (action === "create" || action === "duplicate" || action === "delete") &&
      dirty &&
      !window.confirm(
        action === "duplicate"
          ? "Há alterações não salvas. Descartá-las e duplicar a última versão salva?"
          : "Há alterações não salvas. Descartá-las?",
      )
    )
      return;
    if (action !== "create" && !state) return;
    let name = "";
    if (action !== "delete") {
      const input = window.prompt(
        "Nome do painel:",
        action === "rename" ? state!.name : action === "duplicate" ? `${state!.name} (cópia)` : "",
      );
      if (input === null) return;
      name = input.trim();
      if (!name || name.length > 80) {
        setError("Informe um nome com até 80 caracteres.");
        return;
      }
    } else if (!window.confirm(`Excluir o painel ${state!.name}?`)) return;
    operation.current = true;
    setBusy("Atualizando painéis…");
    setError("");
    try {
      const method = action === "rename" ? "PATCH" : action === "delete" ? "DELETE" : "POST";
      const body =
        action === "rename"
          ? { id: state!.id, name }
          : action === "delete"
            ? { id: state!.id }
            : { name, ...(action === "duplicate" ? { copyFromId: state!.id } : {}) };
      const result = await api("/api/panels", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await refreshPanels();
      if (action === "rename") setState((current) => (current ? { ...current, name } : current));
      else {
        const nextId = action === "delete" ? "" : result.id;
        selectedId.current = nextId;
        setPanelId(nextId);
        setState(null);
        setDirty(false);
      }
      setNotice(
        action === "delete"
          ? "Painel excluído."
          : action === "rename"
            ? "Painel renomeado."
            : "Painel criado.",
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao atualizar painel.");
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  async function save(publish: boolean, activate = true) {
    if (!state || !panelId || (publish && !deviceId) || operation.current) return;
    const parsed = onlineDashboardSchema.safeParse(config);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        `Confira as configurações antes de salvar: ${issue.path.join(" → ")} — ${issue.message}.`,
      );
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
        const result = await api("/api/panels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: panelId, config: savedConfig, expectedRevision: revision }),
        });
        revision = result.draftRevision;
        setState((current) =>
          current?.id === panelId
            ? { ...current, draftRevision: revision, config: savedConfig }
            : current,
        );
        setDirty(false);
      }
      if (publish) {
        await api("/api/panels/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ panelId, deviceId, expectedRevision: revision, activate }),
        });
        await refreshDevices();
        setAccess(await refreshAccess(deviceId));
        setAccessDevice(deviceId);
      }
      setState((current) =>
        current?.id === panelId
          ? { ...current, config: savedConfig, draftRevision: revision }
          : current,
      );
      setDirty(false);
      setNotice(
        publish
          ? activate
            ? "Publicado. Aguardando confirmação de aplicação pelo dispositivo."
            : "Publicação disponibilizada para este dispositivo, sem alterar o painel exibido."
          : "Rascunho salvo; o dispositivo não foi alterado.",
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao salvar.");
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  async function removeAccess(id: string) {
    if (operation.current || !deviceId) return;
    operation.current = true;
    setBusy("Atualizando permissões…");
    setError("");
    try {
      await api("/api/devices/panels", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, panelId: id }),
      });
      setAccess(await refreshAccess(deviceId));
      setNotice("Painel removido das opções deste dispositivo.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao atualizar permissões.");
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
        setDeviceId("");
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
          <h1>Meus painéis</h1>
          <p>Crie seus painéis e escolha qual exibir em cada dispositivo.</p>
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
      <div className="online-panel-actions">
        <label>
          Painel em edição
          <select
            disabled={!!busy || loading}
            value={panelId}
            onChange={(event) => choosePanel(event.target.value)}
          >
            <option value="">Selecione um painel</option>
            {panels.map((panel) => (
              <option key={panel.id} value={panel.id}>
                {panel.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!!busy || loading} onClick={() => void managePanel("create")}>
          Criar painel
        </button>
        <button
          disabled={!!busy || loading || !state}
          onClick={() => void managePanel("duplicate")}
        >
          Duplicar
        </button>
        <button disabled={!!busy || loading || !state} onClick={() => void managePanel("rename")}>
          Renomear
        </button>
        <button
          className="online-danger"
          disabled={!!busy || loading || !state}
          onClick={() => void managePanel("delete")}
        >
          Excluir
        </button>
      </div>
      {selectedDevice && (
        <p className="online-device-status">
          Dispositivo: <strong>{selectedDevice.name}</strong> · Painel enviado:{" "}
          <strong>{activePanel?.name ?? "Nenhum"}</strong>
        </p>
      )}
      {selectedDevice && (
        <section className="online-callout" aria-label="Painéis disponíveis no dispositivo">
          <h2>Painéis disponíveis neste dispositivo</h2>
          <p>
            Somente publicações disponibilizadas aqui podem ser escolhidas no tablet. Rascunhos não
            ficam acessíveis.
          </p>
          {accessDevice !== deviceId ? (
            <p>Carregando permissões…</p>
          ) : (
            <ul>
              {panels.map((panel) => {
                const allowed = access.some((item) => item.panelId === panel.id);
                return (
                  <li key={panel.id}>
                    {panel.name} — {allowed ? "disponível" : "não disponível"}
                    {selectedDevice.activePanelId === panel.id
                      ? " (painel enviado)"
                      : allowed && (
                          <button disabled={!!busy} onClick={() => void removeAccess(panel.id)}>
                            Remover acesso
                          </button>
                        )}
                  </li>
                );
              })}
            </ul>
          )}
          <p>
            Selecione um painel em edição e disponibilize a versão atual sem trocar a tela do
            tablet.
          </p>
          <button
            disabled={!!busy || loading || !state || accessDevice !== deviceId}
            onClick={() => void save(true, false)}
          >
            Disponibilizar painel em edição
          </button>
        </section>
      )}
      {!devices.length && (
        <div className="online-callout">
          Nenhum dispositivo vinculado. Você já pode criar painéis; vincule um dispositivo para
          exibi-los.
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
      {!panelId ? (
        <p className="online-empty">Crie ou selecione um painel para editar.</p>
      ) : loading ? (
        <p className="online-empty">Carregando painel…</p>
      ) : !state ? (
        <p className="online-error">
          O painel não pôde ser carregado. Verifique a conexão e selecione novamente para tentar.
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
                Tamanho dos números do relógio
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
              <label>
                Cor dos números do relógio
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
              <fieldset>
                <legend>Pares de moedas ({config.widgets.currencies.pairs.length}/20)</legend>
                <label>
                  Moeda de origem
                  <select
                    value={currencyBase}
                    onChange={(event) => {
                      setCurrencyBase(event.target.value);
                      if (event.target.value === currencyTarget) setCurrencyTarget(currencyBase);
                    }}
                  >
                    {currencyCodes.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Moeda de destino
                  <select
                    value={currencyTarget}
                    onChange={(event) => setCurrencyTarget(event.target.value)}
                  >
                    {currencyCodes
                      .filter((code) => code !== currencyBase)
                      .map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={
                    currencyBase === currencyTarget ||
                    config.widgets.currencies.pairs.length >= 20 ||
                    config.widgets.currencies.pairs.includes(`${currencyBase}/${currencyTarget}`)
                  }
                  onClick={() =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        currencies: {
                          ...config.widgets.currencies,
                          pairs: [
                            ...config.widgets.currencies.pairs,
                            `${currencyBase}/${currencyTarget}`,
                          ],
                        },
                      },
                    })
                  }
                >
                  Adicionar par
                </button>
                <ul className="currency-pairs">
                  {config.widgets.currencies.pairs.map((pair) => (
                    <li key={pair}>
                      <span>{pair}</span>
                      <button
                        type="button"
                        aria-label={`Remover ${pair}`}
                        disabled={config.widgets.currencies.pairs.length === 1}
                        onClick={() =>
                          change({
                            ...config,
                            widgets: {
                              ...config.widgets,
                              currencies: {
                                ...config.widgets.currencies,
                                pairs: config.widgets.currencies.pairs.filter(
                                  (value) => value !== pair,
                                ),
                              },
                            },
                          })
                        }
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
                <small>
                  Selecione de 1 a 20 pares. Cotações indicativas da Coinbase, consultadas a cada 30
                  minutos; não são preços de execução.
                </small>
              </fieldset>
              <label>
                Cotações por vez
                <select
                  value={config.widgets.currencies.displayCount}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        currencies: {
                          ...config.widgets.currencies,
                          displayCount: Number(event.target.value),
                        },
                      },
                    })
                  }
                >
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
                <small>
                  Em telas pequenas, a quantidade se adapta ao espaço e os demais pares alternam.
                </small>
              </label>
              <label>
                Alternar pares a cada (segundos)
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
              <legend>Widgets adicionais</legend>
              <LocalWidgetEditor
                widgets={config.widgets}
                onChange={(widgets) => change({ ...config, widgets })}
              />
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
              <fieldset>
                <legend>Fundo e tamanho dos widgets</legend>
                <small>
                  O tamanho controla o espaço vertical relativo de cada cartão. A largura das fotos
                  é ajustada separadamente abaixo. O texto acompanha a cor do fundo, exceto se os
                  números do relógio tiverem uma cor personalizada.
                </small>
                {(
                  [
                    ["clock", "Relógio", config.theme === "dark" ? "#0b1d30" : "#102a43"],
                    ["weather", "Clima", config.appearance.accentColor],
                    ["currencies", "Cotações", "#222326"],
                    ["calendar", "Calendário", config.theme === "dark" ? "#1d3045" : "#ffffff"],
                    ["photos", "Fotos", "#26384b"],
                  ] as const
                ).map(([key, label, fallback]) => {
                  const background = config.widgets[key].backgroundColor || fallback;
                  const colorValue =
                    background.length === 4
                      ? `#${background
                          .slice(1)
                          .split("")
                          .map((character) => character + character)
                          .join("")}`
                      : background;
                  return (
                    <fieldset key={key}>
                      <legend>{label}</legend>
                      <label>
                        Cor de fundo
                        <input
                          type="color"
                          value={colorValue}
                          onChange={(event) =>
                            change({
                              ...config,
                              widgets: {
                                ...config.widgets,
                                [key]: {
                                  ...config.widgets[key],
                                  backgroundColor: event.target.value,
                                },
                              },
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!config.widgets[key].backgroundColor}
                        onClick={() =>
                          change({
                            ...config,
                            widgets: {
                              ...config.widgets,
                              [key]: { ...config.widgets[key], backgroundColor: "" },
                            },
                          })
                        }
                      >
                        Usar fundo padrão
                      </button>
                      {key !== "photos" && (
                        <label>
                          Tamanho do cartão
                          <select
                            value={config.widgets[key].cardSize}
                            onChange={(event) =>
                              change({
                                ...config,
                                widgets: {
                                  ...config.widgets,
                                  [key]: {
                                    ...config.widgets[key],
                                    cardSize: event.target.value as "small" | "normal" | "large",
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
                      )}
                    </fieldset>
                  );
                })}
              </fieldset>
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
                Salvar painel
              </button>
              <button
                disabled={
                  controlsDisabled ||
                  !deviceId ||
                  !selectedPhotoIds.every((id) => readyPhotos.some((photo) => photo.id === id))
                }
                onClick={() => void save(true)}
              >
                Exibir neste dispositivo
              </button>
              {dirty && <small>Alterações não salvas</small>}
            </div>
          </section>
          <section className="online-preview">
            <header>
              <strong>Prévia ao vivo</strong>
              <span>{state.name}</span>
            </header>
            <iframe
              ref={frame}
              onLoad={sendPreview}
              src="/player-dashboard/index.html?preview=1"
              title="Prévia do painel"
            />
            <p>
              Rascunho r{state.draftRevision} · Enviado ao dispositivo {publishedRevision ?? "—"} ·
              Aplicado {selectedDevice?.appliedRevision ?? "—"}
            </p>
            {selectedDevice?.lastSeenAt && (
              <small>
                Visto por último: {new Date(selectedDevice.lastSeenAt).toLocaleString("pt-BR")}
              </small>
            )}
            {publishedRevision && selectedDevice?.appliedRevision !== publishedRevision && (
              <p>Publicação enviada; aguardando confirmação do dispositivo conectado.</p>
            )}
            {publishedRevision && selectedDevice?.appliedRevision === publishedRevision && (
              <p>O dispositivo confirmou a versão enviada.</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
