"use client";

import Image from "next/image";
import { useRef, useState, type RefObject } from "react";
import { photoStatusLabel } from "@/lib/online-editor/photos";

export type LibraryPhoto = {
  id: string;
  filename: string;
  status: string;
  width?: number | null;
  height?: number | null;
};

export function PhotoLibrary({
  photos,
  selectedIds,
  disabled,
  uploadBusy,
  inputRef,
  onUpload,
  onToggle,
  onRemove,
  onMove,
}: {
  photos: LibraryPhoto[];
  selectedIds: string[];
  disabled: boolean;
  uploadBusy: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onUpload: (files: FileList | null) => void;
  onToggle: (photo: LibraryPhoto, selected: boolean) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, index: number, delta: number) => void;
}) {
  const [failedThumbnails, setFailedThumbnails] = useState<Set<string>>(() => new Set());
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  function reorder(id: string, index: number, delta: number) {
    onMove(id, index, delta);
    requestAnimationFrame(() => {
      const action = actionRefs.current.get(`${id}:${delta}`);
      if (action && !action.disabled) action.focus();
      else itemRefs.current.get(id)?.focus();
    });
  }
  function thumbnail(photo: LibraryPhoto, compact = false) {
    const usable = photo.status === "ready" && !failedThumbnails.has(photo.id);
    return (
      <span
        className={`photo-thumb ${compact ? "is-compact" : ""} ${usable ? "has-image" : "is-fallback"}`}
      >
        {usable && (
          <Image
            src={`/api/photos/${encodeURIComponent(photo.id)}/image`}
            width={64}
            height={48}
            unoptimized
            alt=""
            onError={() => setFailedThumbnails((current) => new Set(current).add(photo.id))}
          />
        )}
        {!usable && (
          <span
            role="img"
            aria-label={
              photo.status === "ready"
                ? `Miniatura indisponível para ${photo.filename}`
                : photoStatusLabel(photo.status)
            }
          >
            {photo.status === "ready" ? "Miniatura indisponível" : "▧"}
          </span>
        )}
      </span>
    );
  }
  return (
    <>
      <p className="photo-count">
        {selectedIds.length} de 100 fotos selecionadas
        {selectedIds.length >= 100
          ? " — limite atingido; retire uma foto para selecionar outra."
          : ""}
      </p>
      {uploadBusy && <p role="status">{uploadBusy}</p>}
      <label className="online-upload">
        Adicionar várias fotos (JPEG, PNG ou WebP; até 12 MB cada)
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled}
          onChange={(event) => {
            onUpload(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <h3>Biblioteca</h3>
      {!photos.length && <p className="online-empty">Ainda não há fotos na biblioteca.</p>}
      <div className="online-photo-list">
        {photos.map((photo) => {
          const ready = photo.status === "ready";
          const selected = selectedIds.includes(photo.id);
          return (
            <article className="online-library-photo" key={photo.id} data-photo-id={photo.id}>
              {thumbnail(photo)}
              <div className="photo-metadata">
                <strong title={photo.filename}>{photo.filename}</strong>
                <small>
                  {photoStatusLabel(photo.status)}
                  {ready && photo.width && photo.height
                    ? ` · ${photo.width} × ${photo.height}`
                    : ""}
                </small>
              </div>
              <label className="online-toggle">
                <input
                  type="checkbox"
                  disabled={disabled || !ready}
                  checked={selected}
                  onChange={(event) => onToggle(photo, event.target.checked)}
                />
                {selected ? "Selecionada" : "Selecionar"}
              </label>
              {selected && (
                <button type="button" disabled={disabled} onClick={() => onRemove(photo.id)}>
                  Retirar do painel
                </button>
              )}
            </article>
          );
        })}
      </div>
      <div className="online-ordered-photos">
        <h3>Ordem no painel</h3>
        {selectedIds.map((id, index) => {
          const photo = photos.find((item) => item.id === id);
          if (!photo) return null;
          return (
            <article
              className="online-photo ordered-photo"
              key={id}
              data-photo-id={id}
              tabIndex={-1}
              ref={(node) => {
                if (node) itemRefs.current.set(id, node);
                else itemRefs.current.delete(id);
              }}
            >
              {thumbnail(photo, true)}
              <span className="photo-order-name">
                <b>{index + 1}.</b> {photo.filename}
              </span>
              <span>
                <button
                  ref={(node) => {
                    if (node) actionRefs.current.set(`${id}:-1`, node);
                    else actionRefs.current.delete(`${id}:-1`);
                  }}
                  type="button"
                  disabled={disabled || index === 0}
                  aria-label={`Mover ${photo.filename} para antes`}
                  onClick={() => reorder(id, index, -1)}
                >
                  Mover para antes
                </button>
                <button
                  ref={(node) => {
                    if (node) actionRefs.current.set(`${id}:1`, node);
                    else actionRefs.current.delete(`${id}:1`);
                  }}
                  type="button"
                  disabled={disabled || index === selectedIds.length - 1}
                  aria-label={`Mover ${photo.filename} para depois`}
                  onClick={() => reorder(id, index, 1)}
                >
                  Mover para depois
                </button>
              </span>
            </article>
          );
        })}
      </div>
    </>
  );
}
