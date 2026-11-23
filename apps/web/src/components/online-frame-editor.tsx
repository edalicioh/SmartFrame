"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalWidgetEditor } from "./local-widget-editor";
import { EditorActionBar } from "./online-editor/action-bar";
import { AutomationsEditor } from "./online-editor/automations-editor";
import { ControlDeckEditor } from "./online-editor/control-deck-editor";
import { DeviceManager } from "./online-editor/device-manager";
import {
  isRestoringTraverseNavigation,
  registerTraverseGuard,
  stripUrlFragment,
} from "./online-editor/history-guard";
import { PhotoLibrary } from "./online-editor/photo-library";
import { PublishDialog } from "./online-editor/publish-dialog";
import { useUnsavedDraft } from "./online-editor/unsaved-draft-context";
import { ValidatedNumberField } from "./online-editor/validated-number-field";
import {
  addPhotoSelection,
  movePhotoSelection,
  removePhotoSelection,
} from "@/lib/online-editor/photos";
import { ensureGridLayoutValid, setGridLayoutEnabled } from "@/lib/online-editor/grid-layout";
import { previewWidgetSettings } from "@/lib/online-editor/widget-settings";
import {
  clearNumericIssuesForDisabledWidgets,
  clearNumericIssuesForHiddenWidgets,
} from "@/lib/online-editor/numeric-issues";
import {
  deriveDraftStatus,
  derivePublicationState,
  EditorApiError,
  formatDeviceDisplayName,
  formatLastCommunication,
  formatPanelDisplayName,
  formatPartialPublishFailure,
  isConflictError,
  isPairingExpired,
  type LegacyFallbackStatus,
  type PublishMode,
  type PublishTarget,
} from "@/lib/online-editor/publication";
import {
  appearancePresets,
  applyPanelTemplate,
  autoArrangeDashboardGrid,
  createDashboardPage,
  createDefaultDashboardGridLayout,
  currencyCodes,
  dashboardWidgetKeys,
  defaultOnlineDashboard,
  gridDimensions,
  gridItemsOverlap,
  gridWidgetCatalog,
  onlineDashboardSchema,
  panelTemplates,
  resolveActivePageConfig,
  resolveScopedAppearance,
  type AppearancePreset,
  type ControlDeckPlayerWidgetData,
  type DashboardGridItem,
  type DashboardGridLayout,
  type DashboardPage,
  type DashboardWidgetKey,
  type OnlineDashboard,
  type PageSettings,
  type PanelTemplateId,
  type ScopedAppearance,
  type SmartStackConfig,
  type WidgetAppearanceOverride,
} from "@smartframe/contracts";

const APPEARANCE_PRESET_LABELS: Record<AppearancePreset, string> = {
  default: "Original do SmartFrame",
  cards: "Cartões arredondados (18px, borda, sem sombra)",
  flat: "Superfícies planas (12px, sem borda/sombra/blur)",
  borderless: "Somente conteúdo (transparente, cantos retos)",
  seamless: "Painel contínuo (sem espaçamento, cantos retos)",
};

type ScopedNumericKey = "cornerRadius" | "widgetSpacing" | "innerPadding" | "pageEdgePadding";
type ScopedBooleanKey = "border" | "shadow";

function cleanWidgetAppearance(
  next: WidgetAppearanceOverride,
): WidgetAppearanceOverride | undefined {
  const cleaned: WidgetAppearanceOverride = {};
  if (next.preset !== undefined && next.preset !== null) cleaned.preset = next.preset;
  if (next.cornerRadius !== undefined && next.cornerRadius !== null)
    cleaned.cornerRadius = next.cornerRadius;
  if (next.innerPadding !== undefined && next.innerPadding !== null)
    cleaned.innerPadding = next.innerPadding;
  if (next.border !== undefined && next.border !== null) cleaned.border = next.border;
  if (next.shadow !== undefined && next.shadow !== null) cleaned.shadow = next.shadow;
  return Object.keys(cleaned).length ? cleaned : undefined;
}

