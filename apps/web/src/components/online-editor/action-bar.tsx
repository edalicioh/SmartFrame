"use client";

import type { RefObject } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Save, Send, Tablet } from "lucide-react";
import type { DraftStatus, PublicationState } from "@/lib/online-editor/publication";

function PublicationBadgeIcon({ kind }: { kind: PublicationState["kind"] }) {
  switch (kind) {
    case "confirmed":
      return <CheckCircle2 size={14} aria-hidden="true" />;
    case "pending-confirmation":
    case "checking-legacy":
      return <Clock size={14} aria-hidden="true" />;
    case "other-panel-active":
    case "legacy-fallback-active":
    case "legacy-error":
      return <AlertTriangle size={14} aria-hidden="true" />;
    default:
      return <Tablet size={14} aria-hidden="true" />;
  }
}

export function EditorActionBar({
  panelName,
  deviceName,
  draftStatus,
  publicationState,
  conflictMessage,
  busy,
  controlsDisabled,
  publishButtonRef,
  onSaveDraft,
  onOpenPublish,
  onReloadPanel,
}: {
  panelName: string;
  deviceName: string | null;
  draftStatus: DraftStatus;
  publicationState: PublicationState;
  conflictMessage: string | null;
  busy: string;
  controlsDisabled: boolean;
  publishButtonRef: RefObject<HTMLButtonElement | null>;
  onSaveDraft: () => void;
  onOpenPublish: () => void;
  onReloadPanel: () => void;
}) {
  return (
    <section className="online-action-bar" aria-label="Ações e estado de publicação">
      <div className="online-action-bar-summary">
        <div className="online-action-bar-badges">
          <span
            className={`online-status-pill is-draft-${draftStatus.kind}`}
            data-status={draftStatus.kind}
          >
            {draftStatus.label}
          </span>
          <span
            className={`online-status-pill is-pub-${publicationState.kind}`}
            data-status={publicationState.kind}
          >
            <PublicationBadgeIcon kind={publicationState.kind} />
            {publicationState.label}
          </span>
          {publicationState.draftDivergesConfirmed && (
            <span className="online-status-pill is-warning">
              Rascunho editado após confirmação
            </span>
          )}
        </div>
        <p className="online-action-bar-description">
          <strong>{panelName}</strong>
          {deviceName ? ` · Destino: ${deviceName}` : " · Sem dispositivo selecionado"} —{" "}
          {publicationState.description}
        </p>
      </div>

      <div className="online-action-bar-buttons">
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={onSaveDraft}
        >
          <Save size={15} aria-hidden="true" />
          Salvar rascunho
        </button>
        <button
          ref={publishButtonRef}
          type="button"
          className="online-primary"
          disabled={controlsDisabled}
          onClick={onOpenPublish}
        >
          <Send size={15} aria-hidden="true" />
          Publicar…
        </button>
      </div>

      {conflictMessage && (
        <div className="online-conflict-banner" role="alert">
          <div className="online-conflict-copy">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <strong>Conflito de revisão (409)</strong>
              <p>{conflictMessage}</p>
            </div>
          </div>
          <button type="button" disabled={!!busy} onClick={onReloadPanel}>
            <RefreshCw size={14} aria-hidden="true" />
            Recarregar versão do servidor
          </button>
        </div>
      )}
    </section>
  );
}
