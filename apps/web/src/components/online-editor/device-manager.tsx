"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { AlertTriangle, QrCode, RefreshCw, ShieldAlert, Tablet, Trash2, X } from "lucide-react";
import {
  deriveDeviceActiveStatus,
  formatDeviceDisplayName,
  formatLastCommunication,
  isPairingExpired,
  splitDevicePanelAvailability,
  type DeviceSummary,
  type LegacyFallbackStatus,
  type PairingInfo,
  type PanelAccessItem,
  type PanelSummary,
} from "@/lib/online-editor/publication";

type ListStatus = "loading" | "ready" | "error";

export function DeviceManager({
  open,
  onToggleOpen,
  devices,
  devicesStatus,
  selectedDevice,
  panels,
  editingPanel,
  access,
  accessDeviceId,
  accessError,
  legacyFallback,
  pairing,
  busy,
  loadingPanel,
  pairingButtonRef,
  onRetryDevices,
  onRefreshDevices,
  onRetryAccess,
  onOpenPublishAvailable,
  onRemoveAccess,
  onGeneratePairing,
  onDismissPairing,
  onRevokeDevice,
}: {
  open: boolean;
  onToggleOpen: (open: boolean) => void;
  devices: DeviceSummary[];
  devicesStatus: ListStatus;
  selectedDevice: DeviceSummary | null;
  panels: PanelSummary[];
  editingPanel: PanelSummary | null;
  access: PanelAccessItem[];
  accessDeviceId: string;
  accessError: string;
  legacyFallback?: LegacyFallbackStatus;
  pairing: PairingInfo | null;
  busy: string;
  loadingPanel: boolean;
  pairingButtonRef: RefObject<HTMLButtonElement | null>;
  onRetryDevices: () => void;
  onRefreshDevices: () => void;
  onRetryAccess: (deviceId: string) => void;
  onOpenPublishAvailable: (trigger?: HTMLElement | null) => void;
  onRemoveAccess: (panelId: string) => void;
  onGeneratePairing: () => void;
  onDismissPairing: () => void;
  onRevokeDevice: (device: DeviceSummary) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [revokeCandidate, setRevokeCandidate] = useState<DeviceSummary | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const revokeDialogRef = useRef<HTMLDialogElement>(null);
  const revokeCancelRef = useRef<HTMLButtonElement>(null);
  const revokeTriggerRef = useRef<HTMLButtonElement>(null);
  const wasRevokeOpenRef = useRef(false);
  const revokeTitleId = useId();
  const revokeDescId = useId();

  useEffect(() => {
    if (!pairing) return;
    // Sync current time when pairing card opens and update until expiry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  useEffect(() => {
    const dialog = revokeDialogRef.current;
    if (!dialog) return;
    const isOpen = revokeCandidate !== null;
    if (isOpen && !wasRevokeOpenRef.current) {
      if (!dialog.open) dialog.showModal();
      requestAnimationFrame(() => revokeCancelRef.current?.focus());
    } else if (!isOpen && wasRevokeOpenRef.current) {
      if (dialog.open) dialog.close();
      const focusTarget = revokeTriggerRef.current;
      if (focusTarget?.isConnected) focusTarget.focus();
      else if (pairingButtonRef.current?.isConnected) pairingButtonRef.current.focus();
    }
    wasRevokeOpenRef.current = isOpen;
  }, [revokeCandidate, pairingButtonRef]);

  const pairingExpired = pairing ? isPairingExpired(pairing, nowMs) : false;
  const accessLoadedForSelected = Boolean(
    selectedDevice && accessDeviceId === selectedDevice.id && !accessError,
  );
  const selectedDeviceLabel = selectedDevice
    ? formatDeviceDisplayName(selectedDevice, devices)
    : "";
  const revokeCandidateLabel = revokeCandidate
    ? formatDeviceDisplayName(revokeCandidate, devices)
    : "";

  const split = selectedDevice
    ? splitDevicePanelAvailability({
        panels,
        access: accessLoadedForSelected ? access : [],
        activePanelId: selectedDevice.activePanelId,
      })
    : null;

  const deviceActiveStatus = selectedDevice
    ? deriveDeviceActiveStatus({
        device: selectedDevice,
        activePanelName: split?.activePanel?.name ?? null,
        legacyFallback,
      })
    : null;

  return (
    <>
      <details
        className="online-secondary-area"
        open={open}
        onToggle={(event) => onToggleOpen(event.currentTarget.open)}
      >
        <summary>Dispositivos, permissões e pareamento</summary>

        <div className="online-devices-content">
          {devicesStatus === "loading" && (
            <p className="online-empty">Carregando dispositivos…</p>
          )}

          {devicesStatus === "error" && (
            <div className="online-error" role="alert">
              Não foi possível carregar dispositivos.{" "}
              <button type="button" onClick={onRetryDevices}>
                Tentar novamente
              </button>
            </div>
          )}

          {devicesStatus === "ready" && !devices.length && (
            <div className="online-callout">
              <div>
                <strong>Nenhum dispositivo vinculado</strong>
                <p>
                  Você já pode criar e salvar rascunhos normalmente. Gere um código de pareamento
                  abaixo para vincular um tablet e exibir seus painéis.
                </p>
              </div>
              <button
                ref={pairingButtonRef}
                type="button"
                className="online-primary"
                disabled={!!busy}
                onClick={onGeneratePairing}
              >
                <QrCode size={15} aria-hidden="true" />
                Vincular dispositivo
              </button>
            </div>
          )}

          {selectedDevice && split && deviceActiveStatus && (
            <div className="online-device-panels-grid">
              <section
                className="online-device-card"
                aria-label="Painel enviado para exibição neste dispositivo"
              >
                <div className="online-device-card-header">
                  <h3>
                    <Tablet size={16} aria-hidden="true" />
                    {selectedDeviceLabel}
                  </h3>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={onRefreshDevices}
                    aria-label="Atualizar estado dos dispositivos"
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                    Atualizar
                  </button>
                </div>
                <dl className="online-device-facts">
                  <div>
                    <dt>ID do dispositivo</dt>
                    <dd>
                      <code>{selectedDevice.id}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Painel enviado para exibição</dt>
                    <dd>
                      <strong>
                        {selectedDevice.activePanelId && selectedDevice.activePanelVersionId
                          ? (split.activePanel?.name ?? "Painel ativo (carregando nome…)")
                          : deviceActiveStatus.kind === "legacy-active"
                            ? "Publicação legada (fallback)"
                            : deviceActiveStatus.kind === "checking-legacy"
                              ? "Verificando publicação…"
                              : deviceActiveStatus.kind === "legacy-error"
                                ? "Indisponível (erro ao verificar)"
                                : "Nenhum painel enviado"}
                      </strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Confirmação do dispositivo</dt>
                    <dd>{deviceActiveStatus.label}</dd>
                  </div>
                  <div>
                    <dt>Comunicação</dt>
                    <dd>{formatLastCommunication(selectedDevice.lastSeenAt)}</dd>
                  </div>
                </dl>
                <details className="online-status-details">
                  <summary>Detalhes técnicos do dispositivo</summary>
                  <p>
                    Versão enviada: <code>{deviceActiveStatus.sentRevision ?? "—"}</code> · Versão
                    aplicada: <code>{deviceActiveStatus.appliedRevision ?? "—"}</code>
                  </p>
                </details>
              </section>

              <section
                className="online-device-card"
                aria-label="Painéis disponíveis para escolha no dispositivo"
              >
                <h3>Painéis disponíveis para escolha em {selectedDeviceLabel}</h3>
                <p className="online-device-hint">
                  Somente versões disponibilizadas aqui podem ser escolhidas no tablet. Rascunhos
                  nunca ficam acessíveis sem publicação. Remover o acesso retira o painel das
                  opções do dispositivo, sem excluir o painel nem desativar a exibição atual.
                </p>

                {accessError ? (
                  <div className="online-error" role="alert">
                    Não foi possível carregar permissões: {accessError}{" "}
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => onRetryAccess(selectedDevice.id)}
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : accessDeviceId !== selectedDevice.id ? (
                  <p className="online-empty">Carregando permissões…</p>
                ) : split.available.length === 0 ? (
                  <p className="online-empty">
                    Nenhum painel disponibilizado neste dispositivo ainda.
                  </p>
                ) : (
                  <ul className="online-device-access-list">
                    {split.available.map((entry) => (
                      <li key={entry.panelId}>
                        <div>
                          <strong>{entry.name}</strong>
                          <small>
                            {entry.isActive
                              ? "Painel enviado para exibição — publique outro painel antes de remover este acesso."
                              : "Disponibilizado para seleção no tablet"}
                          </small>
                        </div>
                        <button
                          type="button"
                          disabled={!!busy || entry.isActive}
                          title={
                            entry.isActive
                              ? "Publique outro painel antes de remover o acesso do painel ativo."
                              : undefined
                          }
                          onClick={() => onRemoveAccess(entry.panelId)}
                        >
                          Remover acesso
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {accessLoadedForSelected && split.unavailable.length > 0 && (
                  <p className="online-device-hint">
                    Ainda não disponibilizados neste dispositivo:{" "}
                    {split.unavailable.map((item) => item.name).join(", ")}.
                  </p>
                )}

                {editingPanel && (
                  <div className="online-device-card-actions">
                    <button
                      type="button"
                      disabled={!!busy || loadingPanel || accessDeviceId !== selectedDevice.id}
                      onClick={(event) => onOpenPublishAvailable(event.currentTarget)}
                    >
                      Disponibilizar “{editingPanel.name}” neste dispositivo…
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          <section className="online-pairing-area" aria-label="Pareamento de novo dispositivo">
            <div className="online-pairing-header">
              <div>
                <h3>Pareamento</h3>
                <p className="online-device-hint">
                  Gere um código temporário de uso único para conectar um tablet sem sair do
                  rascunho em edição.
                </p>
              </div>
              <div className="online-device-actions">
                <button
                  ref={devices.length > 0 ? pairingButtonRef : undefined}
                  type="button"
                  disabled={!!busy}
                  onClick={onGeneratePairing}
                >
                  <QrCode size={15} aria-hidden="true" />
                  {pairing ? "Gerar novo código" : "Gerar código para dispositivo"}
                </button>
                {devices.length > 0 && (
                  <button type="button" disabled={!!busy} onClick={onRefreshDevices}>
                    <RefreshCw size={14} aria-hidden="true" />
                    Atualizar lista
                  </button>
                )}
                {selectedDevice && (
                  <button
                    ref={revokeTriggerRef}
                    type="button"
                    className="online-danger"
                    disabled={!!busy}
                    onClick={() => {
                      setRevokeError("");
                      setRevokeCandidate(selectedDevice);
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Desvincular {selectedDeviceLabel}
                  </button>
                )}
              </div>
            </div>

            {pairing && (
              <div
                className={`pairing-card online-pairing-card${pairingExpired ? " is-expired" : ""}`}
                role="region"
                aria-label="Código de pareamento ativo"
              >
                <div className="online-pairing-top">
                  <div>
                    <span className="online-pairing-label">Código de pareamento</span>
                    <code aria-label="Código de pareamento">{pairing.code}</code>
                  </div>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={onDismissPairing}
                  >
                    <X size={14} aria-hidden="true" />
                    Ocultar da tela
                  </button>
                </div>

                <dl className="online-device-facts">
                  <div>
                    <dt>Endereço do servidor</dt>
                    <dd>
                      <strong>{pairing.serverURL}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Validade</dt>
                    <dd>
                      {pairingExpired
                        ? `Expirado às ${new Date(pairing.expiresAt).toLocaleTimeString("pt-BR")}`
                        : `Expira às ${new Date(pairing.expiresAt).toLocaleTimeString("pt-BR")}`}
                    </dd>
                  </div>
                </dl>

                {pairingExpired ? (
                  <div className="online-error" role="alert">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <div>
                      <strong>Código expirado.</strong> Códigos expirados não podem ser renovados;
                      gere um novo código para parear o tablet.
                    </div>
                    <button
                      type="button"
                      className="online-primary"
                      disabled={!!busy}
                      onClick={onGeneratePairing}
                    >
                      Gerar novo código
                    </button>
                  </div>
                ) : (
                  <ol className="online-pairing-steps">
                    <li>Abra o aplicativo SmartFrame no tablet.</li>
                    <li>Informe o endereço do servidor acima e digite o código antes da expiração.</li>
                    <li>
                      A lista de dispositivos atualiza automaticamente sem alterar o painel em
                      edição.
                    </li>
                  </ol>
                )}

                <small className="online-device-hint">
                  Ocultar este quadro fecha apenas a exibição na tela; não revoga o código no
                  servidor antes do vencimento.
                </small>
              </div>
            )}
          </section>
        </div>
      </details>

      <dialog
        ref={revokeDialogRef}
        className="online-dialog"
        aria-labelledby={revokeTitleId}
        aria-describedby={revokeDescId}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) {
            setRevokeError("");
            setRevokeCandidate(null);
          }
        }}
      >
        <div className="online-dialog-header">
          <div>
            <h2 id={revokeTitleId}>
              <ShieldAlert size={18} aria-hidden="true" /> Desvincular{" "}
              {revokeCandidateLabel || "dispositivo"}?
            </h2>
          </div>
          <button
            type="button"
            className="online-dialog-close"
            aria-label="Fechar confirmação de desvinculação"
            disabled={!!busy}
            onClick={() => {
              setRevokeError("");
              setRevokeCandidate(null);
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {revokeCandidate && (
          <dl className="online-dialog-summary">
            <div>
              <dt>Dispositivo</dt>
              <dd>{revokeCandidateLabel}</dd>
            </div>
            <div>
              <dt>ID do dispositivo</dt>
              <dd>
                <code>{revokeCandidate.id}</code>
              </dd>
            </div>
          </dl>
        )}
        <p id={revokeDescId} className="online-dialog-subtitle">
          Ao desvincular este dispositivo, a credencial de acesso do tablet é revogada no servidor.
          Ele deixará de receber atualizações e precisará de um novo código de pareamento para
          reconectar. Conteúdos já armazenados no aparelho não são apagados remotamente.
        </p>
        {revokeError && (
          <div className="online-error" role="alert">
            {revokeError}
          </div>
        )}
        <div className="online-dialog-footer">
          <button
            ref={revokeCancelRef}
            type="button"
            disabled={!!busy}
            onClick={() => {
              setRevokeError("");
              setRevokeCandidate(null);
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="online-danger"
            disabled={!!busy || !revokeCandidate}
            onClick={() => {
              if (!revokeCandidate) return;
              setRevokeError("");
              void onRevokeDevice(revokeCandidate).then((result) => {
                if (result.ok) {
                  setRevokeError("");
                  setRevokeCandidate(null);
                } else {
                  setRevokeError(result.error ?? "Falha ao desvincular o dispositivo.");
                }
              });
            }}
          >
            {busy ? busy : "Confirmar desvinculação"}
          </button>
        </div>
      </dialog>
    </>
  );
}
