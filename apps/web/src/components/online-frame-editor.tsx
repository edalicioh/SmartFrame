"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalWidgetEditor } from "./local-widget-editor";
import { PhotoLibrary } from "./online-editor/photo-library";
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
type WidgetData = Awaited<ReturnType<typeof import("@smartframe/widgets").onlineWidgetData>>;
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

function EditorSectionNavigation({
  value,
  onChange,
}: {
  value: "photos" | "widgets" | "appearance";
  onChange: (value: "photos" | "widgets" | "appearance") => void;
}) {
  return (
    <nav className="online-section-nav" aria-label="Seções de edição">
      {(
        [
          ["photos", "Fotos"],
          ["widgets", "Widgets"],
          ["appearance", "Aparência"],
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
  const [listStatus, setListStatus] = useState({
    devices: "loading" as ListStatus,
    panels: "loading" as ListStatus,
    photos: "loading" as ListStatus,
  });
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [photoPollExpired, setPhotoPollExpired] = useState(false);
  const [photoPollRetry, setPhotoPollRetry] = useState(0);
  const [widgetData, setWidgetData] = useState<WidgetData | null>(null);
  const [currencyBase, setCurrencyBase] = useState("USD");
  const [currencyTarget, setCurrencyTarget] = useState("BRL");
  const [editorSection, setEditorSection] = useState<"photos" | "widgets" | "appearance">("photos");
  const [mobilePane, setMobilePane] = useState<"configure" | "preview">("configure");
  const [photoAnnouncement, setPhotoAnnouncement] = useState("");
  const [photoUploadStatus, setPhotoUploadStatus] = useState("");
  const [numericIssues, setNumericIssues] = useState<Record<string, string>>({});
  const [activePageId, setActivePageId] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
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
  }, [panelId, widgetSettings]);

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

  const refreshDevices = useCallback(async () => {
    const result = await api("/api/devices");
    setDevices(result.data ?? []);
    setListStatus((current) => ({ ...current, devices: "ready" }));
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
    const load = <T,>(
      key: keyof typeof listStatus,
      request: () => Promise<T>,
      apply: (data: T) => void,
    ) => {
      setListStatus((current) => ({ ...current, [key]: "loading" }));
      request()
        .then((data) => {
          if (active) {
            apply(data);
            setListStatus((current) => ({ ...current, [key]: "ready" }));
          }
        })
        .catch((failure: unknown) => {
          if (active) {
            setListStatus((current) => ({ ...current, [key]: "error" }));
            setError(
              failure instanceof Error ? failure.message : "Não foi possível carregar os dados.",
            );
          }
        });
    };
    load(
      "devices",
      () => api("/api/devices"),
      (result) => setDevices(result.data ?? []),
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
    if (operation.current || loading) return;
    setDeviceId(nextId);
  }
  function choosePanel(nextId: string) {
    if (operation.current || loading) return;
    if (dirty && !window.confirm("Há alterações não salvas. Descartar para trocar de painel?"))
      return;
    selectedId.current = nextId;
    setPanelId(nextId);
    setActivePageId("");
    setNumericIssues({});
    setError("");
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
        setNumericIssues({});
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

  async function save(publish: boolean, activate = true) {
    if (!state || !panelId || (publish && !deviceId) || operation.current) return;
    if (Object.keys(numericIssues).length) {
      setError(
        `Corrija os campos numéricos: ${Object.keys(numericIssues)
          .map((id) => id.replaceAll(".", " "))
          .join(", ")}.`,
      );
      return;
    }
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
  const controlsDisabled = !!busy || loading || !state;
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
  const numericError = Object.keys(numericIssues).length
    ? `Corrija os campos numéricos: ${Object.keys(numericIssues)
        .map((id) => id.replaceAll(".", " "))
        .join(", ")}.`
    : "";
  const feedbackError =
    numericError ||
    (error.startsWith("Corrija o campo ") || error.startsWith("Corrija os campos numéricos:")
      ? ""
      : error);

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
            {dirty
              ? "Alterações não salvas"
              : state
                ? `Rascunho r${state.draftRevision} salvo`
                : "Selecione ou crie um painel"}
          </span>
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
        <button
          className="online-primary"
          disabled={!!busy || loading}
          onClick={() => void managePanel("create")}
        >
          Criar painel
        </button>
        <details className="online-secondary-actions">
          <summary>Ações do painel</summary>
          <div>
            <button
              disabled={!!busy || loading || !state}
              onClick={() => void managePanel("duplicate")}
            >
              Duplicar
            </button>
            <button
              disabled={!!busy || loading || !state}
              onClick={() => void managePanel("rename")}
            >
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
        </details>
      </div>
      <details className="online-secondary-area">
        <summary>Dispositivos, permissões e pareamento</summary>
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
              Somente publicações disponibilizadas aqui podem ser escolhidas no tablet. Rascunhos
              não ficam acessíveis.
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
        {listStatus.devices === "loading" && (
          <p className="online-empty">Carregando dispositivos…</p>
        )}
        {listStatus.devices === "error" && (
          <div className="online-error">
            Não foi possível carregar dispositivos.{" "}
            <button
              onClick={() => {
                setError("");
                setListStatus((s) => ({ ...s, devices: "loading" }));
                void refreshDevices().catch((failure) => {
                  setError(failure.message);
                  setListStatus((s) => ({ ...s, devices: "error" }));
                });
              }}
            >
              Tentar novamente
            </button>
          </div>
        )}
        {listStatus.devices === "ready" && !devices.length && (
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
      </details>
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
            {busy && <p className="online-busy">{busy}</p>}
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
                            const nextConfig = {
                              ...config,
                              pages: remaining,
                              widgets: syncGlobalWidgetsFromPages(config.widgets, remaining),
                            };
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
            <p>
              Rascunho r{state.draftRevision} · Enviado ao dispositivo {publishedRevision ?? "—"} ·
              Aplicado {selectedDevice?.appliedRevision ?? "—"}
            </p>
            <small>A prévia é aproximada e pode não reproduzir exatamente todos os tablets.</small>
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
