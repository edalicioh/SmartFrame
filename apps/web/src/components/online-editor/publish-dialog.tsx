"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { AlertTriangle, MonitorPlay, PlusCircle, Send, Tablet, X } from "lucide-react";
import type { PublishMode, PublishTarget } from "@/lib/online-editor/publication";

export function PublishDialog({
  open,
  target,
  mode,
  onModeChange,
  dirty,
  draftRevision,
  hasDevices,
  unreadyPhotoCount,
  validationError,
  conflictMessage,
  busy,
  dialogError,
  returnFocusElementRef,
  postCloseFocusRef,
  onClose,
  onConfirm,
  onGoToPairing,
  onFocusDeviceSelect,
}: {
  open: boolean;
  target: PublishTarget | null;
  mode: PublishMode | null;
  onModeChange: (mode: PublishMode) => void;
  dirty: boolean;
  draftRevision: number;
  hasDevices: boolean;
  unreadyPhotoCount: number;
  validationError: string | null;
  conflictMessage: string | null;
  busy: string;
  dialogError: string;
  returnFocusElementRef: RefObject<HTMLElement | null>;
  postCloseFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onConfirm: (target: PublishTarget, mode: PublishMode) => void;
  onGoToPairing: () => void;
  onFocusDeviceSelect: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !wasOpenRef.current) {
      if (!dialog.open) {
        dialog.showModal();
      }
      requestAnimationFrame(() => {
        if (firstRadioRef.current && !firstRadioRef.current.disabled) {
          firstRadioRef.current.focus();
        } else {
          closeButtonRef.current?.focus();
        }
      });
    } else if (!open && wasOpenRef.current) {
      if (dialog.open) {
        dialog.close();
      }
      const overrideTarget = postCloseFocusRef.current;
      postCloseFocusRef.current = null;
      const focusTarget = overrideTarget ?? returnFocusElementRef.current;
      if (focusTarget?.isConnected && !(focusTarget as HTMLButtonElement).disabled) {
        focusTarget.focus();
      }
    }
    wasOpenRef.current = open;
  }, [open, returnFocusElementRef, postCloseFocusRef]);

  const hasTargetDevice = Boolean(target?.deviceId && target?.deviceName);
  const blockingReason = !hasTargetDevice
    ? null
    : conflictMessage
      ? conflictMessage
      : validationError
        ? validationError
        : unreadyPhotoCount > 0
          ? `${unreadyPhotoCount} ${unreadyPhotoCount === 1 ? "foto selecionada ainda não está pronta" : "fotos selecionadas ainda não estão prontas"}. Aguarde o processamento ou retire-a do painel antes de publicar.`
          : null;

  const showDialogError = Boolean(dialogError && dialogError !== blockingReason);
  const confirmDisabled =
    Boolean(busy) || !target || !hasTargetDevice || !mode || Boolean(blockingReason);

  return (
    <dialog
      ref={dialogRef}
      className="online-dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="online-dialog-header">
        <div>
          <h2 id={titleId}>Publicar painel</h2>
          <p id={descId} className="online-dialog-subtitle">
            Confira o painel, o dispositivo de destino e escolha o efeito da publicação.
          </p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="online-dialog-close"
          aria-label="Fechar diálogo de publicação"
          disabled={!!busy}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {target && (
        <dl className="online-dialog-summary">
          <div>
            <dt>Painel</dt>
            <dd>{target.panelName}</dd>
          </div>
          <div>
            <dt>ID do painel</dt>
            <dd>
              <code>{target.panelId}</code>
            </dd>
          </div>
          <div>
            <dt>Dispositivo de destino</dt>
            <dd>{target.deviceName ?? "Nenhum dispositivo selecionado"}</dd>
          </div>
          {target.deviceId && (
            <div>
              <dt>ID do dispositivo</dt>
              <dd>
                <code>{target.deviceId}</code>
              </dd>
            </div>
          )}
          <div>
            <dt>Rascunho atual</dt>
            <dd>
              {dirty
                ? `Alterações não salvas (serão salvas a partir de r${draftRevision} antes de publicar)`
                : `Rascunho salvo (r${draftRevision})`}
            </dd>
          </div>
        </dl>
      )}

      {!hasTargetDevice ? (
        <div className="online-dialog-callout" role="note">
          <Tablet size={18} aria-hidden="true" />
          <div>
            {!hasDevices ? (
              <>
                <strong>Nenhum dispositivo vinculado</strong>
                <p>
                  Você pode continuar salvando rascunhos normalmente. Para disponibilizar ou exibir
                  este painel em um tablet, gere um código de pareamento e vincule o dispositivo.
                </p>
                <div className="online-dialog-inline-actions">
                  <button
                    type="button"
                    className="online-primary"
                    disabled={!!busy}
                    onClick={onGoToPairing}
                  >
                    Ir para pareamento
                  </button>
                </div>
              </>
            ) : (
              <>
                <strong>Nenhum dispositivo selecionado como destino</strong>
                <p>
                  Escolha explicitamente o dispositivo de destino no seletor do editor antes de
                  publicar. Nenhum tablet será selecionado automaticamente.
                </p>
                <div className="online-dialog-inline-actions">
                  <button
                    type="button"
                    className="online-primary"
                    disabled={!!busy}
                    onClick={onFocusDeviceSelect}
                  >
                    Selecionar dispositivo
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <fieldset className="online-publish-modes" disabled={!!busy}>
          <legend>Escolha o efeito no dispositivo</legend>
          <label
            className={`online-publish-option${mode === "available" ? " is-selected" : ""}`}
          >
            <input
              ref={firstRadioRef}
              type="radio"
              name="publish-mode"
              value="available"
              checked={mode === "available"}
              onChange={() => onModeChange("available")}
            />
            <span className="online-publish-option-body">
              <strong>
                <PlusCircle size={15} aria-hidden="true" />
                Disponibilizar no tablet
              </strong>
              <small>
                Salva o rascunho quando necessário e deixa esta versão selecionável no tablet,{" "}
                <b>sem trocar a tela exibida agora</b>.
              </small>
            </span>
          </label>
          <label
            className={`online-publish-option${mode === "activate" ? " is-selected" : ""}`}
          >
            <input
              type="radio"
              name="publish-mode"
              value="activate"
              checked={mode === "activate"}
              onChange={() => onModeChange("activate")}
            />
            <span className="online-publish-option-body">
              <strong>
                <MonitorPlay size={15} aria-hidden="true" />
                Exibir no tablet
              </strong>
              <small>
                Salva o rascunho quando necessário, disponibiliza esta versão e{" "}
                <b>solicita que o tablet passe a exibir este painel</b>.
              </small>
            </span>
          </label>
        </fieldset>
      )}

      {blockingReason && (
        <div className="online-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" /> {blockingReason}
        </div>
      )}

      {showDialogError && (
        <div className="online-error" role="alert">
          {dialogError}
        </div>
      )}

      <div className="online-dialog-footer">
        <button type="button" disabled={!!busy} onClick={onClose}>
          Cancelar
        </button>
        {hasTargetDevice && target && (
          <button
            type="button"
            className="online-primary"
            disabled={confirmDisabled}
            onClick={() => {
              if (mode) onConfirm(target, mode);
            }}
          >
            <Send size={15} aria-hidden="true" />
            {busy
              ? busy
              : mode === "activate"
                ? "Confirmar: exibir no tablet"
                : mode === "available"
                  ? "Confirmar: disponibilizar no tablet"
                  : "Escolha uma opção acima"}
          </button>
        )}
      </div>
    </dialog>
  );
}