function ScopedAppearanceControls({
  scope,
  value,
  resolved,
  hideInnerPadding = false,
  onPresetChange,
  onFieldChange,
  onReset,
}: {
  scope: "global" | "widget";
  value: ScopedAppearance | WidgetAppearanceOverride | undefined;
  resolved: ReturnType<typeof resolveScopedAppearance>;
  hideInnerPadding?: boolean;
  onPresetChange: (preset: AppearancePreset | null) => void;
  onFieldChange: (key: ScopedNumericKey | ScopedBooleanKey, next: number | boolean | null) => void;
  onReset: () => void;
}) {
  const ranges: Array<{
    key: ScopedNumericKey;
    label: string;
    min: number;
    max: number;
    fallback: number;
    globalOnly?: boolean;
    hidden?: boolean;
  }> = [
    { key: "cornerRadius", label: "Raio dos cantos (px)", min: 0, max: 32, fallback: 18 },
    {
      key: "widgetSpacing",
      label: "Espaçamento entre widgets (px)",
      min: 0,
      max: 24,
      fallback: 8,
      globalOnly: true,
    },
    {
      key: "innerPadding",
      label: "Espaçamento interno dos widgets (px)",
      min: 0,
      max: 24,
      fallback: 12,
      hidden: hideInnerPadding,
    },
    {
      key: "pageEdgePadding",
      label: "Margem da borda do painel (px)",
      min: 0,
      max: 32,
      fallback: 10,
      globalOnly: true,
    },
  ];

  const valueObj = (value ?? {}) as Record<string, unknown>;
  const hasAnyOverride =
    valueObj.preset !== undefined ||
    valueObj.cornerRadius !== undefined ||
    valueObj.widgetSpacing !== undefined ||
    valueObj.innerPadding !== undefined ||
    valueObj.pageEdgePadding !== undefined ||
    valueObj.border !== undefined ||
    valueObj.shadow !== undefined;

  return (
    <>
      <label>
        {scope === "global" ? "Preset de aparência" : "Preset do widget"}
        <select
          value={(valueObj.preset as string | undefined) ?? (scope === "global" ? "default" : "")}
          onChange={(event) => {
            const selected = event.target.value;
            onPresetChange(selected ? (selected as AppearancePreset) : null);
          }}
        >
          {scope === "widget" && <option value="">Herdar do painel</option>}
          {appearancePresets.map((preset) => (
            <option key={preset} value={preset}>
              {APPEARANCE_PRESET_LABELS[preset]}
            </option>
          ))}
        </select>
      </label>

      {ranges
        .filter((item) => !item.hidden && (scope === "global" || !item.globalOnly))
        .map((item) => {
          const explicit = valueObj[item.key] as number | null | undefined;
          const isExplicit = explicit !== undefined && explicit !== null;
          const effective = resolved[item.key];
          const display = isExplicit
            ? `${explicit} px (personalizado)`
            : effective !== null
              ? `${effective} px (${scope === "global" ? "do preset" : "herdado"})`
              : "Padrão original";
          return (
            <div key={item.key}>
              <label>
                {item.label} · {display}
                <input
                  type="range"
                  min={item.min}
                  max={item.max}
                  value={isExplicit ? explicit : (effective ?? item.fallback)}
                  onChange={(event) => onFieldChange(item.key, Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                disabled={!isExplicit}
                onClick={() => onFieldChange(item.key, null)}
              >
                {scope === "global" ? "Herdar do preset" : "Herdar"}
              </button>
            </div>
          );
        })}

      {(
        [
          ["border", scope === "global" ? "Borda dos cartões" : "Borda"],
          ["shadow", scope === "global" ? "Sombra dos cartões" : "Sombra"],
        ] as const
      ).map(([key, label]) => {
        const explicit = valueObj[key] as boolean | null | undefined;
        const selectValue = explicit === true ? "on" : explicit === false ? "off" : "";
        return (
          <label key={key}>
            {label}
            <select
              value={selectValue}
              onChange={(event) => {
                const next = event.target.value;
                onFieldChange(key, next === "on" ? true : next === "off" ? false : null);
              }}
            >
              <option value="">{scope === "global" ? "Herdar do preset" : "Herdar"}</option>
              <option value="on">Ativada</option>
              <option value="off">Desativada</option>
            </select>
          </label>
        );
      })}

      <button type="button" disabled={!hasAnyOverride} onClick={onReset}>
        {scope === "global"
          ? "Restaurar aparência original do painel"
          : "Redefinir para aparência herdada"}
      </button>
    </>
  );
}

type Device = {
  id: string;
  name: string;
  lastSeenAt: string | null;
  appliedRevision: string | null;
  activePanelId: string | null;
  activePanelVersionId: string | null;
};
type Panel = { id: string; name: string };

type GridDragState = {
  widgetId: DashboardWidgetKey;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  origin: DashboardGridItem;
  blocked: boolean;
};

function clampGridValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function GridLayoutEditor({
  config,
  pageId,
  disabled,
  onChange,
}: {
  config: OnlineDashboard;
  pageId?: string;
  disabled: boolean;
  onChange: (next: OnlineDashboard) => void;
}) {
  const scope = resolveActivePageConfig(config, pageId);
  const gridLayout = scope.gridLayout;
  const enabledSet = useMemo(() => new Set(scope.enabledWidgets), [scope.enabledWidgets]);
  const activeStackKeys = useMemo(() => {
    if (!scope.smartStack?.enabled) return [];
    const list = scope.smartStack.widgets.filter((key) => enabledSet.has(key));
    return list.length >= 2 ? list : [];
  }, [scope.smartStack, enabledSet]);
  const stackAnchor = activeStackKeys[0] ?? null;
  const secondaryStackSet = useMemo(
    () => (activeStackKeys.length >= 2 ? new Set(activeStackKeys.slice(1)) : null),
    [activeStackKeys],
  );
  const orientation = config.orientation;
  const dims = gridDimensions[orientation];
  const allItems = useMemo(
    () => (gridLayout ? gridLayout[orientation] : []),
    [gridLayout, orientation],
  );
  const activeItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          enabledSet.has(item.widgetId) &&
          (!secondaryStackSet || !secondaryStackSet.has(item.widgetId)),
      ),
    [allItems, enabledSet, secondaryStackSet],
  );
  const [selectedId, setSelectedId] = useState<DashboardWidgetKey>("photos");
  const [gridFeedback, setGridFeedback] = useState("");
  const [dragState, setDragState] = useState<GridDragState | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const resolvedSelectedId = activeItems.some((item) => item.widgetId === selectedId)
    ? selectedId
    : (activeItems[0]?.widgetId ?? "photos");
  const selectedItem =
    activeItems.find((item) => item.widgetId === resolvedSelectedId) ?? activeItems[0] ?? null;

  function minimumForWidget(widgetId: DashboardWidgetKey) {
    if (widgetId === stackAnchor && activeStackKeys.length >= 2) {
      return {
        label: `${scope.smartStack?.title || "Smart Stack"} (${activeStackKeys.length})`,
        minWidth: Math.max(...activeStackKeys.map((k) => gridWidgetCatalog[k].minWidth)),
        minHeight: Math.max(...activeStackKeys.map((k) => gridWidgetCatalog[k].minHeight)),
      };
    }
    return gridWidgetCatalog[widgetId];
  }

  function commitOrientationItems(nextVisible: DashboardGridItem[]) {
    if (!gridLayout) return;
    const anchorUpdated = stackAnchor
      ? nextVisible.find((item) => item.widgetId === stackAnchor)
      : null;
    const expanded = [...nextVisible];
    if (anchorUpdated && activeStackKeys.length >= 2) {
      for (const secondaryKey of activeStackKeys.slice(1)) {
        expanded.push({
          widgetId: secondaryKey,
          x: anchorUpdated.x,
          y: anchorUpdated.y,
          w: anchorUpdated.w,
          h: anchorUpdated.h,
        });
      }
    }
    const inactive = allItems.filter((item) => !enabledSet.has(item.widgetId));
    const nextGridLayout: DashboardGridLayout = {
      ...gridLayout,
      [orientation]: [...expanded, ...inactive],
    };
    if (scope.page && config.pages?.length) {
      onChange({
        ...config,
        pages: config.pages.map((p) =>
          p.id === scope.page!.id ? { ...p, gridLayout: nextGridLayout } : p,
        ),
      });
      return;
    }
    onChange({
      ...config,
      gridLayout: nextGridLayout,
    });
  }

  function tryUpdateItem(candidate: DashboardGridItem): { ok: boolean; error?: string } {
    const min = minimumForWidget(candidate.widgetId);
    if (candidate.w < min.minWidth || candidate.h < min.minHeight) {
      return {
        ok: false,
        error: `${min.label}: tamanho mínimo de ${min.minWidth}×${min.minHeight} células.`,
      };
    }
    if (
      candidate.x < 0 ||
      candidate.y < 0 ||
      candidate.x + candidate.w > dims.columns ||
      candidate.y + candidate.h > dims.rows
    ) {
      return { ok: false, error: `${min.label}: fora dos limites da grade.` };
    }
    const blocker = activeItems.find(
      (other) => other.widgetId !== candidate.widgetId && gridItemsOverlap(candidate, other),
    );
    if (blocker) {
      return {
        ok: false,
        error: `Conflito de espaço com ${minimumForWidget(blocker.widgetId).label}.`,
      };
    }
    const current = activeItems.find((item) => item.widgetId === candidate.widgetId);
    if (
      current &&
      current.x === candidate.x &&
      current.y === candidate.y &&
      current.w === candidate.w &&
      current.h === candidate.h
    ) {
      return { ok: true };
    }
    commitOrientationItems(
      activeItems.map((item) => (item.widgetId === candidate.widgetId ? candidate : item)),
    );
    return { ok: true };
  }

  function startPointerInteraction(
    event: React.PointerEvent,
    item: DashboardGridItem,
    mode: "move" | "resize",
  ) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(item.widgetId);
    setGridFeedback("");
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in tests may omit capture support.
    }
    setDragState({
      widgetId: item.widgetId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...item },
      blocked: false,
    });
  }

  function movePointerInteraction(event: React.PointerEvent) {
    if (!dragState || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = Math.round(((event.clientX - dragState.startX) / rect.width) * dims.columns);
    const dy = Math.round(((event.clientY - dragState.startY) / rect.height) * dims.rows);
    const min = minimumForWidget(dragState.widgetId);
    const origin = dragState.origin;
    const candidate: DashboardGridItem =
      dragState.mode === "move"
        ? {
            widgetId: origin.widgetId,
            x: clampGridValue(origin.x + dx, 0, dims.columns - origin.w),
            y: clampGridValue(origin.y + dy, 0, dims.rows - origin.h),
            w: origin.w,
            h: origin.h,
          }
        : {
            widgetId: origin.widgetId,
            x: origin.x,
            y: origin.y,
            w: clampGridValue(origin.w + dx, min.minWidth, dims.columns - origin.x),
            h: clampGridValue(origin.h + dy, min.minHeight, dims.rows - origin.y),
          };
    const result = tryUpdateItem(candidate);
    if (!result.ok && result.error) setGridFeedback(result.error);
    else setGridFeedback("");
    if (dragState.blocked !== !result.ok) {
      setDragState((current) => (current ? { ...current, blocked: !result.ok } : null));
    }
  }

  function endPointerInteraction(event: React.PointerEvent) {
    if (!dragState) return;
    try {
      if ((event.currentTarget as HTMLElement).hasPointerCapture?.(event.pointerId)) {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore synthetic cleanup errors.
    }
    setDragState(null);
  }

  if (!gridLayout) return null;

  return (
    <div className="online-grid-editor">
      <div className="online-grid-toolbar">
        <label>
          Orientação da grade
          <select
            value={orientation}
            onChange={(event) => {
              setGridFeedback("");
              onChange({
                ...config,
                orientation: event.target.value as "landscape" | "portrait",
              });
            }}
          >
            <option value="landscape">Paisagem (24×24)</option>
            <option value="portrait">Retrato (12×40)</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setGridFeedback("");
            onChange(autoArrangeDashboardGrid(config, orientation, scope.page?.id));
          }}
        >
          Organizar automaticamente sem colisões
        </button>
      </div>
      <small>
        Arraste os blocos para posicionar, puxe o canto inferior direito para redimensionar ou use o
        inspetor numérico abaixo. Grade atual: {dims.columns} colunas × {dims.rows} linhas.
      </small>
      {gridFeedback && (
        <div className="online-error" role="alert">
          {gridFeedback}
        </div>
      )}
      <div
        ref={canvasRef}
        className="online-grid-canvas"
        data-orientation={orientation}
        style={
          {
            aspectRatio: `${dims.columns} / ${dims.rows}`,
            "--grid-cols": String(dims.columns),
            "--grid-rows": String(dims.rows),
          } as React.CSSProperties
        }
        onPointerMove={movePointerInteraction}
        onPointerUp={endPointerInteraction}
        onPointerCancel={endPointerInteraction}
      >
        {activeItems.map((item) => {
          const isSelected = selectedItem?.widgetId === item.widgetId;
          const isBlocked = dragState?.widgetId === item.widgetId && dragState.blocked;
          const meta = minimumForWidget(item.widgetId);
          return (
            <div
              key={item.widgetId}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${meta.label} (${item.w}×${item.h} em ${item.x},${item.y})`}
              aria-pressed={isSelected}
              className={`online-grid-item${isSelected ? " is-selected" : ""}${isBlocked ? " is-blocked" : ""}`}
              style={{
                left: `${(item.x / dims.columns) * 100}%`,
                top: `${(item.y / dims.rows) * 100}%`,
                width: `${(item.w / dims.columns) * 100}%`,
                height: `${(item.h / dims.rows) * 100}%`,
              }}
              onClick={() => {
                setSelectedId(item.widgetId);
                setGridFeedback("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedId(item.widgetId);
                }
              }}
              onPointerDown={(event) => startPointerInteraction(event, item, "move")}
            >
              <strong>{meta.label}</strong>
              <span>
                {item.w}×{item.h} · ({item.x},{item.y})
              </span>
              <span
                className="online-grid-resize-handle"
                title={`Redimensionar ${meta.label}`}
                aria-hidden="true"
                onPointerDown={(event) => startPointerInteraction(event, item, "resize")}
              />
            </div>
          );
        })}
      </div>
      {selectedItem && (
        <div className="online-grid-inspector">
          <label>
            Widget selecionado
            <select
              value={selectedItem.widgetId}
              onChange={(event) => {
                setSelectedId(event.target.value as DashboardWidgetKey);
                setGridFeedback("");
              }}
            >
              {activeItems.map((item) => (
                <option key={item.widgetId} value={item.widgetId}>
                  {minimumForWidget(item.widgetId).label}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["x", "Coluna (X)", 0, dims.columns - selectedItem.w],
              ["y", "Linha (Y)", 0, dims.rows - selectedItem.h],
              [
                "w",
                "Largura (W)",
                minimumForWidget(selectedItem.widgetId).minWidth,
                dims.columns - selectedItem.x,
              ],
              [
                "h",
                "Altura (H)",
                minimumForWidget(selectedItem.widgetId).minHeight,
                dims.rows - selectedItem.y,
              ],
            ] as const
          ).map(([field, label, minVal, maxVal]) => (
            <label key={field}>
              {label}
              <input
                type="number"
                min={minVal}
                max={maxVal}
                step={1}
                value={selectedItem[field]}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (!Number.isInteger(parsed)) return;
                  const result = tryUpdateItem({ ...selectedItem, [field]: parsed });
                  setGridFeedback(result.ok ? "" : (result.error ?? ""));
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

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
type WidgetData = Awaited<ReturnType<typeof import("@smartframe/widgets").onlineWidgetData>> & {
  controlDeck?: ControlDeckPlayerWidgetData;
};
type ListStatus = "loading" | "ready" | "error";

function EditorFeedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <div className="online-error" role="alert">
          {error}
        </div>
      )}
      <div className="online-notice" role="status" aria-live="polite" aria-atomic="true">
        {notice}
      </div>
    </>
  );
}

type EditorSection = "photos" | "widgets" | "controlDeck" | "appearance" | "automations";

function EditorSectionNavigation({
  value,
  onChange,
}: {
  value: EditorSection;
  onChange: (value: EditorSection) => void;
}) {
  return (
    <nav className="online-section-nav" aria-label="Seções de edição">
      {(
        [
          ["photos", "Fotos"],
          ["widgets", "Widgets"],
          ["controlDeck", "Control Deck"],
          ["appearance", "Aparência"],
          ["automations", "Automações"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={value === key ? "is-active" : ""}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new EditorApiError(
      typeof data.error === "string" ? data.error : "Não foi possível concluir a operação.",
      response.status,
    );
  }
  return data;
}

const pendingPhoto = (photo: Photo) => photo.status === "pending" || photo.status === "processing";

export function OnlineFrameEditor() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [panels, setPanels] = useState<Panel[]>([]);
  const [access, setAccess] = useState<PanelAccess[]>([]);
  const [accessDevice, setAccessDevice] = useState("");
  const [accessError, setAccessError] = useState("");
  const [legacyFallback, setLegacyFallback] = useState<{
    deviceId: string;
    status: "loading" | "ready" | "error";
    publishedRevision: string | null;
  } | null>(null);
  const [panelId, setPanelId] = useState("");
  const [state, setState] = useState<PanelState | null>(null);
  const [config, setConfig] = useState<OnlineDashboard>(defaultOnlineDashboard);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<{ panelId: string; message: string } | null>(null);
  const [listStatus, setListStatus] = useState({
    devices: "loading" as ListStatus,
    panels: "loading" as ListStatus,
    photos: "loading" as ListStatus,
  });
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [devicesAreaOpen, setDevicesAreaOpen] = useState(false);
  const [publishDialog, setPublishDialog] = useState<{
    open: boolean;
    target: PublishTarget | null;
    mode: PublishMode | null;
    error: string;
  }>({ open: false, target: null, mode: null, error: "" });
  const [photoPollExpired, setPhotoPollExpired] = useState(false);
  const [photoPollRetry, setPhotoPollRetry] = useState(0);
  const [widgetData, setWidgetData] = useState<WidgetData | null>(null);
  const [currencyBase, setCurrencyBase] = useState("USD");
  const [currencyTarget, setCurrencyTarget] = useState("BRL");
  const [editorSection, setEditorSection] = useState<EditorSection>("photos");
  const [mobilePane, setMobilePane] = useState<"configure" | "preview">("configure");
  const [photoAnnouncement, setPhotoAnnouncement] = useState("");
  const [photoUploadStatus, setPhotoUploadStatus] = useState("");
  const [numericIssues, setNumericIssues] = useState<Record<string, string>>({});
  const [activePageId, setActivePageId] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const publishReturnFocusRef = useRef<HTMLElement | null>(null);
  const postCloseFocusRef = useRef<HTMLElement | null>(null);
  const pendingFocusAfterPublishRef = useRef<HTMLElement | null>(null);
  const deviceSelectRef = useRef<HTMLSelectElement>(null);
  const pairingButtonRef = useRef<HTMLButtonElement>(null);
  const operation = useRef(false);
  const selectedId = useRef(panelId);
  const selectedDeviceIdRef = useRef(deviceId);
  const dirtyRef = useRef(dirty);
  const publishDialogOpenRef = useRef(publishDialog.open);
  const conflictRef = useRef(conflict);
  const panelStateSeqRef = useRef(0);
  const devicesRequestSeq = useRef(0);
  const accessRequestSeq = useRef(0);
  const legacyFallbackSeqRef = useRef(0);
  const accessDeviceRef = useRef(accessDevice);
  useEffect(() => {
    selectedId.current = panelId;
  }, [panelId]);
  useEffect(() => {
    selectedDeviceIdRef.current = deviceId;
  }, [deviceId]);
  useEffect(() => {
    accessDeviceRef.current = accessDevice;
  }, [accessDevice]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    publishDialogOpenRef.current = publishDialog.open;
  }, [publishDialog.open]);
  useEffect(() => {
    conflictRef.current = conflict;
  }, [conflict]);
  const unsavedDraft = useUnsavedDraft();
  const signingOut = Boolean(unsavedDraft?.signingOut);
  const signingOutRef = useRef(signingOut);
  useEffect(() => {
    signingOutRef.current = signingOut;
  }, [signingOut]);
  const effectiveBusy = busy || (signingOut ? "Saindo da conta…" : "");
  useEffect(() => {
    if (publishDialog.open || effectiveBusy || loading) return;
    const target = pendingFocusAfterPublishRef.current;
    if (!target) return;
    pendingFocusAfterPublishRef.current = null;
    if (target.isConnected && !(target as HTMLButtonElement).disabled) {
      target.focus();
    }
  }, [publishDialog.open, effectiveBusy, loading]);
  const setGlobalUnsavedDraft = unsavedDraft?.setHasUnsavedDraft;
  const isSignOutRedirectAuthorized = unsavedDraft?.isSignOutRedirectAuthorized;
  const selectedDevice = devices.find((device) => device.id === deviceId) ?? null;
  const selectedDeviceLabel = selectedDevice
    ? formatDeviceDisplayName(selectedDevice, devices)
    : null;
  const activePanel = panels.find((panel) => panel.id === selectedDevice?.activePanelId) ?? null;
  const editingPanelLabel = state ? formatPanelDisplayName(state, panels) : null;
  const activePanelLabel = activePanel ? formatPanelDisplayName(activePanel, panels) : null;

  useEffect(() => {
    setGlobalUnsavedDraft?.(dirty);
  }, [dirty, setGlobalUnsavedDraft]);

  useEffect(
    () => () => {
      setGlobalUnsavedDraft?.(false);
    },
    [setGlobalUnsavedDraft],
  );

  useEffect(() => {
    if (!dirty) return;
    const editorDocumentUrl = stripUrlFragment(window.location.href);
    const exitMessage = "Há alterações não salvas. Sair desta página e descartar as alterações?";
    let confirmedClientLink = false;
    let confirmedTraverseByNavigateApi = false;
    let clientLinkTimer: number | null = null;
    const confirmExit = () => window.confirm(exitMessage);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const guardClientNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (stripUrlFragment(anchor.href) === stripUrlFragment(window.location.href)) return;
      if (!confirmExit()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      confirmedClientLink = true;
      if (clientLinkTimer !== null) window.clearTimeout(clientLinkTimer);
      clientLinkTimer = window.setTimeout(() => {
        confirmedClientLink = false;
        clientLinkTimer = null;
      }, 1000);
    };

    type BrowserNavigationEntry = { index?: number };
    type BrowserNavigateEvent = Event & {
      navigationType?: string;
      cancelable: boolean;
      destination?: { url?: string; index?: number; getState?: () => unknown };
    };
    type BrowserNavigation = EventTarget & {
      currentEntry?: BrowserNavigationEntry | null;
      addEventListener(type: "navigate", listener: (event: BrowserNavigateEvent) => void): void;
      removeEventListener(type: "navigate", listener: (event: BrowserNavigateEvent) => void): void;
    };
    const navigationApi = (window as Window & { navigation?: BrowserNavigation }).navigation;

    const guardNavigate = (event: BrowserNavigateEvent) => {
      if (!dirtyRef.current) return;
      if (isRestoringTraverseNavigation(event.destination)) return;
      if (
        event.destination?.url &&
        stripUrlFragment(event.destination.url) === stripUrlFragment(window.location.href)
      ) {
        return;
      }
      if (
        event.navigationType === "replace" &&
        isSignOutRedirectAuthorized?.(event.destination?.url)
      ) {
        return;
      }
      if (!event.cancelable) return;
      if (confirmedClientLink && event.navigationType !== "traverse") {
        confirmedClientLink = false;
        if (clientLinkTimer !== null) {
          window.clearTimeout(clientLinkTimer);
          clientLinkTimer = null;
        }
        return;
      }
      if (!confirmExit()) {
        event.preventDefault();
      } else if (event.navigationType === "traverse") {
        confirmedTraverseByNavigateApi = true;
      }
    };

    registerTraverseGuard((targetHref) => {
      if (!dirtyRef.current) return true;
      if (stripUrlFragment(targetHref) === editorDocumentUrl) return true;
      if (confirmedTraverseByNavigateApi) {
        confirmedTraverseByNavigateApi = false;
        return true;
      }
      return confirmExit();
    });

    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardClientNavigation, true);
    if (navigationApi) {
      navigationApi.addEventListener("navigate", guardNavigate);
    }
    return () => {
      registerTraverseGuard(null);
      if (clientLinkTimer !== null) window.clearTimeout(clientLinkTimer);
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardClientNavigation, true);
      if (navigationApi) {
        navigationApi.removeEventListener("navigate", guardNavigate);
      }
    };
  }, [dirty, isSignOutRedirectAuthorized]);

  const resolvedPage = useMemo(
    () => resolveActivePageConfig(config, activePageId || undefined),
    [config, activePageId],
  );
  const currentPageSettings: PageSettings = config.pageSettings ?? {
    autoRotateSeconds: 0,
    showIndicators: true,
    swipeEnabled: true,
  };
  const activeSmartStack: SmartStackConfig = resolvedPage.smartStack ?? {
    enabled: false,
    title: "Smart Stack",
    widgets: [],
    intervalSeconds: 10,
    showIndicators: true,
  };
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
  const [deckRefreshNonce, setDeckRefreshNonce] = useState(0);
  const widgetSettings = JSON.stringify(previewWidgetSettings(config));
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
          if (data.currenciesPending || data.rssPending) delay = 2000;
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
  }, [panelId, widgetSettings, deckRefreshNonce]);

  const previewPageId = resolvedPage.page?.id ?? "";
  const sendPreview = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      {
        type: "smartframe:online-preview",
        config: previewConfig,
        activePageId: previewPageId,
      },
      window.location.origin,
    );
  }, [previewConfig, previewPageId]);
  useEffect(() => {
    sendPreview();
  }, [sendPreview]);

  const refreshDevices = useCallback(async (allowDuringOperation = true) => {
    const seq = ++devicesRequestSeq.current;
    try {
      const result = await api("/api/devices");
      if (seq !== devicesRequestSeq.current) {
        return { ok: false as const, stale: true as const, error: "" };
      }
      if (!allowDuringOperation && operation.current) {
        return { ok: false as const, stale: true as const, error: "" };
      }
      const nextDevices: Device[] = result.data ?? [];
      setDevices(nextDevices);
      setListStatus((current) => ({ ...current, devices: "ready" }));
      if (
        selectedDeviceIdRef.current &&
        !nextDevices.some((item) => item.id === selectedDeviceIdRef.current)
      ) {
        selectedDeviceIdRef.current = "";
        legacyFallbackSeqRef.current += 1;
        setDeviceId("");
        setAccess([]);
        setAccessDevice("");
        setAccessError("");
        setLegacyFallback(null);
      }
      return { ok: true as const, stale: false as const, devices: nextDevices };
    } catch (failure: unknown) {
      if (seq !== devicesRequestSeq.current) {
        return { ok: false as const, stale: true as const, error: "" };
      }
      return {
        ok: false as const,
        stale: false as const,
        error:
          failure instanceof Error ? failure.message : "Não foi possível carregar dispositivos.",
      };
    }
  }, []);
  const refreshPanels = useCallback(async () => {
    const result = await api("/api/panels");
    setPanels(result.panels ?? []);
    setListStatus((current) => ({ ...current, panels: "ready" }));
  }, []);
  const refreshPhotos = useCallback(async () => {
    const result = await api("/api/photos");
    setPhotos(result.photos ?? []);
    setListStatus((current) => ({ ...current, photos: "ready" }));
    return (result.photos ?? []) as Photo[];
  }, []);

  const fetchDeviceAccess = useCallback(async (id: string) => {
    const seq = ++accessRequestSeq.current;
    try {
      const result = await api(`/api/devices/panels?deviceId=${encodeURIComponent(id)}`);
      if (seq !== accessRequestSeq.current || selectedDeviceIdRef.current !== id) {
        return { current: false as const };
      }
      return {
        current: true as const,
        ok: true as const,
        items: (result.access as PanelAccess[]) ?? [],
      };
    } catch (failure: unknown) {
      if (seq !== accessRequestSeq.current || selectedDeviceIdRef.current !== id) {
        return { current: false as const };
      }
      return {
        current: true as const,
        ok: false as const,
        error:
          failure instanceof Error ? failure.message : "Não foi possível carregar permissões.",
      };
    }
  }, []);

  const applyDeviceAccessOutcome = useCallback(
    (
      id: string,
      outcome: Awaited<ReturnType<typeof fetchDeviceAccess>>,
      isActive: () => boolean = () => true,
    ): boolean => {
      if (!isActive() || !outcome.current || selectedDeviceIdRef.current !== id) return false;
      if (outcome.ok) {
        accessDeviceRef.current = id;
        setAccess(outcome.items);
        setAccessDevice(id);
        setAccessError("");
        return true;
      }
      setAccessError(outcome.error);
      return false;
    },
    [],
  );

  const syncDeviceAccess = useCallback(
    async (id: string, isActive: () => boolean = () => true): Promise<boolean> => {
      const outcome = await fetchDeviceAccess(id);
      return applyDeviceAccessOutcome(id, outcome, isActive);
    },
    [fetchDeviceAccess, applyDeviceAccessOutcome],
  );

  const fetchLegacyFallback = useCallback(async (id: string) => {
    const seq = ++legacyFallbackSeqRef.current;
    try {
      const result = await api(`/api/online-frame?deviceId=${encodeURIComponent(id)}`);
      if (seq !== legacyFallbackSeqRef.current || selectedDeviceIdRef.current !== id) {
        return { current: false as const };
      }
      const publishedRevision =
        typeof result?.publishedRevision === "string" && result.publishedRevision.length > 0
          ? result.publishedRevision
          : null;
      return {
        current: true as const,
        ok: true as const,
        publishedRevision,
      };
    } catch {
      if (seq !== legacyFallbackSeqRef.current || selectedDeviceIdRef.current !== id) {
        return { current: false as const };
      }
      return { current: true as const, ok: false as const };
    }
  }, []);

  const applyLegacyFallbackOutcome = useCallback(
    (
      id: string,
      outcome: Awaited<ReturnType<typeof fetchLegacyFallback>>,
      isActive: () => boolean = () => true,
    ) => {
      if (!isActive() || !outcome.current || selectedDeviceIdRef.current !== id) return;
      if (outcome.ok) {
        setLegacyFallback({
          deviceId: id,
          status: "ready",
          publishedRevision: outcome.publishedRevision,
        });
        return;
      }
      setLegacyFallback((current) =>
        current && current.deviceId === id && current.status === "ready"
          ? current
          : { deviceId: id, status: "error", publishedRevision: null },
      );
    },
    [],
  );

  const syncLegacyFallback = useCallback(
    async (id: string, isActive: () => boolean = () => true): Promise<void> => {
      const outcome = await fetchLegacyFallback(id);
      applyLegacyFallbackOutcome(id, outcome, isActive);
    },
    [fetchLegacyFallback, applyLegacyFallbackOutcome],
  );

  useEffect(() => {
    if (!deviceId) return;
    let active = true;
    void fetchDeviceAccess(deviceId).then((outcome) => {
      applyDeviceAccessOutcome(deviceId, outcome, () => active);
    });
    return () => {
      active = false;
    };
  }, [deviceId, fetchDeviceAccess, applyDeviceAccessOutcome]);

  const needsLegacyFallbackCheck = Boolean(selectedDevice && !selectedDevice.activePanelId);
  const selectedDeviceKey = selectedDevice?.id ?? "";

  useEffect(() => {
    if (!selectedDeviceKey || !needsLegacyFallbackCheck) {
      legacyFallbackSeqRef.current += 1;
      return;
    }
    let active = true;
    void fetchLegacyFallback(selectedDeviceKey).then((outcome) => {
      applyLegacyFallbackOutcome(selectedDeviceKey, outcome, () => active);
    });
    return () => {
      active = false;
    };
  }, [
    selectedDeviceKey,
    needsLegacyFallbackCheck,
    fetchLegacyFallback,
    applyLegacyFallbackOutcome,
  ]);

  useEffect(() => {
    let active = true;
    const load = <T,>(
      key: keyof typeof listStatus,
      request: () => Promise<T>,
      apply: (data: T) => void,
      isCurrent: () => boolean = () => true,
    ) => {
      setListStatus((current) => ({ ...current, [key]: "loading" }));
      request()
        .then((data) => {
          if (active && isCurrent()) {
            apply(data);
            setListStatus((current) => ({ ...current, [key]: "ready" }));
          }
        })
        .catch((failure: unknown) => {
          if (active && isCurrent()) {
            setListStatus((current) => ({ ...current, [key]: "error" }));
            setError(
              failure instanceof Error ? failure.message : "Não foi possível carregar os dados.",
            );
          }
        });
    };
    const devicesSeq = ++devicesRequestSeq.current;
    load(
      "devices",
      () => api("/api/devices"),
      (result) => setDevices(result.data ?? []),
      () => devicesSeq === devicesRequestSeq.current,
    );
    load(
      "photos",
      () => api("/api/photos"),
      (result) => setPhotos(result.photos ?? []),
    );
    load(
      "panels",
      () => api("/api/panels"),
      (result) => setPanels(result.panels ?? []),
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!panelId) return;
    let active = true;
    const seq = ++panelStateSeqRef.current;
    // Loading and clearing old device data must happen before its response can render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setState(null);
    setError("");
    api(`/api/panels?id=${encodeURIComponent(panelId)}`)
      .then((next: PanelState) => {
        if (!active || seq !== panelStateSeqRef.current || selectedId.current !== panelId) return;
        setState(next);
        setConfig(next.config);
        setDirty(false);
      })
      .catch((failure) => {
        if (active && seq === panelStateSeqRef.current) setError(failure.message);
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
      if (isPairingExpired(pairing)) {
        window.clearInterval(timer);
        return;
      }
      if (operation.current) return;
      void refreshDevices(false).then((res) => {
        if (active && !res.ok && !res.stale) setError(res.error);
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
      const targetPanelId = panelId;
      const seq = ++panelStateSeqRef.current;
      try {
        const latest: PanelState = await api(`/api/panels?id=${encodeURIComponent(targetPanelId)}`);
        if (!active || seq !== panelStateSeqRef.current || selectedId.current !== targetPanelId) {
          return;
        }
        if (!operation.current) {
          await refreshDevices(false);
        }
        if (!active || seq !== panelStateSeqRef.current || selectedId.current !== targetPanelId) {
          return;
        }
        const canReplaceDraft =
          !dirtyRef.current &&
          !operation.current &&
          !publishDialogOpenRef.current &&
          conflictRef.current?.panelId !== targetPanelId;
        setState((current) =>
          current && current.id === targetPanelId
            ? {
                ...current,
                name: latest.name,
                ...(canReplaceDraft
                  ? { draftRevision: latest.draftRevision, config: latest.config }
                  : {}),
              }
            : current,
        );
        setPanels((current) =>
          current.some((item) => item.id === targetPanelId && item.name !== latest.name)
            ? current.map((item) =>
                item.id === targetPanelId ? { ...item, name: latest.name } : item,
              )
            : current,
        );
        if (canReplaceDraft) setConfig(latest.config);
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
    if (signingOutRef.current) return;
    const arranged = ensureGridLayoutValid(next);
    setConfig(arranged);
    // Widgets whose numeric fields unmount when disabled must not keep
    // blocking save with an error the user can no longer see. Always-mounted
    // fields keep their issue because the invalid draft stays visible.
    const visibleWidgetKeys = new Set(
      resolveActivePageConfig(arranged, activePageId || undefined).enabledWidgets,
    );
    setNumericIssues((current) =>
      clearNumericIssuesForHiddenWidgets(
        clearNumericIssuesForDisabledWidgets(current, config.widgets, arranged.widgets),
        visibleWidgetKeys,
      ),
    );
    setDirty(true);
    setNotice("");
  }
  function changeActivePage(pageId: string, nextConfig: OnlineDashboard = config) {
    const visibleWidgetKeys = new Set(
      resolveActivePageConfig(nextConfig, pageId || undefined).enabledWidgets,
    );
    setNumericIssues((current) => clearNumericIssuesForHiddenWidgets(current, visibleWidgetKeys));
    setActivePageId(pageId);
  }
  function setNumericIssue(id: string, message: string | null) {
    setNumericIssues((current) => {
      const next = { ...current };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
    if (message) setDirty(true);
  }
  function clearNumericIssues(ids: string[]) {
    const removed = new Set(ids);
    setNumericIssues((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !removed.has(id))),
    );
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

  function setWidgetEnabled(
    baseWidgets: OnlineDashboard["widgets"],
    isEnabled: (key: DashboardWidgetKey) => boolean,
  ): OnlineDashboard["widgets"] {
    return {
      photos: { ...baseWidgets.photos, enabled: isEnabled("photos") },
      clock: { ...baseWidgets.clock, enabled: isEnabled("clock") },
      weather: { ...baseWidgets.weather, enabled: isEnabled("weather") },
      currencies: { ...baseWidgets.currencies, enabled: isEnabled("currencies") },
      calendar: { ...baseWidgets.calendar, enabled: isEnabled("calendar") },
      notes: { ...baseWidgets.notes, enabled: isEnabled("notes") },
      countdown: { ...baseWidgets.countdown, enabled: isEnabled("countdown") },
      birthdays: { ...baseWidgets.birthdays, enabled: isEnabled("birthdays") },
      tasks: { ...baseWidgets.tasks, enabled: isEnabled("tasks") },
      pomodoro: { ...baseWidgets.pomodoro, enabled: isEnabled("pomodoro") },
      system: { ...baseWidgets.system, enabled: isEnabled("system") },
      worldClock: { ...baseWidgets.worldClock, enabled: isEnabled("worldClock") },
      rss: { ...baseWidgets.rss, enabled: isEnabled("rss") },
      devMonitor: { ...baseWidgets.devMonitor, enabled: isEnabled("devMonitor") },
      controlDeck: { ...baseWidgets.controlDeck, enabled: isEnabled("controlDeck") },
    };
  }

  function syncGlobalWidgetsFromPages(
    baseWidgets: OnlineDashboard["widgets"],
    pages: DashboardPage[],
  ): OnlineDashboard["widgets"] {
    const activeAnywhere = new Set<DashboardWidgetKey>();
    for (const page of pages) {
      for (const key of page.enabledWidgets) activeAnywhere.add(key);
    }
    return setWidgetEnabled(baseWidgets, (key) => activeAnywhere.has(key));
  }

  function updateActiveScope(
    updater: (scope: {
      enabledWidgets: readonly DashboardWidgetKey[];
      layoutOptions: OnlineDashboard["layoutOptions"];
      gridLayout?: DashboardGridLayout;
      smartStack?: SmartStackConfig;
    }) => {
      enabledWidgets?: readonly DashboardWidgetKey[];
      layoutOptions?: OnlineDashboard["layoutOptions"];
      gridLayout?: DashboardGridLayout;
      smartStack?: SmartStackConfig;
    },
  ) {
    if (config.pages && config.pages.length > 0) {
      const targetId = resolvedPage.page?.id ?? config.pages[0].id;
      const patch = updater({
        enabledWidgets: resolvedPage.enabledWidgets,
        layoutOptions: resolvedPage.layoutOptions,
        gridLayout: resolvedPage.gridLayout,
        smartStack: resolvedPage.smartStack,
      });
      const nextPages = config.pages.map((page) =>
        page.id === targetId
          ? {
              ...page,
              ...(patch.enabledWidgets ? { enabledWidgets: [...patch.enabledWidgets] } : {}),
              ...(patch.layoutOptions ? { layoutOptions: patch.layoutOptions } : {}),
              ...("gridLayout" in patch ? { gridLayout: patch.gridLayout } : {}),
              ...("smartStack" in patch ? { smartStack: patch.smartStack } : {}),
            }
          : page,
      );
      change({
        ...config,
        pages: nextPages,
        widgets: syncGlobalWidgetsFromPages(config.widgets, nextPages),
      });
      return;
    }

    const patch = updater({
      enabledWidgets: resolvedPage.enabledWidgets,
      layoutOptions: config.layoutOptions,
      gridLayout: config.gridLayout,
      smartStack: config.smartStack,
    });
    let nextWidgets = config.widgets;
    if (patch.enabledWidgets) {
      const enabledSet = new Set(patch.enabledWidgets);
      nextWidgets = setWidgetEnabled(config.widgets, (key) => enabledSet.has(key));
    }
    change({
      ...config,
      widgets: nextWidgets,
      ...(patch.layoutOptions ? { layoutOptions: patch.layoutOptions } : {}),
      ...("gridLayout" in patch ? { gridLayout: patch.gridLayout } : {}),
      ...("smartStack" in patch ? { smartStack: patch.smartStack } : {}),
    });
  }

  function updatePageSettings(patch: Partial<PageSettings>) {
    change({
      ...config,
      pageSettings: {
        ...currentPageSettings,
        ...patch,
      },
    });
  }

  function updateSmartStack(patch: Partial<SmartStackConfig>) {
    const rawWidgets = patch.widgets ?? activeSmartStack.widgets;
    const dedupedWidgets = [...new Set(rawWidgets)].filter((key) =>
      dashboardWidgetKeys.includes(key),
    );
    const enablingNow = patch.enabled === true && !activeSmartStack.enabled;
    const initialStackWidgets =
      enablingNow && dedupedWidgets.length === 0
        ? resolvedPage.enabledWidgets.slice(0, 2)
        : dedupedWidgets;

    const nextStack: SmartStackConfig = {
      ...activeSmartStack,
      ...patch,
      widgets: initialStackWidgets.slice(0, 12),
    };

    updateActiveScope((scope) => {
      if (!nextStack.enabled || nextStack.widgets.length === 0) {
        return { smartStack: nextStack };
      }
      const nextEnabled = [...new Set([...scope.enabledWidgets, ...nextStack.widgets])];
      return {
        enabledWidgets: nextEnabled,
        ...(enablingNow
          ? {
              gridLayout: {
                ...(scope.gridLayout ??
                  resolvedPage.gridLayout ??
                  createDefaultDashboardGridLayout(config)),
                enabled: true,
              },
            }
          : {}),
        smartStack: nextStack,
      };
    });
  }

  function chooseDevice(nextId: string) {
    if (operation.current || loading || signingOutRef.current) return;
    if (nextId !== selectedDeviceIdRef.current) {
      accessRequestSeq.current += 1;
      legacyFallbackSeqRef.current += 1;
      accessDeviceRef.current = "";
      setAccess([]);
      setAccessDevice("");
      setAccessError("");
      setLegacyFallback(null);
    }
    selectedDeviceIdRef.current = nextId;
    setDeviceId(nextId);
  }
  function choosePanel(nextId: string) {
    if (operation.current || loading || signingOutRef.current) return;
    if (dirty && !window.confirm("Há alterações não salvas. Descartar para trocar de painel?"))
      return;
    panelStateSeqRef.current += 1;
    selectedId.current = nextId;
    setPanelId(nextId);
    setActivePageId("");
    setNumericIssues({});
    setConflict(null);
    setError("");
    setNotice("");
    setState(null);
    setDirty(false);
  }

  async function managePanel(action: "create" | "duplicate" | "rename" | "delete") {
    if (operation.current || loading || signingOutRef.current) return;
    if (
      (action === "create" || action === "duplicate" || action === "delete") &&
      dirty &&
      !window.confirm(
        action === "duplicate"
          ? "Há alterações não salvas no rascunho atual. Duplicar copia apenas a última versão salva no servidor e descartará as alterações não salvas. Continuar?"
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
      panelStateSeqRef.current += 1;
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
      panelStateSeqRef.current += 1;
      if (action === "rename") setState((current) => (current ? { ...current, name } : current));
      else {
        const nextId = action === "delete" ? "" : result.id;
        selectedId.current = nextId;
        setPanelId(nextId);
        setNumericIssues({});
        setConflict(null);
        setError("");
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

  function validateDraftForPersistence():
    | { ok: true; data: OnlineDashboard }
    | { ok: false; message: string } {
    if (Object.keys(numericIssues).length) {
      return {
        ok: false,
        message: `Corrija os campos numéricos: ${Object.keys(numericIssues)
          .map((id) => id.replaceAll(".", " "))
          .join(", ")}.`,
      };
    }
    const parsed = onlineDashboardSchema.safeParse(config);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        message: `Confira as configurações antes de salvar: ${issue.path.join(" → ")} — ${issue.message}.`,
      };
    }
    return { ok: true, data: parsed.data };
  }

  async function reloadCurrentPanel() {
    if (!panelId || operation.current || loading || signingOutRef.current) return;
    if (
      dirty &&
      !window.confirm(
        "Há alterações não salvas que serão descartadas ao recarregar a versão mais recente do servidor. Deseja descartar e recarregar?",
      )
    ) {
      return;
    }
    const targetPanelId = panelId;
    const seq = ++panelStateSeqRef.current;
    operation.current = true;
    setBusy("Recarregando painel…");
    setError("");
    try {
      const latest: PanelState = await api(`/api/panels?id=${encodeURIComponent(targetPanelId)}`);
      if (selectedId.current !== targetPanelId) return;
      panelStateSeqRef.current = Math.max(panelStateSeqRef.current, seq + 1);
      setState(latest);
      setConfig(latest.config);
      setDirty(false);
      setNumericIssues({});
      setConflict(null);
      setPublishDialog((current) => ({ ...current, error: "" }));
      setNotice(`Painel recarregado na revisão r${latest.draftRevision}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao recarregar o painel.");
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  async function saveDraft() {
    if (!state || !panelId || operation.current || signingOutRef.current) return;
    const targetPanelId = panelId;
    if (!dirty && state.draftRevision > 0 && conflictRef.current?.panelId === targetPanelId) {
      setError(conflictRef.current.message);
      return;
    }
    const validation = validateDraftForPersistence();
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    const savedConfig = validation.data;
    const expectedRevision = state.draftRevision;
    operation.current = true;
    setBusy("Salvando rascunho…");
    setError("");
    setNotice("");
    try {
      let revision = expectedRevision;
      if (dirty || revision === 0) {
        const result = await api("/api/panels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: targetPanelId, config: savedConfig, expectedRevision }),
        });
        revision = result.draftRevision;
      }
      if (selectedId.current !== targetPanelId) return;
      panelStateSeqRef.current += 1;
      setState((current) =>
        current?.id === targetPanelId
          ? { ...current, config: savedConfig, draftRevision: revision }
          : current,
      );
      setDirty(false);
      setConflict((current) => (current?.panelId === targetPanelId ? null : current));
      setNotice("Rascunho salvo; o dispositivo não foi alterado.");
    } catch (failure) {
      if (selectedId.current !== targetPanelId) return;
      if (isConflictError(failure)) {
        const conflictMsg =
          "Este painel foi alterado em outra sessão ou dispositivo (conflito de revisão). Suas alterações locais foram preservadas; recarregue o painel para ver a versão mais recente antes de salvar novamente.";
        setConflict({ panelId: targetPanelId, message: conflictMsg });
        setError(conflictMsg);
      } else {
        setError(failure instanceof Error ? failure.message : "Falha ao salvar rascunho.");
      }
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  async function confirmPublish(target: PublishTarget, mode: PublishMode) {
    if (!state || !target.deviceId || operation.current || signingOutRef.current) return;
    if (
      target.panelId !== selectedId.current ||
      target.deviceId !== selectedDeviceIdRef.current ||
      target.draftRevision !== state.draftRevision
    ) {
      const mismatch =
        "O painel, sua revisão ou o dispositivo selecionado mudou antes da confirmação. Feche e abra Publicar… novamente.";
      setPublishDialog((current) => ({ ...current, error: mismatch }));
      setError(mismatch);
      return;
    }
    const validation = validateDraftForPersistence();
    if (!validation.ok) {
      setPublishDialog((current) => ({ ...current, error: validation.message }));
      setError(validation.message);
      return;
    }

    const activate = mode === "activate";
    const targetPanelId = target.panelId;
    const targetDeviceId = target.deviceId;
    const targetDeviceName = target.deviceName ?? "dispositivo";
    const savedConfig = validation.data;

    operation.current = true;
    setBusy(activate ? "Enviando para exibição…" : "Disponibilizando no dispositivo…");
    setError("");
    setNotice("");
    setPublishDialog((current) => ({ ...current, error: "" }));

    let revision = target.draftRevision;
    let savedInStep = false;

    try {
      if (dirty || revision === 0) {
        const result = await api("/api/panels", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: targetPanelId,
            config: savedConfig,
            expectedRevision: revision,
          }),
        });
        revision = result.draftRevision;
        savedInStep = true;
        if (selectedId.current !== targetPanelId) return;
        panelStateSeqRef.current += 1;
        setState((current) =>
          current?.id === targetPanelId
            ? { ...current, draftRevision: revision, config: savedConfig }
            : current,
        );
        setPublishDialog((current) =>
          current.target && current.target.panelId === targetPanelId
            ? { ...current, target: { ...current.target, draftRevision: revision } }
            : current,
        );
        setDirty(false);
        setConflict((current) => (current?.panelId === targetPanelId ? null : current));
      }

      const publishResult = await api("/api/panels/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          panelId: targetPanelId,
          deviceId: targetDeviceId,
          expectedRevision: revision,
          activate,
        }),
      });

      if (selectedId.current !== targetPanelId) return;

      if (selectedDeviceIdRef.current === targetDeviceId) {
        accessRequestSeq.current += 1;
        legacyFallbackSeqRef.current += 1;
      }

      const publishedVersionId =
        typeof publishResult?.revision === "string" && publishResult.revision.startsWith("online:")
          ? publishResult.revision.slice("online:".length)
          : null;

      if (activate && publishedVersionId) {
        devicesRequestSeq.current += 1;
        setDevices((current) =>
          current.map((item) =>
            item.id === targetDeviceId
              ? {
                  ...item,
                  activePanelId: targetPanelId,
                  activePanelVersionId: publishedVersionId,
                }
              : item,
          ),
        );
      }
      if (
        publishedVersionId &&
        selectedDeviceIdRef.current === targetDeviceId &&
        accessDeviceRef.current === targetDeviceId
      ) {
        setAccess((current) => {
          const rest = current.filter((entry) => entry.panelId !== targetPanelId);
          return [...rest, { panelId: targetPanelId, versionId: publishedVersionId }];
        });
        setAccessError("");
      }

      setConflict((current) => (current?.panelId === targetPanelId ? null : current));
      pendingFocusAfterPublishRef.current = publishReturnFocusRef.current;
      setPublishDialog({ open: false, target: null, mode: null, error: "" });
      setNotice(
        activate
          ? `Publicação enviada para exibição em "${targetDeviceName}". Aguardando confirmação de aplicação pelo dispositivo.`
          : `Publicação disponibilizada em "${targetDeviceName}", sem alterar o painel exibido.`,
      );

      const devicesRes = await refreshDevices();
      if (selectedDeviceIdRef.current === targetDeviceId) {
        await syncDeviceAccess(targetDeviceId);
        const refreshedTarget = devicesRes.ok
          ? devicesRes.devices.find((item) => item.id === targetDeviceId)
          : undefined;
        if (refreshedTarget && !refreshedTarget.activePanelId) {
          await syncLegacyFallback(targetDeviceId);
        }
      }
    } catch (failure) {
      if (selectedId.current !== targetPanelId) return;
      if (savedInStep) {
        const partial = formatPartialPublishFailure({
          savedRevision: revision,
          deviceName: targetDeviceName,
          failure,
        });
        if (partial.isConflict) {
          setConflict({ panelId: targetPanelId, message: partial.message });
          setPublishDialog((current) => ({ ...current, error: "" }));
        } else {
          setPublishDialog((current) => ({ ...current, error: partial.message }));
        }
        setError(partial.message);
        if (partial.uncertainOutcome) {
          await refreshDevices();
        }
      } else if (isConflictError(failure)) {
        const conflictMsg =
          "Este painel foi alterado em outra sessão ou dispositivo antes da publicação (conflito de revisão). Suas alterações locais foram preservadas; recarregue o painel antes de publicar novamente.";
        setConflict({ panelId: targetPanelId, message: conflictMsg });
        setPublishDialog((current) => ({ ...current, error: "" }));
        setError(conflictMsg);
      } else {
        const msg =
          failure instanceof EditorApiError && failure.status >= 400 && failure.status < 500
            ? failure.message
            : `Falha sem confirmação ao publicar para "${targetDeviceName}": ${failure instanceof Error ? failure.message : "erro de rede"}. Atualize os dispositivos para conferir o estado antes de tentar novamente.`;
        setPublishDialog((current) => ({ ...current, error: msg }));
        setError(msg);
        if (!(failure instanceof EditorApiError && failure.status >= 400 && failure.status < 500)) {
          await refreshDevices();
        }
      }
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  function openPublishDialog(
    initialMode: PublishMode | null = null,
    triggerElement: HTMLElement | null = null,
  ) {
    if (!state || operation.current || loading || signingOutRef.current) return;
    publishReturnFocusRef.current = triggerElement ?? publishButtonRef.current;
    postCloseFocusRef.current = null;
    const currentDevice = devices.find((device) => device.id === deviceId) ?? null;
    setPublishDialog({
      open: true,
      target: {
        panelId: state.id,
        panelName: editingPanelLabel ?? state.name,
        draftRevision: state.draftRevision,
        deviceId: currentDevice ? currentDevice.id : null,
        deviceName: currentDevice ? formatDeviceDisplayName(currentDevice, devices) : null,
      },
      mode: initialMode,
      error: "",
    });
  }

  async function removeAccess(id: string) {
    if (operation.current || !deviceId || signingOutRef.current) return;
    const targetDeviceId = deviceId;
    operation.current = true;
    setBusy("Atualizando permissões…");
    setError("");
    try {
      await api("/api/devices/panels", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: targetDeviceId, panelId: id }),
      });
      await syncDeviceAccess(targetDeviceId);
      setNotice("Acesso removido das opções deste dispositivo; o painel e exibições ativas não foram alterados.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Falha ao atualizar permissões.");
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  async function upload(files: FileList | null) {
    if (!files || operation.current || signingOutRef.current) return;
    operation.current = true;
    const batch = Array.from(files);
    setPhotoUploadStatus(`Enviando ${batch.length} ${batch.length === 1 ? "foto" : "fotos"}…`);
    setBusy("Enviando fotos…");
    setError("");
    const failures: string[] = [];
    let successes = 0;
    try {
      for (const file of batch) {
        if (file.size > 12 * 1024 ** 2) {
          failures.push(`${file.name}: excede 12 MB`);
          continue;
        }
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          failures.push(`${file.name}: formato não aceito`);
          continue;
        }
        const form = new FormData();
        form.set("photo", file);
        setPhotoUploadStatus(`Enviando ${file.name}…`);
        let added: Photo;
        try {
          added = await api("/api/photos", { method: "POST", body: form });
        } catch (failure) {
          failures.push(
            `${file.name}: ${failure instanceof Error ? failure.message : "falha no envio"}`,
          );
          continue;
        }
        setPhotos((current) => [{ ...added }, ...current.filter((photo) => photo.id !== added.id)]);
        successes++;
      }
      if (successes) {
        await refreshPhotos().catch(() => undefined);
        setNotice(
          `${successes} ${successes === 1 ? "foto enviada" : "fotos enviadas"}. Selecione as que estiverem prontas para incluí-las no rascunho.`,
        );
      }
      if (failures.length) setError(`Alguns arquivos não foram enviados: ${failures.join("; ")}`);
    } finally {
      operation.current = false;
      setBusy("");
      setPhotoUploadStatus("");
    }
  }

  async function pair() {
    if (operation.current || signingOutRef.current) return;
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

  async function revoke(device: Device): Promise<{ ok: boolean; error?: string }> {
    if (operation.current || signingOutRef.current)
      return { ok: false, error: "Há outra operação em andamento." };
    operation.current = true;
    setBusy("Desvinculando…");
    setError("");
    try {
      devicesRequestSeq.current += 1;
      await api(`/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
      devicesRequestSeq.current += 1;
      setDevices((current) => current.filter((item) => item.id !== device.id));
      if (selectedDeviceIdRef.current === device.id) {
        selectedDeviceIdRef.current = "";
        accessRequestSeq.current += 1;
        legacyFallbackSeqRef.current += 1;
        accessDeviceRef.current = "";
        setDeviceId("");
        setAccess([]);
        setAccessDevice("");
        setAccessError("");
        setLegacyFallback(null);
      }
      setNotice(`Dispositivo "${formatDeviceDisplayName(device, devices)}" desvinculado; credenciais revogadas.`);
      return { ok: true };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Falha ao desvincular.";
      setError(message);
      return { ok: false, error: message };
    } finally {
      operation.current = false;
      setBusy("");
    }
  }

  const widget = (key: DashboardWidgetKey, enabled: boolean) => {
    if (config.pages && config.pages.length > 0) {
      const current = resolvedPage.enabledWidgets;
      if (!enabled && current.length <= 1 && current.includes(key)) return;
      const nextEnabled = enabled
        ? [...new Set([...current, key])]
        : current.filter((item) => item !== key);
      const filteredStack = activeSmartStack.widgets.filter((item) => nextEnabled.includes(item));
      updateActiveScope(() => ({
        enabledWidgets: nextEnabled,
        ...(resolvedPage.smartStack
          ? { smartStack: { ...activeSmartStack, widgets: filteredStack } }
          : {}),
      }));
      return;
    }
    change({
      ...config,
      widgets: { ...config.widgets, [key]: { ...config.widgets[key], enabled } },
    });
  };
  const movePhoto = (_id: string, index: number, delta: number) => {
    const ids = movePhotoSelection(config.widgets.photos.photoIds, index, delta);
    if (ids === config.widgets.photos.photoIds) return;
    change({
      ...config,
      widgets: { ...config.widgets, photos: { ...config.widgets.photos, photoIds: ids } },
    });
    const moved = photos.find((photo) => photo.id === _id);
    setPhotoAnnouncement(
      moved
        ? `${moved.filename} movida para a posição ${index + delta + 1} de ${ids.length}.`
        : "Ordem atualizada.",
    );
  };
  const controlsDisabled = !!effectiveBusy || loading || !state;
  const widgetChecked = (key: DashboardWidgetKey) =>
    config.pages && config.pages.length > 0
      ? resolvedPage.enabledWidgets.includes(key)
      : config.widgets[key].enabled;
  const widgetToggleDisabled = (key: DashboardWidgetKey) =>
    controlsDisabled ||
    Boolean(
      config.pages &&
      config.pages.length > 0 &&
      resolvedPage.enabledWidgets.length <= 1 &&
      resolvedPage.enabledWidgets.includes(key),
    );
  const selectedPhotoIds = config.widgets.photos.photoIds;
  const readyPhotoIdSet = useMemo(() => new Set(readyPhotos.map((photo) => photo.id)), [readyPhotos]);
  const unreadyPhotoCount = useMemo(
    () => selectedPhotoIds.filter((id) => !readyPhotoIdSet.has(id)).length,
    [selectedPhotoIds, readyPhotoIdSet],
  );
  const draftStatus = deriveDraftStatus({
    hasPanel: Boolean(state),
    dirty,
    draftRevision: state?.draftRevision ?? null,
  });
  const activeConflictMessage =
    conflict && conflict.panelId === state?.id ? conflict.message : null;
  const resolvedLegacyFallback: LegacyFallbackStatus = !selectedDevice
    ? { status: "idle", publishedRevision: null }
    : selectedDevice.activePanelId
      ? { status: "idle", publishedRevision: null }
      : legacyFallback && legacyFallback.deviceId === selectedDevice.id
        ? { status: legacyFallback.status, publishedRevision: legacyFallback.publishedRevision }
        : { status: "loading", publishedRevision: null };
  const publicationState = derivePublicationState({
    editingPanelId: state?.id ?? null,
    editingPanelName: editingPanelLabel ?? state?.name ?? null,
    dirty,
    selectedDevice,
    activePanelName: activePanelLabel ?? activePanel?.name ?? null,
    availablePanels:
      selectedDevice && accessDevice === selectedDevice.id && !accessError ? access : [],
    accessLoaded: Boolean(selectedDevice && accessDevice === selectedDevice.id && !accessError),
    legacyFallback: resolvedLegacyFallback,
  });
  const validationForDialog = useMemo(() => {
    if (!state) return null;
    if (Object.keys(numericIssues).length) {
      return `Corrija os campos numéricos: ${Object.keys(numericIssues)
        .map((id) => id.replaceAll(".", " "))
        .join(", ")}.`;
    }
    const parsed = onlineDashboardSchema.safeParse(config);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return `Confira as configurações antes de publicar: ${issue.path.join(" → ")} — ${issue.message}.`;
    }
    return null;
  }, [state, numericIssues, config]);
  const numericError = Object.keys(numericIssues).length
    ? `Corrija os campos numéricos: ${Object.keys(numericIssues)
        .map((id) => id.replaceAll(".", " "))
        .join(", ")}.`
    : "";
  const operationError =
    error.startsWith("Corrija o campo ") || error.startsWith("Corrija os campos numéricos:")
      ? ""
      : error;
  const feedbackError = [operationError, numericError].filter(Boolean).join(" ");

  return (
    <main className="online-editor">
      <div className="online-title">
        <div>
          <p className="online-eyebrow">SMARTFRAME ONLINE</p>
          <h1>Meus painéis</h1>
          <p>Crie seus painéis e escolha qual exibir em cada dispositivo.</p>
        </div>
        <div className="online-editor-heading-actions">
          <span className={`online-draft-status${dirty ? " is-dirty" : ""}`}>
            {draftStatus.label}
            {draftStatus.detail ? ` · ${draftStatus.detail}` : ""}
          </span>
          <label>
            Dispositivo
            <select
              ref={deviceSelectRef}
              disabled={!!effectiveBusy || loading}
              value={deviceId}
              onChange={(event) => chooseDevice(event.target.value)}
            >
              <option value="">Selecione um dispositivo</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {formatDeviceDisplayName(device, devices)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="online-panel-actions">
        <label>
          Painel em edição
          <select
            disabled={!!effectiveBusy || loading}
            value={panelId}
            onChange={(event) => choosePanel(event.target.value)}
          >
            <option value="">Selecione um painel</option>
            {panels.map((panel) => (
              <option key={panel.id} value={panel.id}>
                {formatPanelDisplayName(panel, panels)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="online-primary"
          disabled={!!effectiveBusy || loading}
          onClick={() => void managePanel("create")}
        >
          Criar painel
        </button>
        <details className="online-secondary-actions">
          <summary>Ações do painel</summary>
          <div>
            <button
              disabled={!!effectiveBusy || loading || !state}
              onClick={() => void managePanel("duplicate")}
            >
              Duplicar
            </button>
            <button
              disabled={!!effectiveBusy || loading || !state}
              onClick={() => void managePanel("rename")}
            >
              Renomear
            </button>
            <button
              className="online-danger"
              disabled={!!effectiveBusy || loading || !state}
              onClick={() => void managePanel("delete")}
            >
              Excluir
            </button>
            {dirty && state && (
              <small className="online-secondary-hint">
                Duplicar usa a última versão salva no servidor.
              </small>
            )}
          </div>
        </details>
      </div>
      <DeviceManager
        open={devicesAreaOpen}
        onToggleOpen={setDevicesAreaOpen}
        devices={devices}
        devicesStatus={listStatus.devices}
        selectedDevice={selectedDevice}
        panels={panels}
        editingPanel={state ? { id: state.id, name: editingPanelLabel ?? state.name } : null}
        access={access}
        accessDeviceId={accessDevice}
        accessError={accessError}
        legacyFallback={resolvedLegacyFallback}
        pairing={pairing}
        busy={effectiveBusy}
        loadingPanel={loading}
        pairingButtonRef={pairingButtonRef}
        onRetryDevices={() => {
          setError("");
          setListStatus((s) => ({ ...s, devices: "loading" }));
          void refreshDevices().then((res) => {
            if (!res.ok && !res.stale) {
              setError(res.error);
              setListStatus((s) => ({ ...s, devices: "error" }));
            }
          });
        }}
        onRefreshDevices={() => {
          setError("");
          const currentDevice = selectedDeviceIdRef.current;
          setLegacyFallback((current) =>
            current && current.deviceId === currentDevice && current.status === "error"
              ? null
              : current,
          );
          void refreshDevices().then((res) => {
            if (!res.ok) {
              if (!res.stale) setError(res.error);
              return;
            }
            if (!currentDevice || selectedDeviceIdRef.current !== currentDevice) {
              return;
            }
            const updatedDevice = res.devices.find((item) => item.id === currentDevice);
            if (!updatedDevice) return;
            void syncDeviceAccess(currentDevice);
            if (!updatedDevice.activePanelId) {
              void syncLegacyFallback(currentDevice);
            }
          });
        }}
        onRetryAccess={(id) => {
          setAccessError("");
          void syncDeviceAccess(id);
        }}
        onOpenPublishAvailable={(trigger) => openPublishDialog("available", trigger ?? null)}
        onRemoveAccess={(id) => void removeAccess(id)}
        onGeneratePairing={() => void pair()}
        onDismissPairing={() => setPairing(null)}
        onRevokeDevice={revoke}
      />
      <EditorFeedback error={feedbackError} notice={notice} />
      {listStatus.panels === "loading" && <p className="online-empty">Carregando painéis…</p>}
      {listStatus.panels === "error" && (
        <div className="online-error">
          Não foi possível carregar painéis.{" "}
          <button
            onClick={() => {
              setError("");
              setListStatus((s) => ({ ...s, panels: "loading" }));
              void refreshPanels().catch((failure) => {
                setError(failure.message);
                setListStatus((s) => ({ ...s, panels: "error" }));
              });
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {listStatus.panels === "ready" && !panels.length && (
        <p className="online-empty">Nenhum painel criado. Use “Criar painel” para começar.</p>
      )}
      {!panelId ? (
        <p className="online-empty">Crie ou selecione um painel para editar.</p>
      ) : loading ? (
        <p className="online-empty">Carregando painel…</p>
      ) : !state ? (
        <p className="online-error">
          O painel não pôde ser carregado. Verifique a conexão e selecione novamente para tentar.
        </p>
      ) : (
        <>
          <EditorActionBar
            panelName={editingPanelLabel ?? state.name}
            deviceName={selectedDeviceLabel}
            draftStatus={draftStatus}
            publicationState={publicationState}
            conflictMessage={activeConflictMessage}
            busy={effectiveBusy}
            controlsDisabled={controlsDisabled}
            publishButtonRef={publishButtonRef}
            onSaveDraft={() => void saveDraft()}
            onOpenPublish={() => openPublishDialog(null)}
            onReloadPanel={() => void reloadCurrentPanel()}
          />
          <div className="online-grid">
          <div className="mobile-preview-switch" role="group" aria-label="Alternar área do editor">
            <button
              type="button"
              aria-pressed={mobilePane === "configure"}
              onClick={() => setMobilePane("configure")}
            >
              Configurar
            </button>
            <button
              type="button"
              aria-pressed={mobilePane === "preview"}
              onClick={() => setMobilePane("preview")}
            >
              Visualizar
            </button>
          </div>
          <section className={`online-controls mobile-pane-${mobilePane}`}>
            {effectiveBusy && <p className="online-busy">{effectiveBusy}</p>}
            <EditorSectionNavigation value={editorSection} onChange={setEditorSection} />
            <div className="online-editor-section" hidden={editorSection !== "photos"}>
              <fieldset disabled={controlsDisabled}>
                <legend>Fotos</legend>
                {listStatus.photos === "loading" && (
                  <p className="online-empty">Carregando fotos…</p>
                )}
                {listStatus.photos === "error" && (
                  <p className="online-error">
                    Não foi possível carregar fotos.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setError("");
                        setListStatus((s) => ({ ...s, photos: "loading" }));
                        void refreshPhotos().catch((failure) => {
                          setError(failure.message);
                          setListStatus((s) => ({ ...s, photos: "error" }));
                        });
                      }}
                    >
                      Tentar novamente
                    </button>
                  </p>
                )}
                {listStatus.photos === "ready" && photos.length === 0 && (
                  <p className="online-empty">
                    Ainda não há fotos. Adicione arquivos para usá-los no painel.
                  </p>
                )}
                <PhotoLibrary
                  photos={photos}
                  selectedIds={selectedPhotoIds}
                  disabled={controlsDisabled}
                  uploadBusy={photoUploadStatus}
                  inputRef={photoInput}
                  onUpload={(files) => void upload(files)}
                  onToggle={(photo, selected) => {
                    const result = selected
                      ? addPhotoSelection(selectedPhotoIds, photo.id)
                      : { ids: removePhotoSelection(selectedPhotoIds, photo.id), reason: null };
                    if (result.reason === "limit") {
                      setPhotoAnnouncement("O painel já atingiu o limite de 100 fotos.");
                      return;
                    }
                    if (result.reason === "duplicate") return;
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        photos: { ...config.widgets.photos, photoIds: result.ids },
                      },
                    });
                    setPhotoAnnouncement(
                      selected
                        ? `${photo.filename} adicionada ao rascunho.`
                        : `${photo.filename} retirada somente deste painel.`,
                    );
                  }}
                  onRemove={(id) => {
                    const photo = photos.find((item) => item.id === id);
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        photos: {
                          ...config.widgets.photos,
                          photoIds: removePhotoSelection(selectedPhotoIds, id),
                        },
                      },
                    });
                    setPhotoAnnouncement(
                      `${photo?.filename ?? "Foto"} retirada somente deste painel.`,
                    );
                  }}
                  onMove={movePhoto}
                />
                {photoAnnouncement && (
                  <p
                    className="online-callout photo-selection-status"
                    role="status"
                    aria-live="polite"
                  >
                    {photoAnnouncement}
                  </p>
                )}
                <ValidatedNumberField
                  id="photos.interval"
                  label="Troca de foto (segundos)"
                  value={config.widgets.photos.intervalSeconds}
                  min={5}
                  max={3600}
                  onInvalidChange={setNumericIssue}
                  onChange={(intervalSeconds) =>
                    change({
                      ...config,
                      widgets: {
                        ...config.widgets,
                        photos: { ...config.widgets.photos, intervalSeconds },
                      },
                    })
                  }
                />
                <label>
                  Ajuste da imagem
                  <select
                    value={config.widgets.photos.fit}
                    aria-describedby="photos-fit-help"
                    onChange={(event) =>
                      event.target.value !== "" &&
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
                <small id="photos-fit-help" className="field-help">
                  Preencher ocupa toda a área e pode cortar as bordas da foto. Conter mostra a
                  imagem inteira; se as proporções forem diferentes, podem sobrar áreas com a cor de
                  fundo.
                </small>
              </fieldset>
              {photoPollExpired && (
                <div className="online-callout">
                  O processamento continua pendente após 90 segundos.
                  <button
                    disabled={!!effectiveBusy}
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
            </div>
            <div className="online-editor-section" hidden={editorSection !== "widgets"}>
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
                  <div className="widget-choice" key={key}>
                    <label className="online-toggle">
                      <input
                        type="checkbox"
                        disabled={widgetToggleDisabled(key)}
                        checked={widgetChecked(key)}
                        onChange={(event) => widget(key, event.target.checked)}
                      />
                      {label}
                    </label>
                    <small>
                      {key === "clock"
                        ? "Hora atual e formato do relógio."
                        : key === "weather"
                          ? "Condições do clima para a cidade escolhida."
                          : key === "currencies"
                            ? "Cotações indicativas dos pares configurados."
                            : "Calendário mensal e destaque do dia."}
                    </small>
                  </div>
                ))}
                <div className="widget-choice">
                  <label className="online-toggle">
                    <input
                      type="checkbox"
                      disabled={widgetToggleDisabled("photos")}
                      checked={widgetChecked("photos")}
                      onChange={(event) => widget("photos", event.target.checked)}
                    />
                    Fotos
                  </label>
                  <small>Escolha a biblioteca e a ordem na seção Fotos.</small>
                </div>
                <details className="online-advanced">
                  <summary>Relógio — opções</summary>
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
                </details>
                <details className="online-advanced">
                  <summary>Clima — opções</summary>
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
                </details>
                <details className="online-advanced">
                  <summary>Moedas — opções</summary>
                  <fieldset>
                    <legend>Pares de moedas ({config.widgets.currencies.pairs.length}/20)</legend>
                    <label>
                      Moeda de origem
                      <select
                        value={currencyBase}
                        onChange={(event) => {
                          setCurrencyBase(event.target.value);
                          if (event.target.value === currencyTarget)
                            setCurrencyTarget(currencyBase);
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
                        config.widgets.currencies.pairs.includes(
                          `${currencyBase}/${currencyTarget}`,
                        )
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
                      Selecione de 1 a 20 pares. Cotações indicativas da Coinbase, consultadas a
                      cada 30 minutos; não são preços de execução.
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
                      Em telas pequenas, a quantidade se adapta ao espaço e os demais pares
                      alternam.
                    </small>
                  </label>
                  <ValidatedNumberField
                    id="currencies.interval"
                    label="Alternar pares a cada (segundos)"
                    value={config.widgets.currencies.intervalSeconds}
                    min={5}
                    max={3600}
                    onInvalidChange={setNumericIssue}
                    onChange={(intervalSeconds) =>
                      change({
                        ...config,
                        widgets: {
                          ...config.widgets,
                          currencies: { ...config.widgets.currencies, intervalSeconds },
                        },
                      })
                    }
                  />
                </details>
                <details className="online-advanced">
                  <summary>Calendário — opções</summary>
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
                </details>
              </fieldset>
              <fieldset disabled={controlsDisabled}>
                <legend>Widgets adicionais</legend>
                <LocalWidgetEditor
                  widgets={config.widgets}
                  checked={widgetChecked}
                  disabled={widgetToggleDisabled}
                  onEnabledChange={widget}
                  onChange={(widgets) => change({ ...config, widgets })}
                  onNumericInvalid={setNumericIssue}
                  onNumericIssuesRemove={clearNumericIssues}
                />
              </fieldset>
            </div>
            <div className="online-editor-section" hidden={editorSection !== "appearance"}>
              <fieldset disabled={controlsDisabled}>
                <legend>Aparência e layout</legend>
                <fieldset>
                  <legend>Galeria de templates prontos</legend>
                  <small>
                    Aplique um visual completo (tema, superfície e distribuição na grade)
                    preservando suas fotos, calendário, notas, tarefas e listas configuradas.
                  </small>
                  <div className="online-template-grid">
                    {panelTemplates.map((template) => (
                      <article key={template.id} className="online-template-card">
                        <strong>{template.name}</strong>
                        <small>{template.description}</small>
                        <div className="online-template-meta">
                          <span>{template.theme === "dark" ? "Escuro" : "Claro"}</span>
                          <span>{template.appearance.preset}</span>
                          <span>{template.enabledWidgets.length} widgets</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            // Templates are applied to one page at a time. Remove pages
                            // while building the template result so inherited page grids
                            // aren't validated against the new root template grid.
                            const templateBase = { ...config };
                            delete templateBase.pages;
                            const templated = applyPanelTemplate(
                              templateBase,
                              template.id as PanelTemplateId,
                            );
                            if (config.pages && config.pages.length > 0) {
                              const targetId = resolvedPage.page?.id ?? config.pages[0].id;
                              const nextEnabled = dashboardWidgetKeys.filter(
                                (key) => templated.widgets[key].enabled,
                              );
                              const nextPages = config.pages.map((page) =>
                                page.id === targetId
                                  ? {
                                      ...page,
                                      enabledWidgets: nextEnabled,
                                      layoutOptions: { ...templated.layoutOptions },
                                      gridLayout: {
                                        enabled: templated.gridLayout!.enabled,
                                        landscape: templated.gridLayout!.landscape.map((item) => ({
                                          ...item,
                                        })),
                                        portrait: templated.gridLayout!.portrait.map((item) => ({
                                          ...item,
                                        })),
                                      },
                                    }
                                  : page,
                              );
                              change({
                                ...config,
                                theme: templated.theme,
                                appearance: templated.appearance,
                                pages: nextPages,
                                widgets: syncGlobalWidgetsFromPages(config.widgets, nextPages),
                              });
                            } else {
                              change(templated);
                            }
                            setNotice(`Template "${template.name}" aplicado ao rascunho.`);
                          }}
                        >
                          Aplicar template
                        </button>
                      </article>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Múltiplas páginas e Smart Stack</legend>
                  <label>
                    Estrutura do painel
                    <select
                      disabled={controlsDisabled}
                      value={config.pages?.length ? "multi" : "single"}
                      onChange={(event) => {
                        if (event.target.value === "multi") {
                          const firstPage = createDashboardPage(config, 0, "Principal");
                          const nextConfig = {
                            ...config,
                            pages: [firstPage],
                            pageSettings: currentPageSettings,
                          };
                          change(nextConfig);
                          changeActivePage(firstPage.id, nextConfig);
                          return;
                        }
                        const enabledSet = new Set(resolvedPage.enabledWidgets);
                        const nextWidgets = setWidgetEnabled(config.widgets, (key) =>
                          enabledSet.has(key),
                        );
                        const nextConfig: OnlineDashboard = {
                          ...config,
                          widgets: nextWidgets,
                          layoutOptions: resolvedPage.layoutOptions,
                          gridLayout: resolvedPage.gridLayout,
                          smartStack: resolvedPage.smartStack,
                        };
                        delete nextConfig.pages;
                        delete nextConfig.pageSettings;
                        if (nextConfig.rules) {
                          const filteredRules = nextConfig.rules.filter(
                            (rule) => rule.action.type !== "goto_page",
                          );
                          if (filteredRules.length) nextConfig.rules = filteredRules;
                          else delete nextConfig.rules;
                        }
                        change(nextConfig);
                        changeActivePage("", nextConfig);
                      }}
                    >
                      <option value="single">Página única (padrão)</option>
                      <option value="multi">Múltiplas páginas (até 8 páginas)</option>
                    </select>
                  </label>
                  {config.pages && config.pages.length > 0 && (
                    <>
                      <div className="online-pages-bar">
                        {config.pages.map((page, index) => {
                          const isCurrent = page.id === resolvedPage.page?.id;
                          return (
                            <button
                              key={page.id}
                              type="button"
                              className={
                                isCurrent ? "online-page-tab is-active" : "online-page-tab"
                              }
                              onClick={() => changeActivePage(page.id)}
                            >
                              {index + 1}. {page.title || `Página ${index + 1}`}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          disabled={controlsDisabled || config.pages.length >= 8}
                          onClick={() => {
                            const nextPage = createDashboardPage(config, config.pages!.length);
                            const nextPages = [...config.pages!, nextPage];
                            const nextConfig = {
                              ...config,
                              pages: nextPages,
                              widgets: syncGlobalWidgetsFromPages(config.widgets, nextPages),
                            };
                            change(nextConfig);
                            changeActivePage(nextPage.id, nextConfig);
                          }}
                        >
                          + Nova página
                        </button>
                      </div>
                      <label>
                        Título da página atual
                        <input
                          type="text"
                          maxLength={40}
                          disabled={controlsDisabled}
                          value={resolvedPage.page?.title ?? ""}
                          onChange={(event) => {
                            const nextTitle = event.target.value;
                            const targetId = resolvedPage.page?.id ?? config.pages![0].id;
                            change({
                              ...config,
                              pages: config.pages!.map((page) =>
                                page.id === targetId ? { ...page, title: nextTitle } : page,
                              ),
                            });
                          }}
                          onBlur={() => {
                            const targetId = resolvedPage.page?.id ?? config.pages![0].id;
                            const targetIndex = config.pages!.findIndex((p) => p.id === targetId);
                            if (targetIndex === -1) return;
                            const trimmed = config.pages![targetIndex].title.trim();
                            if (!trimmed) {
                              change({
                                ...config,
                                pages: config.pages!.map((page, index) =>
                                  page.id === targetId
                                    ? { ...page, title: `Página ${index + 1}` }
                                    : page,
                                ),
                              });
                            }
                          }}
                        />
                      </label>
                      <div>
                        <button
                          type="button"
                          disabled={controlsDisabled || config.pages.length <= 1}
                          onClick={() => {
                            const targetId = resolvedPage.page?.id ?? config.pages![0].id;
                            const remaining = config.pages!.filter((page) => page.id !== targetId);
                            if (remaining.length === 0) return;
                            const remainingIds = new Set(remaining.map((page) => page.id));
                            const filteredRules = config.rules?.filter(
                              (rule) =>
                                rule.action.type !== "goto_page" ||
                                remainingIds.has(rule.action.pageId),
                            );
                            const nextConfig: OnlineDashboard = {
                              ...config,
                              pages: remaining,
                              widgets: syncGlobalWidgetsFromPages(config.widgets, remaining),
                            };
                            if (filteredRules?.length) nextConfig.rules = filteredRules;
                            else delete nextConfig.rules;
                            change(nextConfig);
                            changeActivePage(remaining[0].id, nextConfig);
                          }}
                        >
                          Remover página atual
                        </button>
                      </div>
                      <div className="online-page-widgets-grid">
                        {dashboardWidgetKeys.map((widgetKey) => {
                          const checked = resolvedPage.enabledWidgets.includes(widgetKey);
                          return (
                            <label key={widgetKey} className="online-check">
                              <input
                                type="checkbox"
                                disabled={
                                  controlsDisabled ||
                                  (checked && resolvedPage.enabledWidgets.length <= 1)
                                }
                                checked={checked}
                                onChange={(event) => {
                                  const nextWidgets = event.target.checked
                                    ? [...new Set([...resolvedPage.enabledWidgets, widgetKey])]
                                    : resolvedPage.enabledWidgets.filter(
                                        (item) => item !== widgetKey,
                                      );
                                  const filteredStack = activeSmartStack.widgets.filter((item) =>
                                    nextWidgets.includes(item),
                                  );
                                  updateActiveScope(() => ({
                                    enabledWidgets: nextWidgets,
                                    ...(resolvedPage.smartStack
                                      ? {
                                          smartStack: {
                                            ...activeSmartStack,
                                            widgets: filteredStack,
                                          },
                                        }
                                      : {}),
                                  }));
                                }}
                              />
                              <span>{gridWidgetCatalog[widgetKey].label}</span>
                            </label>
                          );
                        })}
                      </div>
                      <label>
                        Rotação automática entre páginas
                        <select
                          disabled={controlsDisabled}
                          value={String(currentPageSettings.autoRotateSeconds)}
                          onChange={(event) =>
                            updatePageSettings({
                              autoRotateSeconds: Number(event.target.value),
                            })
                          }
                        >
                          {![0, 5, 10, 15, 20, 30, 45, 60, 120, 300, 600].includes(
                            currentPageSettings.autoRotateSeconds,
                          ) && (
                            <option value={String(currentPageSettings.autoRotateSeconds)}>
                              {currentPageSettings.autoRotateSeconds}s (personalizado)
                            </option>
                          )}
                          <option value="0">Desativada (manual)</option>
                          <option value="5">A cada 5 segundos</option>
                          <option value="10">A cada 10 segundos</option>
                          <option value="15">A cada 15 segundos</option>
                          <option value="20">A cada 20 segundos</option>
                          <option value="30">A cada 30 segundos</option>
                          <option value="45">A cada 45 segundos</option>
                          <option value="60">A cada 1 minuto</option>
                          <option value="120">A cada 2 minutos</option>
                          <option value="300">A cada 5 minutos</option>
                          <option value="600">A cada 10 minutos</option>
                        </select>
                      </label>
                      <label className="online-check">
                        <input
                          type="checkbox"
                          disabled={controlsDisabled}
                          checked={currentPageSettings.showIndicators}
                          onChange={(event) =>
                            updatePageSettings({ showIndicators: event.target.checked })
                          }
                        />
                        <span>Mostrar barra de páginas na tela</span>
                      </label>
                      <label className="online-check">
                        <input
                          type="checkbox"
                          disabled={controlsDisabled}
                          checked={currentPageSettings.swipeEnabled}
                          onChange={(event) =>
                            updatePageSettings({ swipeEnabled: event.target.checked })
                          }
                        />
                        <span>Permitir alternar páginas deslizando na horizontal (swipe)</span>
                      </label>
                    </>
                  )}
                  <label className="online-check">
                    <input
                      type="checkbox"
                      disabled={controlsDisabled}
                      checked={activeSmartStack.enabled}
                      onChange={(event) => updateSmartStack({ enabled: event.target.checked })}
                    />
                    <span>Ativar Smart Stack (pilha rotativa no mesmo espaço da grade)</span>
                  </label>
                  {activeSmartStack.enabled && (
                    <>
                      <label>
                        Título do Smart Stack
                        <input
                          type="text"
                          maxLength={40}
                          disabled={controlsDisabled}
                          value={activeSmartStack.title}
                          onChange={(event) => updateSmartStack({ title: event.target.value })}
                          onBlur={() => {
                            if (!activeSmartStack.title.trim()) {
                              updateSmartStack({ title: "Smart Stack" });
                            }
                          }}
                        />
                      </label>
                      <label>
                        Intervalo de rotação do Smart Stack
                        <select
                          disabled={controlsDisabled}
                          value={String(activeSmartStack.intervalSeconds)}
                          onChange={(event) =>
                            updateSmartStack({ intervalSeconds: Number(event.target.value) })
                          }
                        >
                          {![0, 5, 10, 15, 20, 30, 45, 60, 120, 300, 600].includes(
                            activeSmartStack.intervalSeconds,
                          ) && (
                            <option value={String(activeSmartStack.intervalSeconds)}>
                              {activeSmartStack.intervalSeconds}s (personalizado)
                            </option>
                          )}
                          <option value="0">Manual (sem rotação automática)</option>
                          <option value="5">A cada 5 segundos</option>
                          <option value="10">A cada 10 segundos</option>
                          <option value="15">A cada 15 segundos</option>
                          <option value="20">A cada 20 segundos</option>
                          <option value="30">A cada 30 segundos</option>
                          <option value="45">A cada 45 segundos</option>
                          <option value="60">A cada 1 minuto</option>
                          <option value="120">A cada 2 minutos</option>
                          <option value="300">A cada 5 minutos</option>
                          <option value="600">A cada 10 minutos</option>
                        </select>
                      </label>
                      <label className="online-check">
                        <input
                          type="checkbox"
                          disabled={controlsDisabled}
                          checked={activeSmartStack.showIndicators}
                          onChange={(event) =>
                            updateSmartStack({ showIndicators: event.target.checked })
                          }
                        />
                        <span>Mostrar controles e indicadores do Smart Stack</span>
                      </label>
                      <small>
                        Widgets na pilha ({activeSmartStack.widgets.length}/12 selecionados):
                      </small>
                      <div className="online-smart-stack-list">
                        {activeSmartStack.widgets.map((widgetKey, stackIndex) => (
                          <div key={widgetKey} className="online-smart-stack-row">
                            <label className="online-check">
                              <input
                                type="checkbox"
                                disabled={controlsDisabled}
                                checked
                                onChange={() =>
                                  updateSmartStack({
                                    widgets: activeSmartStack.widgets.filter(
                                      (item) => item !== widgetKey,
                                    ),
                                  })
                                }
                              />
                              <span>
                                {stackIndex + 1}. {gridWidgetCatalog[widgetKey].label}
                              </span>
                            </label>
                            <div className="online-smart-stack-actions">
                              <button
                                type="button"
                                aria-label={`Subir ${gridWidgetCatalog[widgetKey].label} na pilha`}
                                disabled={controlsDisabled || stackIndex === 0}
                                onClick={() => {
                                  const next = [...activeSmartStack.widgets];
                                  [next[stackIndex - 1], next[stackIndex]] = [
                                    next[stackIndex],
                                    next[stackIndex - 1],
                                  ];
                                  updateSmartStack({ widgets: next });
                                }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`Descer ${gridWidgetCatalog[widgetKey].label} na pilha`}
                                disabled={
                                  controlsDisabled ||
                                  stackIndex === activeSmartStack.widgets.length - 1
                                }
                                onClick={() => {
                                  const next = [...activeSmartStack.widgets];
                                  [next[stackIndex], next[stackIndex + 1]] = [
                                    next[stackIndex + 1],
                                    next[stackIndex],
                                  ];
                                  updateSmartStack({ widgets: next });
                                }}
                              >
                                ↓
                              </button>
                            </div>
                          </div>
                        ))}
                        {dashboardWidgetKeys
                          .filter((widgetKey) => !activeSmartStack.widgets.includes(widgetKey))
                          .map((widgetKey) => (
                            <div key={widgetKey} className="online-smart-stack-row">
                              <label className="online-check">
                                <input
                                  type="checkbox"
                                  disabled={
                                    controlsDisabled || activeSmartStack.widgets.length >= 12
                                  }
                                  checked={false}
                                  onChange={() =>
                                    updateSmartStack({
                                      widgets: [...activeSmartStack.widgets, widgetKey],
                                    })
                                  }
                                />
                                <span>{gridWidgetCatalog[widgetKey].label}</span>
                              </label>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                </fieldset>
                <fieldset>
                  <legend>Disposição do painel e grade livre</legend>
                  <label>
                    Modo de organização dos blocos
                    <select
                      value={
                        (resolvedPage.gridLayout ?? config.gridLayout)?.enabled ? "grid" : "split"
                      }
                      onChange={(event) => {
                        const enableGrid = event.target.value === "grid";
                        change(setGridLayoutEnabled(config, enableGrid, resolvedPage.page?.id));
                      }}
                    >
                      <option value="split">Painel dividido (clássico)</option>
                      <option value="grid">Grade livre modular (arrastar e redimensionar)</option>
                    </select>
                  </label>
                  {(resolvedPage.gridLayout ?? config.gridLayout)?.enabled && (
                    <GridLayoutEditor
                      config={config}
                      pageId={resolvedPage.page?.id}
                      disabled={controlsDisabled}
                      onChange={change}
                    />
                  )}
                </fieldset>
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
                  <legend>Estilo e superfície do painel</legend>
                  <small>
                    Defina um preset visual ou ajuste cantos, espaçamentos, bordas e sombras. Os
                    valores escolhidos aqui valem para todos os widgets, salvo quando sobrepostos
                    individualmente abaixo.
                  </small>
                  <ScopedAppearanceControls
                    scope="global"
                    value={config.appearance}
                    resolved={resolveScopedAppearance(config.appearance)}
                    onPresetChange={(preset) => {
                      const { backgroundColor, accentColor, textColor } = config.appearance;
                      change({
                        ...config,
                        appearance: preset
                          ? { backgroundColor, accentColor, textColor, preset }
                          : { backgroundColor, accentColor, textColor },
                      });
                    }}
                    onFieldChange={(key, next) => {
                      const nextAppearance = { ...config.appearance } as Record<string, unknown>;
                      if (next === null) delete nextAppearance[key];
                      else nextAppearance[key] = next;
                      change({
                        ...config,
                        appearance: nextAppearance as OnlineDashboard["appearance"],
                      });
                    }}
                    onReset={() => {
                      const { backgroundColor, accentColor, textColor } = config.appearance;
                      change({
                        ...config,
                        appearance: { backgroundColor, accentColor, textColor },
                      });
                    }}
                  />
                </fieldset>
                <fieldset>
                  <legend>Fundo e tamanho dos widgets</legend>
                  <small>
                    O tamanho controla o espaço vertical relativo dos cartões principais. A largura
                    das fotos é ajustada separadamente abaixo. O texto acompanha a cor do fundo,
                    exceto se os números do relógio tiverem uma cor personalizada.
                  </small>
                  {(
                    [
                      ["clock", "Relógio", config.theme === "dark" ? "#0b1d30" : "#102a43"],
                      ["weather", "Clima", config.appearance.accentColor],
                      ["currencies", "Cotações", "#222326"],
                      ["calendar", "Calendário", config.theme === "dark" ? "#1d3045" : "#ffffff"],
                      ["photos", "Fotos", "#26384b"],
                      ["notes", "Recados", config.theme === "dark" ? "#1d3045" : "#ffffff"],
                      [
                        "countdown",
                        "Contagem regressiva",
                        config.theme === "dark" ? "#1d3045" : "#ffffff",
                      ],
                      [
                        "birthdays",
                        "Aniversários",
                        config.theme === "dark" ? "#1d3045" : "#ffffff",
                      ],
                      ["tasks", "Tarefas", config.theme === "dark" ? "#1d3045" : "#ffffff"],
                      ["pomodoro", "Pomodoro", config.theme === "dark" ? "#1d3045" : "#ffffff"],
                      [
                        "system",
                        "Monitor do sistema",
                        config.theme === "dark" ? "#1d3045" : "#ffffff",
                      ],
                      [
                        "worldClock",
                        "Relógio mundial",
                        config.theme === "dark" ? "#1d3045" : "#ffffff",
                      ],
                      ["rss", "Feed RSS", config.theme === "dark" ? "#1d3045" : "#ffffff"],
                      [
                        "devMonitor",
                        "Monitor Dev/IA",
                        config.theme === "dark" ? "#1d3045" : "#ffffff",
                      ],
                      [
                        "controlDeck",
                        "Control Deck",
                        config.theme === "dark" ? "#1d3045" : "#ffffff",
                      ],
                    ] as const
                  ).map(([key, label, fallback]) => {
                    const widgetEntry = config.widgets[key];
                    const background = widgetEntry.backgroundColor || fallback;
                    const colorValue =
                      background.length === 4
                        ? `#${background
                            .slice(1)
                            .split("")
                            .map((character) => character + character)
                            .join("")}`
                        : background;
                    const hasCardSize =
                      key === "clock" ||
                      key === "weather" ||
                      key === "currencies" ||
                      key === "calendar";
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
                                    ...widgetEntry,
                                    backgroundColor: event.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <button
                          type="button"
                          disabled={!widgetEntry.backgroundColor}
                          onClick={() =>
                            change({
                              ...config,
                              widgets: {
                                ...config.widgets,
                                [key]: { ...widgetEntry, backgroundColor: "" },
                              },
                            })
                          }
                        >
                          Usar fundo padrão
                        </button>
                        {hasCardSize && (
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
                        <details className="online-advanced">
                          <summary>Aparência individual (sobrepor painel)</summary>
                          <ScopedAppearanceControls
                            scope="widget"
                            value={widgetEntry.appearance}
                            resolved={resolveScopedAppearance(
                              config.appearance,
                              widgetEntry.appearance,
                            )}
                            hideInnerPadding={key === "photos"}
                            onPresetChange={(preset) => {
                              const nextWidget = { ...widgetEntry };
                              if (preset === null) delete nextWidget.appearance;
                              else nextWidget.appearance = { preset };
                              change({
                                ...config,
                                widgets: { ...config.widgets, [key]: nextWidget },
                              });
                            }}
                            onFieldChange={(fieldKey, next) => {
                              const currentOverride = {
                                ...(widgetEntry.appearance ?? {}),
                              } as Record<string, unknown>;
                              if (next === null) delete currentOverride[fieldKey];
                              else currentOverride[fieldKey] = next;
                              const cleaned = cleanWidgetAppearance(
                                currentOverride as WidgetAppearanceOverride,
                              );
                              const nextWidget = { ...widgetEntry };
                              if (cleaned) nextWidget.appearance = cleaned;
                              else delete nextWidget.appearance;
                              change({
                                ...config,
                                widgets: { ...config.widgets, [key]: nextWidget },
                              });
                            }}
                            onReset={() => {
                              const nextWidget = { ...widgetEntry };
                              delete nextWidget.appearance;
                              change({
                                ...config,
                                widgets: { ...config.widgets, [key]: nextWidget },
                              });
                            }}
                          />
                        </details>
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
                  Proporção da foto · {resolvedPage.layoutOptions.photoWidthPercent}%
                  <input
                    type="range"
                    min="40"
                    max="75"
                    disabled={
                      controlsDisabled ||
                      Boolean((resolvedPage.gridLayout ?? config.gridLayout)?.enabled)
                    }
                    value={resolvedPage.layoutOptions.photoWidthPercent}
                    onChange={(event) =>
                      updateActiveScope((scope) => ({
                        layoutOptions: {
                          ...scope.layoutOptions,
                          photoWidthPercent: Number(event.target.value),
                        },
                      }))
                    }
                  />
                  {(resolvedPage.gridLayout ?? config.gridLayout)?.enabled && (
                    <small>Controlado diretamente na grade livre acima.</small>
                  )}
                </label>
                <label>
                  Posição da foto
                  <select
                    disabled={
                      controlsDisabled ||
                      Boolean((resolvedPage.gridLayout ?? config.gridLayout)?.enabled)
                    }
                    value={resolvedPage.layoutOptions.photoPosition}
                    onChange={(event) =>
                      updateActiveScope((scope) => ({
                        layoutOptions: {
                          ...scope.layoutOptions,
                          photoPosition: event.target.value as "left" | "right",
                        },
                      }))
                    }
                  >
                    <option value="left">Esquerda</option>
                    <option value="right">Direita</option>
                  </select>
                </label>
                <details className="online-advanced">
                  <summary>Opções avançadas do painel</summary>
                  <ValidatedNumberField
                    id="panel.refresh"
                    label="Atualização geral (segundos)"
                    value={config.refreshSeconds}
                    min={10}
                    max={3600}
                    onInvalidChange={setNumericIssue}
                    onChange={(refreshSeconds) => change({ ...config, refreshSeconds })}
                  />
                  <label>
                    Fuso horário
                    <input
                      value={config.timezone}
                      onChange={(event) => change({ ...config, timezone: event.target.value })}
                    />
                  </label>
                </details>
              </fieldset>
            </div>
            <div className="online-editor-section" hidden={editorSection !== "controlDeck"}>
              <ControlDeckEditor
                config={config}
                enabled={widgetChecked("controlDeck")}
                toggleDisabled={widgetToggleDisabled("controlDeck")}
                onEnabledChange={(nextEnabled) => widget("controlDeck", nextEnabled)}
                onChange={change}
                onBindingsChanged={() => setDeckRefreshNonce((prev) => prev + 1)}
                controlsDisabled={controlsDisabled}
                onNotice={setNotice}
                onError={setError}
              />
            </div>
            <div className="online-editor-section" hidden={editorSection !== "automations"}>
              <AutomationsEditor
                config={config}
                onChange={change}
                devices={devices}
                selectedDeviceId={deviceId}
                controlsDisabled={controlsDisabled}
                onNotice={setNotice}
                onError={setError}
              />
            </div>
          </section>
          <section className={`online-preview mobile-pane-${mobilePane}`}>
            <header>
              <strong>Prévia do rascunho</strong>
              <span>{state.name}</span>
            </header>
            <iframe
              ref={frame}
              onLoad={sendPreview}
              src="/player-dashboard/index.html?preview=1"
              title="Prévia do rascunho do painel"
              className={`draft-preview ${config.orientation}`}
            />
            <p className="online-preview-status">
              <strong>{draftStatus.label}</strong> · {publicationState.label}
            </p>
            <small>A prévia é aproximada e pode não reproduzir exatamente todos os tablets.</small>
            {selectedDevice && (
              <small className="online-preview-meta">
                {formatLastCommunication(selectedDevice.lastSeenAt)}
              </small>
            )}
            <details className="online-status-details">
              <summary>Detalhes técnicos de revisão</summary>
              <p>
                Rascunho <code>r{state.draftRevision}</code> · Enviado ao dispositivo{" "}
                <code>{publicationState.sentRevision ?? "—"}</code> · Aplicado{" "}
                <code>{publicationState.appliedRevision ?? "—"}</code>
              </p>
            </details>
          </section>
          </div>
          <PublishDialog
            open={publishDialog.open}
            target={publishDialog.target}
            mode={publishDialog.mode}
            onModeChange={(nextMode) =>
              setPublishDialog((current) => ({ ...current, mode: nextMode }))
            }
            dirty={dirty}
            draftRevision={state.draftRevision}
            hasDevices={devices.length > 0}
            unreadyPhotoCount={unreadyPhotoCount}
            validationError={validationForDialog}
            conflictMessage={activeConflictMessage}
            busy={effectiveBusy}
            dialogError={publishDialog.error}
            returnFocusElementRef={publishReturnFocusRef}
            postCloseFocusRef={postCloseFocusRef}
            onClose={() =>
              setPublishDialog((current) => ({ ...current, open: false, error: "" }))
            }
            onConfirm={(target, mode) => void confirmPublish(target, mode)}
            onGoToPairing={() => {
              setDevicesAreaOpen(true);
              postCloseFocusRef.current = pairingButtonRef.current;
              setPublishDialog((current) => ({ ...current, open: false, error: "" }));
              requestAnimationFrame(() => {
                pairingButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              });
            }}
            onFocusDeviceSelect={() => {
              postCloseFocusRef.current = deviceSelectRef.current;
              setPublishDialog((current) => ({ ...current, open: false, error: "" }));
              requestAnimationFrame(() => {
                deviceSelectRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              });
            }}
          />
        </>
      )}
    </main>
  );
}
