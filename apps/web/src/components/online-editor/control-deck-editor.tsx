"use client";

import { useCallback, useEffect, useState } from "react";
import {
  controlDeckActionsByKind,
  controlDeckBindingCreateSchema,
  controlDeckBindingUpdateSchema,
  controlDeckIcons,
  controlDeckKinds,
  isControlDeckActionIdempotent,
  type ControlDeckHostStatus,
  type ControlDeckIcon,
  type ControlDeckKind,
  type ControlDeckTile,
  type OnlineDashboard,
} from "@smartframe/contracts";

type AgentStatusPayload = {
  configured: boolean;
  reachable: boolean;
  status: ControlDeckHostStatus;
};

type BindingItem = {
  id: string;
  label: string;
  kind: ControlDeckKind;
  action: string;
  target: Record<string, unknown>;
  idempotent: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

const KIND_LABELS: Record<ControlDeckKind, string> = {
  shortcut: "Atalho local (allowlist)",
  media: "Mídia",
  volume: "Volume geral",
  app_volume: "Volume por aplicativo",
  brightness: "Brilho da tela",
  mic_ptt: "Microfone / Push-to-Talk",
};

const ACTION_LABELS: Record<string, string> = {
  launch: "Executar atalho",
  play_pause: "Reproduzir / Pausar",
  next: "Próxima faixa",
  previous: "Faixa anterior",
  stop: "Parar mídia",
  mute_toggle: "Alternar mudo",
  set_mute: "Definir mudo",
  step_up: "Aumentar passo",
  step_down: "Diminuir passo",
  set_level: "Definir nível (0–100%)",
  hold_unmute: "Segurar para falar (lease PTT)",
  toggle_mute: "Alternar mudo do microfone",
};

const ICON_LABELS: Record<ControlDeckIcon, string> = {
  bolt: "Raio (atalho)",
  play: "Reproduzir",
  next: "Avançar",
  prev: "Voltar",
  stop: "Parar",
  volume: "Volume",
  mute: "Mudo",
  app: "Aplicativo",
  mic: "Microfone",
  sun: "Brilho",
  terminal: "Terminal",
};

function defaultIconForKind(kind: ControlDeckKind, action: string): ControlDeckIcon {
  if (action === "mute_toggle" || action === "set_mute" || action === "toggle_mute") return "mute";
  switch (kind) {
    case "shortcut":
      return "bolt";
    case "media":
      return action === "next"
        ? "next"
        : action === "previous"
          ? "prev"
          : action === "stop"
            ? "stop"
            : "play";
    case "volume":
      return "volume";
    case "app_volume":
      return "app";
    case "brightness":
      return "sun";
    case "mic_ptt":
      return "mic";
  }
}

function newTileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `tile-${crypto.randomUUID().slice(0, 12)}`;
  }
  return `tile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeTarget(binding: BindingItem): string {
  const t = binding.target;
  switch (binding.kind) {
    case "shortcut":
      return typeof t.shortcutId === "string" && t.shortcutId ? `shortcut: ${t.shortcutId}` : "";
    case "app_volume":
      return typeof t.appName === "string" && t.appName ? `app: ${t.appName}` : "";
    case "volume":
    case "brightness":
      return typeof t.step === "number" ? `passo: ${t.step}%` : "";
    case "mic_ptt":
      return typeof t.leaseSeconds === "number" ? `lease: ${t.leaseSeconds}s` : "";
    default:
      return "host local";
  }
}

export function ControlDeckEditor({
  config,
  enabled,
  toggleDisabled = false,
  onEnabledChange,
  onChange,
  onBindingsChanged,
  controlsDisabled,
  onNotice,
  onError,
}: {
  config: OnlineDashboard;
  enabled?: boolean;
  toggleDisabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onChange: (next: OnlineDashboard) => void;
  onBindingsChanged?: () => void;
  controlsDisabled: boolean;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [agentStatus, setAgentStatus] = useState<AgentStatusPayload | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [bindings, setBindings] = useState<BindingItem[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(true);
  const [busyBinding, setBusyBinding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("Volume principal");
  const [kind, setKind] = useState<ControlDeckKind>("volume");
  const [action, setAction] = useState<string>(controlDeckActionsByKind.volume[0]);
  const [bindingEnabled, setBindingEnabled] = useState(true);
  const [shortcutId, setShortcutId] = useState("");
  const [manualShortcut, setManualShortcut] = useState(false);
  const [appName, setAppName] = useState("");
  const [step, setStep] = useState(5);
  const [leaseSeconds, setLeaseSeconds] = useState(10);

  const deck = config.widgets.controlDeck;
  const widgetEnabled = enabled ?? deck.enabled;

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/control-deck/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Falha ao consultar agente do Control Deck.");
    return data as AgentStatusPayload;
  }, []);

  const loadBindings = useCallback(async () => {
    const response = await fetch("/api/control-deck/bindings", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Falha ao carregar vínculos do Control Deck.");
    return (data.bindings ?? []) as BindingItem[];
  }, []);

  useEffect(() => {
    let active = true;
    loadStatus()
      .then((loaded) => {
        if (active) setAgentStatus(loaded);
      })
      .catch((failure: unknown) => {
        if (active) {
          onError(
            failure instanceof Error
              ? failure.message
              : "Falha ao consultar status do Control Deck.",
          );
        }
      })
      .finally(() => {
        if (active) setStatusLoading(false);
      });

    loadBindings()
      .then((loaded) => {
        if (active) setBindings(loaded);
      })
      .catch((failure: unknown) => {
        if (active) {
          onError(
            failure instanceof Error
              ? failure.message
              : "Falha ao carregar vínculos do Control Deck.",
          );
        }
      })
      .finally(() => {
        if (active) setBindingsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadBindings, loadStatus, onError]);

  async function handleRefreshStatus() {
    setStatusLoading(true);
    onError("");
    try {
      setAgentStatus(await loadStatus());
    } catch (failure) {
      onError(
        failure instanceof Error ? failure.message : "Falha ao atualizar status do agente.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  function resetForm() {
    setEditingId(null);
    setLabel("Volume principal");
    setKind("volume");
    setAction(controlDeckActionsByKind.volume[0]);
    setBindingEnabled(true);
    setShortcutId("");
    setManualShortcut(false);
    setAppName("");
    setStep(5);
    setLeaseSeconds(10);
  }

  function handleKindChange(nextKind: ControlDeckKind) {
    setKind(nextKind);
    setAction(controlDeckActionsByKind[nextKind][0]);
    if (nextKind === "volume") setStep(5);
    if (nextKind === "brightness") setStep(10);
    if (nextKind === "mic_ptt") setLeaseSeconds(10);
    if (nextKind === "shortcut") {
      const availableShortcuts = agentStatus?.reachable ? agentStatus.status.shortcuts : [];
      if (availableShortcuts.length > 0 && !shortcutId) {
        setShortcutId(availableShortcuts[0].shortcutId);
        setManualShortcut(false);
      }
    }
  }

  function startEditBinding(item: BindingItem) {
    setEditingId(item.id);
    setLabel(item.label);
    setKind(item.kind);
    setAction(item.action);
    setBindingEnabled(item.enabled);
    const t = item.target;
    const sc = typeof t.shortcutId === "string" ? t.shortcutId : "";
    setShortcutId(sc);
    const knownShortcuts = agentStatus?.reachable
      ? agentStatus.status.shortcuts.map((s) => s.shortcutId)
      : [];
    setManualShortcut(Boolean(sc && !knownShortcuts.includes(sc)));
    setAppName(typeof t.appName === "string" ? t.appName : "");
    setStep(typeof t.step === "number" ? t.step : item.kind === "brightness" ? 10 : 5);
    setLeaseSeconds(typeof t.leaseSeconds === "number" ? t.leaseSeconds : 10);
    onError("");
    onNotice("");
  }

  function buildBindingPayload(isUpdate: boolean) {
    const base = {
      ...(isUpdate && editingId ? { id: editingId } : {}),
      label: label.trim(),
      kind,
      action,
      enabled: bindingEnabled,
    };
    switch (kind) {
      case "shortcut":
        return { ...base, target: { shortcutId: shortcutId.trim() } };
      case "media":
        return { ...base, target: {} };
      case "volume":
      case "brightness":
        return { ...base, target: { step: Math.trunc(Number(step)) } };
      case "app_volume":
        return { ...base, target: { appName: appName.trim() } };
      case "mic_ptt":
        return { ...base, target: { leaseSeconds: Math.trunc(Number(leaseSeconds)) } };
    }
  }

  async function handleSaveBinding() {
    if (busyBinding) return;
    onError("");
    onNotice("");
    const isUpdate = Boolean(editingId);
    const rawPayload = buildBindingPayload(isUpdate);
    const validated = isUpdate
      ? controlDeckBindingUpdateSchema.safeParse(rawPayload)
      : controlDeckBindingCreateSchema.safeParse(rawPayload);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      onError(`Confira os dados do vínculo: ${issue.message}.`);
      return;
    }

    setBusyBinding(true);
    try {
      const response = await fetch("/api/control-deck/bindings", {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated.data),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Não foi possível salvar o vínculo.");
      }
      setBindings(await loadBindings());
      onBindingsChanged?.();
      onNotice(isUpdate ? "Vínculo do Control Deck atualizado." : "Vínculo do Control Deck criado.");
      resetForm();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Erro ao salvar vínculo.");
    } finally {
      setBusyBinding(false);
    }
  }

  async function handleDeleteBinding(item: BindingItem) {
    if (busyBinding || !window.confirm(`Excluir o vínculo "${item.label}"?`)) return;
    setBusyBinding(true);
    onError("");
    onNotice("");
    try {
      const response = await fetch("/api/control-deck/bindings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível excluir o vínculo.");
      if (editingId === item.id) resetForm();
      setBindings(await loadBindings());
      onBindingsChanged?.();
      onNotice("Vínculo do Control Deck excluído.");
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Erro ao excluir vínculo.");
    } finally {
      setBusyBinding(false);
    }
  }

  function updateDeck(patch: Partial<OnlineDashboard["widgets"]["controlDeck"]>) {
    onChange({
      ...config,
      widgets: {
        ...config.widgets,
        controlDeck: {
          ...deck,
          ...patch,
        },
      },
    });
  }

  function addTileFromBinding(binding: BindingItem) {
    if (deck.tiles.length >= 16) return;
    const tile: ControlDeckTile = {
      id: newTileId(),
      bindingId: binding.id,
      label: binding.label.slice(0, 40) || "Botão",
      icon: defaultIconForKind(binding.kind, binding.action),
    };
    updateDeck({ tiles: [...deck.tiles, tile] });
  }

  function addDefaultTile() {
    if (deck.tiles.length >= 16 || bindings.length === 0) return;
    const preferred = bindings.find((b) => b.enabled) ?? bindings[0];
    addTileFromBinding(preferred);
  }

  function updateTile(tileId: string, patch: Partial<ControlDeckTile>) {
    updateDeck({
      tiles: deck.tiles.map((tile) => (tile.id === tileId ? { ...tile, ...patch } : tile)),
    });
  }

  function moveTile(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= deck.tiles.length) return;
    const next = [...deck.tiles];
    [next[index], next[target]] = [next[target], next[index]];
    updateDeck({ tiles: next });
  }

  const formIdempotent = isControlDeckActionIdempotent(kind, action);
  const agentShortcuts = agentStatus?.reachable ? agentStatus.status.shortcuts : [];
  const bindingMap = new Map(bindings.map((item) => [item.id, item]));
  const isConnected = Boolean(agentStatus?.configured && agentStatus.reachable);

  const statusBadgeText = statusLoading
    ? "Verificando agente…"
    : isConnected
      ? agentStatus!.status.available
        ? `Conectado (${agentStatus!.status.platform})`
        : `Conectado · sem driver (${agentStatus!.status.platform})`
      : agentStatus?.configured
        ? "Indisponível"
        : "Indisponível / Não configurado";

  const capabilityChips = agentStatus
    ? ([
        ["Atalhos", agentStatus.status.capabilities.shortcuts, null],
        ["Mídia", agentStatus.status.capabilities.media, null],
        [
          "Volume",
          agentStatus.status.capabilities.volume,
          agentStatus.status.volume.available && agentStatus.status.volume.level !== null
            ? `${agentStatus.status.volume.level}%${agentStatus.status.volume.muted ? " (mudo)" : ""}`
            : null,
        ],
        ["Volume por app", agentStatus.status.capabilities.appVolume, null],
        [
          "Brilho",
          agentStatus.status.capabilities.brightness,
          agentStatus.status.brightness.available && agentStatus.status.brightness.level !== null
            ? `${agentStatus.status.brightness.level}%`
            : null,
        ],
        [
          "Microfone / PTT",
          agentStatus.status.capabilities.mic,
          agentStatus.status.mic.available
            ? agentStatus.status.mic.pttActive
              ? "PTT ativo"
              : agentStatus.status.mic.muted === true
                ? "Silenciado"
                : agentStatus.status.mic.muted === false
                  ? "Ativo"
                  : null
            : null,
        ],
      ] as const)
    : [];

  return (
    <div className="control-deck-editor">
      <fieldset>
        <legend>Agente local do Control Deck</legend>
        <div className="control-deck-status-card">
          <div className="control-deck-status-header">
            <div>
              <span
                className={`control-deck-badge ${
                  isConnected && agentStatus?.status.available ? "is-online" : "is-offline"
                }`}
              >
                {statusBadgeText}
              </span>
              {agentStatus?.reachable && (
                <small>
                  {" "}
                  · verificado em {new Date(agentStatus.status.checkedAt).toLocaleTimeString("pt-BR")}
                </small>
              )}
            </div>
            <button type="button" disabled={statusLoading} onClick={() => void handleRefreshStatus()}>
              {statusLoading ? "Verificando…" : "Atualizar status"}
            </button>
          </div>

          {!statusLoading && agentStatus && !agentStatus.configured && (
            <small>
              Configure <code>SMARTFRAME_CONTROL_DECK_URL</code> (somente loopback HTTP) e{" "}
              <code>SMARTFRAME_CONTROL_DECK_TOKEN</code> no servidor para conectar ao agente local.
            </small>
          )}

          {agentStatus && (
            <div className="control-deck-capabilities" aria-label="Capacidades reais do host">
              {capabilityChips.map(([capLabel, available, detail]) => (
                <span
                  key={capLabel}
                  className={`control-deck-cap-chip ${available ? "is-available" : "is-unavailable"}`}
                >
                  {capLabel}: {available ? (detail ?? "Disponível") : "Indisponível"}
                </span>
              ))}
            </div>
          )}

          {agentStatus?.reachable && agentShortcuts.length > 0 && (
            <small>
              Atalhos registrados no host: {agentShortcuts.map((s) => `${s.label} (${s.shortcutId})`).join(", ")}
            </small>
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend>Vínculos do host ({bindings.length}/50)</legend>
        <small>
          Os vínculos guardam a ação do host no servidor. O painel publicado referencia apenas o{" "}
          <code>bindingId</code> opaco, nunca caminhos físicos, argumentos ou tokens.
        </small>

        {bindingsLoading ? (
          <p className="online-empty">Carregando vínculos…</p>
        ) : bindings.length === 0 ? (
          <p className="online-empty">Nenhum vínculo cadastrado nesta residência.</p>
        ) : (
          <div className="control-deck-list">
            {bindings.map((item) => {
              const targetSummary = summarizeTarget(item);
              return (
                <div key={item.id} className="control-deck-item">
                  <div className="control-deck-item-meta">
                    <strong>
                      {item.label} {!item.enabled && "(desativado)"}
                    </strong>
                    <small>
                      {KIND_LABELS[item.kind]} · {ACTION_LABELS[item.action] ?? item.action}
                      {targetSummary ? ` · ${targetSummary}` : ""}
                    </small>
                    <span
                      className={`control-deck-badge ${
                        item.idempotent ? "is-idempotent" : "is-non-idempotent"
                      }`}
                    >
                      {item.idempotent ? "Idempotente" : "Não idempotente (sem reenvio cego)"}
                    </span>
                  </div>
                  <div className="control-deck-item-actions">
                    <button
                      type="button"
                      aria-label={`Adicionar botão para ${item.label}`}
                      disabled={controlsDisabled || deck.tiles.length >= 16}
                      onClick={() => addTileFromBinding(item)}
                    >
                      + Botão
                    </button>
                    <button
                      type="button"
                      aria-label={`Editar vínculo ${item.label}`}
                      disabled={busyBinding}
                      onClick={() => startEditBinding(item)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="online-danger"
                      aria-label={`Excluir vínculo ${item.label}`}
                      disabled={busyBinding}
                      onClick={() => void handleDeleteBinding(item)}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="control-deck-form">
          <strong>{editingId ? "Editar vínculo" : "Novo vínculo"}</strong>
          <div className="control-deck-fields">
            <label>
              Nome do vínculo
              <input
                type="text"
                maxLength={60}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ex: Abrir Terminal / Volume PC"
              />
            </label>
            <label>
              Categoria
              <select
                value={kind}
                onChange={(e) => handleKindChange(e.target.value as ControlDeckKind)}
              >
                {controlDeckKinds.map((entry) => (
                  <option key={entry} value={entry}>
                    {KIND_LABELS[entry]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ação
              <select value={action} onChange={(e) => setAction(e.target.value)}>
                {controlDeckActionsByKind[kind].map((act) => (
                  <option key={act} value={act}>
                    {ACTION_LABELS[act] ?? act}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="control-deck-idempotency-hint">
            Política de rede:{" "}
            <span
              className={`control-deck-badge ${
                formIdempotent ? "is-idempotent" : "is-non-idempotent"
              }`}
            >
              {formIdempotent ? "Idempotente" : "Não idempotente (sem reenvio cego)"}
            </span>
          </p>

          {kind === "shortcut" && (
            <div className="control-deck-fields">
              {agentShortcuts.length > 0 && !manualShortcut ? (
                <label>
                  Atalho (ID opaco do agente)
                  <select
                    value={shortcutId}
                    onChange={(e) => {
                      if (e.target.value === "__manual__") {
                        setManualShortcut(true);
                        return;
                      }
                      setShortcutId(e.target.value);
                    }}
                  >
                    <option value="">Selecione um atalho</option>
                    {agentShortcuts.map((sc) => (
                      <option key={sc.shortcutId} value={sc.shortcutId}>
                        {sc.label} ({sc.shortcutId}){sc.available ? "" : " · ausente no host"}
                      </option>
                    ))}
                    <option value="__manual__">Informar ID opaco manualmente…</option>
                  </select>
                </label>
              ) : (
                <label>
                  shortcutId opaco (cadastrado no agente)
                  <input
                    type="text"
                    maxLength={64}
                    value={shortcutId}
                    onChange={(e) => setShortcutId(e.target.value)}
                    placeholder="ex: terminal"
                  />
                </label>
              )}
              {agentShortcuts.length > 0 && manualShortcut && (
                <button
                  type="button"
                  onClick={() => {
                    setManualShortcut(false);
                    if (!agentShortcuts.some((s) => s.shortcutId === shortcutId)) {
                      setShortcutId(agentShortcuts[0]?.shortcutId ?? "");
                    }
                  }}
                >
                  Escolher da lista do agente
                </button>
              )}
            </div>
          )}

          {kind === "app_volume" && (
            <label>
              Nome do aplicativo (appName)
              <input
                type="text"
                maxLength={64}
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="ex: spotify"
              />
            </label>
          )}

          {(kind === "volume" || kind === "brightness") && (
            <label>
              Passo de ajuste (1–25%)
              <input
                type="number"
                min={1}
                max={25}
                step={1}
                value={step}
                onChange={(e) => setStep(Number(e.target.value))}
              />
            </label>
          )}

          {kind === "mic_ptt" && (
            <label>
              Duração do lease Push-to-Talk (2–30 segundos)
              <input
                type="number"
                min={2}
                max={30}
                step={1}
                value={leaseSeconds}
                onChange={(e) => setLeaseSeconds(Number(e.target.value))}
              />
              <small>
                O agente silencia o microfone automaticamente ao fim do lease se a conexão cair.
              </small>
            </label>
          )}

          {kind === "media" && (
            <small>Comandos de mídia atuam na sessão multimídia ativa do computador host.</small>
          )}

          <label className="online-toggle">
            <input
              type="checkbox"
              checked={bindingEnabled}
              onChange={(e) => setBindingEnabled(e.target.checked)}
            />
            Vínculo ativo
          </label>

          <div className="control-deck-item-actions">
            <button
              type="button"
              className="online-primary"
              disabled={busyBinding || (!editingId && bindings.length >= 50)}
              onClick={() => void handleSaveBinding()}
            >
              {busyBinding ? "Salvando…" : editingId ? "Salvar vínculo" : "Criar vínculo"}
            </button>
            {editingId && (
              <button type="button" disabled={busyBinding} onClick={resetForm}>
                Cancelar edição
              </button>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset disabled={controlsDisabled}>
        <legend>Widget Control Deck no painel</legend>
        <label className="online-toggle">
          <input
            type="checkbox"
            checked={widgetEnabled}
            disabled={toggleDisabled}
            onChange={(e) => {
              if (onEnabledChange) onEnabledChange(e.target.checked);
              else updateDeck({ enabled: e.target.checked });
            }}
          />
          Ativar widget Control Deck
        </label>

        <div className="control-deck-fields">
          <label>
            Título do widget
            <input
              type="text"
              maxLength={80}
              value={deck.title}
              onChange={(e) => updateDeck({ title: e.target.value })}
              onBlur={() => {
                if (!deck.title.trim()) updateDeck({ title: "Control Deck" });
              }}
            />
          </label>
          <label>
            Colunas na grade de botões
            <select
              value={String(deck.columns)}
              onChange={(e) => updateDeck({ columns: Number(e.target.value) })}
            >
              <option value="2">2 colunas</option>
              <option value="3">3 colunas</option>
              <option value="4">4 colunas</option>
            </select>
          </label>
        </div>

        <small>Botões publicados ({deck.tiles.length}/16):</small>
        {deck.tiles.length === 0 ? (
          <p className="online-empty">
            Nenhum botão configurado. Crie ou selecione um vínculo acima para adicionar botões ao
            painel.
          </p>
        ) : (
          <div className="control-deck-list">
            {deck.tiles.map((tile, index) => {
              const linked = bindingMap.get(tile.bindingId);
              return (
                <div key={tile.id} className="control-deck-tile-card">
                  <div className="control-deck-tile-header">
                    <strong>Botão {index + 1}</strong>
                    <div className="control-deck-tile-actions">
                      <button
                        type="button"
                        aria-label={`Subir ${tile.label}`}
                        disabled={controlsDisabled || index === 0}
                        onClick={() => moveTile(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Descer ${tile.label}`}
                        disabled={controlsDisabled || index === deck.tiles.length - 1}
                        onClick={() => moveTile(index, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="online-danger"
                        aria-label={`Remover botão ${tile.label}`}
                        disabled={controlsDisabled}
                        onClick={() =>
                          updateDeck({
                            tiles: deck.tiles.filter((row) => row.id !== tile.id),
                          })
                        }
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                  <div className="control-deck-fields">
                    <label>
                      Rótulo do botão
                      <input
                        type="text"
                        maxLength={40}
                        value={tile.label}
                        onChange={(e) => updateTile(tile.id, { label: e.target.value })}
                        onBlur={() => {
                          if (!tile.label.trim()) updateTile(tile.id, { label: "Botão" });
                        }}
                      />
                    </label>
                    <label>
                      Vínculo (bindingId opaco)
                      <select
                        value={tile.bindingId}
                        onChange={(e) => updateTile(tile.id, { bindingId: e.target.value })}
                      >
                        {!linked && (
                          <option value={tile.bindingId}>
                            Vínculo ausente ({tile.bindingId})
                          </option>
                        )}
                        {bindings.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label} ({KIND_LABELS[item.kind]} ·{" "}
                            {ACTION_LABELS[item.action] ?? item.action})
                            {!item.enabled ? " [desativado]" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Ícone
                      <select
                        value={tile.icon}
                        onChange={(e) =>
                          updateTile(tile.id, { icon: e.target.value as ControlDeckIcon })
                        }
                      >
                        {controlDeckIcons.map((icon) => (
                          <option key={icon} value={icon}>
                            {ICON_LABELS[icon]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {(!linked || !linked.enabled) && (
                    <small className="online-error">
                      {!linked
                        ? "Vínculo não encontrado nesta residência; o botão ficará bloqueado no player."
                        : "Vínculo desativado; reative-o acima para habilitar este botão."}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          disabled={controlsDisabled || deck.tiles.length >= 16 || bindings.length === 0}
          onClick={addDefaultTile}
        >
          + Adicionar botão ao Control Deck
        </button>
      </fieldset>
    </div>
  );
}
