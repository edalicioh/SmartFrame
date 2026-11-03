"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ImagePlus,
  LoaderCircle,
  Monitor,
  Save,
  Send,
  Smartphone,
  Unplug,
} from "lucide-react";
import {
  defaultPhotoFrame,
  photoFrameSchema,
  type PhotoFrame,
  type WidgetData,
} from "@smartframe/contracts";

type Device = {
  id: string;
  name: string;
  lastSeenAt: Date | string | null;
  appliedRevision: string | null;
};
type EditorState = {
  checkedAt: number;
  config: PhotoFrame;
  draftRevision: number;
  publishedRevision: string | null;
  photo: { id: string; status: string; filename: string } | null;
  devices: Device[];
  widgetData: WidgetData;
};

type City = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
};

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir a operação.");
  return data;
}

export function FrameEditor({ initial }: { initial: EditorState }) {
  const [config, setConfig] = useState(initial.config);
  const [revision, setRevision] = useState(initial.draftRevision);
  const [published, setPublished] = useState(initial.publishedRevision);
  const [devices, setDevices] = useState(initial.devices);
  const [checkedAt, setCheckedAt] = useState(initial.checkedAt);
  const [photo, setPhoto] = useState(initial.photo);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [widgetData, setWidgetData] = useState(initial.widgetData);
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  const [searching, setSearching] = useState(false);
  const [pairing, setPairing] = useState<{
    code: string;
    expiresAt: string;
    serverURL: string;
  } | null>(null);
  const preview = useRef<HTMLIFrameElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);

  const showPreview = useCallback(() => {
    preview.current?.contentWindow?.postMessage(
      {
        type: "smartframe:preview",
        config,
        widgetData,
        photoUrl:
          config.background.photoId && photo?.status === "ready"
            ? `/api/photos/${config.background.photoId}/image`
            : null,
      },
      window.location.origin,
    );
  }, [config, photo, widgetData]);

  useEffect(showPreview, [showPreview]);
  useEffect(() => {
    const controller = new AbortController();
    const selected = { ...defaultPhotoFrame, timezone: config.timezone, widgets: config.widgets };
    if (
      !photoFrameSchema.safeParse(selected).success ||
      (!selected.widgets.weather.enabled && !selected.widgets.currencies.enabled)
    )
      return;
    const load = () => {
      api("/api/widgets/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: selected }),
        signal: controller.signal,
      })
        .then(setWidgetData)
        .catch(() => {});
    };
    const timeout = window.setTimeout(load, 600);
    const interval = window.setInterval(load, 60_000);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [config.widgets, config.timezone]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      api("/api/frame", { signal: controller.signal })
        .then((state) => {
          setDevices(state.devices);
          setCheckedAt(state.checkedAt);
        })
        .catch(() => {});
    }, 10_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
      uploadAbort.current?.abort();
    };
  }, []);

  function change(next: PhotoFrame) {
    setConfig(next);
    setDirty(true);
    setNotice("");
  }
  function background(next: Partial<PhotoFrame["background"]>) {
    change({ ...config, background: { ...config.background, ...next } });
  }
  function clock(next: Partial<PhotoFrame["clock"]>) {
    change({ ...config, clock: { ...config.clock, ...next } });
  }

  async function findCities() {
    if (cityQuery.trim().length < 3) {
      setError("Digite pelo menos três letras para buscar a cidade.");
      return;
    }
    setSearching(true);
    setError("");
    try {
      const result = await api(`/api/widgets/cities?q=${encodeURIComponent(cityQuery.trim())}`);
      setCities(result.cities);
      if (!result.cities.length)
        setError("Nenhuma cidade encontrada. Tente incluir estado ou país.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível buscar cidades.");
    } finally {
      setSearching(false);
    }
  }

  function selectCity(city: City) {
    const name = [city.name, city.admin1 !== city.name ? city.admin1 : "", city.country]
      .filter(Boolean)
      .join(", ")
      .slice(0, 100);
    setWidgetData((current) => ({ ...current, weather: null }));
    change({
      ...config,
      timezone: city.timezone ?? config.timezone,
      widgets: {
        ...config.widgets,
        weather: { enabled: true, city: name, latitude: city.latitude, longitude: city.longitude },
      },
    });
    setCities([]);
    setCityQuery("");
  }

  async function saveDraft() {
    if (!photoFrameSchema.safeParse(config).success)
      throw new Error("Confira o fuso horário e as configurações antes de salvar.");
    if (!dirty && revision > 0) return revision;
    const result = await api("/api/frame", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, expectedRevision: revision }),
    });
    setRevision(result.draftRevision);
    setDirty(false);
    return result.draftRevision as number;
  }

  async function save(publish: boolean) {
    setBusy(publish ? "Publicando…" : "Salvando…");
    setError("");
    setNotice("");
    try {
      const saved = await saveDraft();
      if (publish) {
        const result = await api("/api/frame/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: saved }),
        });
        setPublished(result.revision);
        setNotice(
          "Publicado. Os tablets conectados buscarão a atualização em até 30 segundos, mais o tempo de download.",
        );
      } else setNotice("Rascunho salvo. O tablet não foi alterado.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Confira as configurações.");
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File) {
    if (file.size > 12 * 1024 ** 2) {
      setError("Escolha uma imagem de até 12 MB.");
      return;
    }
    const controller = new AbortController();
    uploadAbort.current?.abort();
    uploadAbort.current = controller;
    setBusy("Enviando foto…");
    setError("");
    setNotice("");
    try {
      const data = new FormData();
      data.set("photo", file);
      const uploaded = await api("/api/photos", {
        method: "POST",
        body: data,
        signal: controller.signal,
      });
      setBusy("Otimizando foto no servidor…");
      let ready = false;
      for (let attempt = 0; attempt < 90; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const current = await api(`/api/photos/${uploaded.id}`, { signal: controller.signal });
        if (current.status === "error")
          throw new Error(
            "Não foi possível processar a foto. Use JPEG, PNG ou WebP estático, com até 24 megapixels.",
          );
        if (current.status === "ready") {
          setPhoto(current);
          setConfig((value) => ({
            ...value,
            background: { ...value.background, photoId: current.id },
          }));
          setDirty(true);
          ready = true;
          break;
        }
      }
      if (!ready)
        throw new Error(
          "O processamento ainda não terminou. Verifique se o worker está em execução e tente novamente.",
        );
      setNotice("Foto pronta para prévia. Publique para enviá-la ao tablet.");
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : "Falha ao enviar foto.");
    } finally {
      if (!controller.signal.aborted) setBusy("");
    }
  }

  async function createCode() {
    setBusy("Gerando código…");
    setError("");
    try {
      setPairing(await api("/api/devices/pairing-code", { method: "POST" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao gerar código.");
    } finally {
      setBusy("");
    }
  }

  async function revoke(device: Device) {
    if (
      !window.confirm(
        `Desvincular ${device.name}? Ele deixará de receber atualizações, mas poderá manter o último conteúdo offline.`,
      )
    )
      return;
    setBusy("Desvinculando…");
    setError("");
    try {
      await api(`/api/devices/${device.id}`, { method: "DELETE" });
      setDevices((current) => current.filter((entry) => entry.id !== device.id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao desvincular.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="frame-editor">
      <section className="editor-title">
        <div>
          <span className="eyebrow green">DO SEU JEITO, NA SUA TELA</span>
          <h1>Personalize seu porta-retratos.</h1>
          <p>Modo Foto · Uma prévia real do que será exibido no aplicativo.</p>
        </div>
        <span className="editor-state">
          {dirty ? "Alterações não salvas" : revision ? "Rascunho salvo" : "Novo layout"}
        </span>
      </section>
      <div className="editor-grid">
        <div className="editor-preview-column">
          <section className="preview-card">
            <div className="panel-heading">
              <h2>
                <Monitor size={17} /> Pré-visualização
              </h2>
              <span className="pill">
                {config.orientation === "landscape" ? "1024 × 600" : "600 × 1024"}
              </span>
            </div>
            <div
              className={`preview-screen orientation-${config.orientation}`}
              style={{
                aspectRatio: config.orientation === "landscape" ? "1024 / 600" : "600 / 1024",
              }}
            >
              <iframe
                ref={preview}
                src="/player/index.html"
                title="Prévia do layout do tablet"
                onLoad={showPreview}
              />
            </div>
            <p className="preview-foot">
              A prévia usa o mesmo renderizador do APK. Salvar rascunho não altera o tablet.
            </p>
          </section>
          <section className="editor-devices panel">
            <div className="panel-heading">
              <h2>
                <Smartphone size={17} /> Tablets desta conta
              </h2>
              <button className="button button-primary" onClick={createCode} disabled={!!busy}>
                Conectar tablet
              </button>
            </div>
            {pairing && (
              <div className="pairing-card">
                <strong>Código de conexão</strong>
                <code>{pairing.code}</code>
                <p>
                  Válido até{" "}
                  {new Date(pairing.expiresAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  . No APK, toque em <b>Conectar</b> ou no botão de ajustes e informe:
                </p>
                <label>
                  Endereço do servidor
                  <input
                    readOnly
                    value={pairing.serverURL}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <p>
                  No teste por USB, mantenha o encaminhamento ADB para essa porta. HTTP só é
                  permitido para localhost no APK de debug; use HTTPS para acesso remoto.
                </p>
              </div>
            )}
            {!devices.length && (
              <p className="editor-empty">
                Nenhum tablet vinculado. Gere um código e conecte o aplicativo para receber este
                layout.
              </p>
            )}
            {devices.map((device) => {
              const online =
                device.lastSeenAt && checkedAt - new Date(device.lastSeenAt).getTime() < 90_000;
              return (
                <div className="editor-device" key={device.id}>
                  <span className={`device-dot ${online ? "online" : ""}`} />
                  <div>
                    <strong>{device.name}</strong>
                    <span>
                      {online ? "Contato recente" : "Sem contato recente"} ·{" "}
                      {published && device.appliedRevision === published
                        ? "Publicação aplicada"
                        : "Aguardando publicação/sincronização"}
                    </span>
                  </div>
                  <button
                    title={`Desvincular ${device.name}`}
                    aria-label={`Desvincular ${device.name}`}
                    onClick={() => revoke(device)}
                    disabled={!!busy}
                  >
                    <Unplug size={17} />
                  </button>
                </div>
              );
            })}
          </section>
        </div>
        <section className="editor-controls panel">
          <fieldset disabled={!!busy}>
            <div className="control-section">
              <h2>Foto e fundo</h2>
              <label className="photo-upload">
                <ImagePlus size={21} />
                <span>
                  {config.background.photoId && photo ? photo.filename : "Escolher foto de fundo"}
                  <small>JPEG, PNG ou WebP · até 12 MB</small>
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                  }}
                />
              </label>
              {config.background.photoId && (
                <button className="text-button" onClick={() => background({ photoId: null })}>
                  Remover foto do layout
                </button>
              )}
              <div className="control-row">
                <label>
                  Cor de fundo
                  <input
                    aria-label="Cor de fundo"
                    type="color"
                    value={config.background.color}
                    onChange={(event) => background({ color: event.target.value })}
                  />
                </label>
                <label>
                  Enquadramento
                  <select
                    value={config.background.fit}
                    onChange={(event) =>
                      background({ fit: event.target.value as "cover" | "contain" })
                    }
                  >
                    <option value="cover">Preencher tela</option>
                    <option value="contain">Mostrar foto inteira</option>
                  </select>
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={config.background.gradient}
                  onChange={(event) => background({ gradient: event.target.checked })}
                />{" "}
                Fundo em degradê
              </label>
              <label>
                Escurecer a foto <span>{Math.round(config.background.shade * 100)}%</span>
                <input
                  type="range"
                  min="0"
                  max="85"
                  step="5"
                  value={Math.round(config.background.shade * 100)}
                  onChange={(event) => background({ shade: Number(event.target.value) / 100 })}
                />
              </label>
            </div>
            <div className="control-section">
              <h2>Relógio e informações</h2>
              <div className="control-row">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={config.clock.enabled}
                    onChange={(event) => clock({ enabled: event.target.checked })}
                  />{" "}
                  Mostrar relógio
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={config.clock.showDate}
                    onChange={(event) => clock({ showDate: event.target.checked })}
                  />{" "}
                  Mostrar data
                </label>
              </div>
              <div className="control-row">
                <label>
                  Formato
                  <select
                    value={config.clock.hourFormat}
                    onChange={(event) => clock({ hourFormat: event.target.value as "12" | "24" })}
                  >
                    <option value="24">24 horas</option>
                    <option value="12">12 horas</option>
                  </select>
                </label>
                <label>
                  Cor do texto
                  <input
                    aria-label="Cor do texto"
                    type="color"
                    value={config.clock.color}
                    onChange={(event) => clock({ color: event.target.value })}
                  />
                </label>
              </div>
              <label>
                Posição das informações
                <select
                  value={config.clock.position}
                  onChange={(event) =>
                    clock({ position: event.target.value as PhotoFrame["clock"]["position"] })
                  }
                >
                  <option value="bottom-left">Inferior esquerda</option>
                  <option value="bottom-right">Inferior direita</option>
                  <option value="top-left">Superior esquerda</option>
                  <option value="top-right">Superior direita</option>
                  <option value="center">Centro</option>
                </select>
              </label>
              <label>
                Tamanho do relógio <span>{config.clock.fontSize}px</span>
                <input
                  type="range"
                  min="32"
                  max="128"
                  step="4"
                  value={config.clock.fontSize}
                  onChange={(event) => clock({ fontSize: Number(event.target.value) })}
                />
              </label>
              <label>
                Fonte
                <select
                  value={config.clock.font}
                  onChange={(event) => clock({ font: event.target.value as "system" | "serif" })}
                >
                  <option value="system">Moderna</option>
                  <option value="serif">Clássica</option>
                </select>
              </label>
              <label>
                Mensagem opcional
                <textarea
                  rows={2}
                  maxLength={120}
                  value={config.caption}
                  placeholder="Uma lembrança, uma frase…"
                  onChange={(event) => change({ ...config, caption: event.target.value })}
                />
              </label>
            </div>
            <div className="control-section">
              <h2>Temperatura e moedas</h2>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={config.widgets.weather.enabled}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        weather: { ...config.widgets.weather, enabled: event.target.checked },
                      },
                    })
                  }
                />{" "}
                Mostrar temperatura
              </label>
              {config.widgets.weather.enabled && (
                <div className="weather-settings">
                  <p className="widget-city">
                    Cidade: <strong>{config.widgets.weather.city}</strong>
                  </p>
                  <label>
                    Buscar outra cidade
                    <div className="city-search">
                      <input
                        value={cityQuery}
                        maxLength={80}
                        placeholder="Ex.: São Paulo"
                        onChange={(event) => setCityQuery(event.target.value)}
                      />
                      <button
                        className="button button-outline"
                        type="button"
                        disabled={searching}
                        onClick={findCities}
                      >
                        {searching ? "Buscando…" : "Buscar"}
                      </button>
                    </div>
                  </label>
                  {!!cities.length && (
                    <ul className="city-results">
                      {cities.map((city) => (
                        <li key={city.id}>
                          <button type="button" onClick={() => selectCity(city)}>
                            {[city.name, city.admin1, city.country].filter(Boolean).join(" · ")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={config.widgets.currencies.enabled}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: { ...config.widgets, currencies: { enabled: event.target.checked } },
                    })
                  }
                />{" "}
                Mostrar moedas: USD/BRL, EUR/BRL e BTC/USD
              </label>
              <label>
                Posição dos cartões
                <select
                  value={config.widgets.position}
                  onChange={(event) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        position: event.target.value as PhotoFrame["widgets"]["position"],
                      },
                    })
                  }
                >
                  <option value="top-left">Superior esquerda</option>
                  <option value="top-right">Superior direita</option>
                  <option value="bottom-left">Inferior esquerda</option>
                  <option value="bottom-right">Inferior direita</option>
                </select>
              </label>
              <p className="widget-disclaimer">
                Cartões no estilo da referência. Escolha um canto diferente do relógio para evitar
                sobreposição. Dados ficam em cache; cotações são indicativas e não são em tempo
                real.
              </p>
            </div>
            <div className="control-section">
              <h2>Tela e horário</h2>
              <label>
                Orientação
                <select
                  value={config.orientation}
                  onChange={(event) =>
                    change({
                      ...config,
                      orientation: event.target.value as "landscape" | "portrait",
                    })
                  }
                >
                  <option value="landscape">Horizontal</option>
                  <option value="portrait">Vertical</option>
                </select>
              </label>
              <label>
                Fuso horário
                <input
                  value={config.timezone}
                  placeholder="America/Sao_Paulo"
                  onChange={(event) => change({ ...config, timezone: event.target.value })}
                />
              </label>
            </div>
          </fieldset>
          <div className="editor-actions">
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="editor-notice">
                <Check size={16} />
                {notice}
              </p>
            )}
            {busy && (
              <p className="editor-progress" role="status">
                <LoaderCircle className="spin" size={16} />
                {busy}
              </p>
            )}
            <button className="button button-outline" disabled={!!busy} onClick={() => save(false)}>
              <Save size={16} /> Salvar rascunho
            </button>
            <button className="button button-primary" disabled={!!busy} onClick={() => save(true)}>
              <Send size={16} /> Publicar no tablet
            </button>
            <small>
              A publicação vale para os tablets vinculados a esta conta. O status acima confirma
              quando foi aplicada.
            </small>
          </div>
        </section>
      </div>
    </main>
  );
}
