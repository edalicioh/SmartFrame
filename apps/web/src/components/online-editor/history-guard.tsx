"use client";

import { useEffect } from "react";

type TraverseGuardHandler = (targetHref: string) => boolean;
type HistoryNavigationDestination = {
  key?: string;
  url?: string;
  getState?: () => unknown;
};
type RestoreTarget = {
  targetStep: number | null;
  targetEpoch: number | null;
  targetUrl: string;
  targetKey: string | null;
  timerId: number | null;
};
type HistoryNavigationEntry = {
  key?: string;
  index?: number;
};
type HistoryNavigationApi = EventTarget & {
  currentEntry?: HistoryNavigationEntry | null;
  traverseTo?: (
    key: string,
  ) => { committed?: Promise<unknown>; finished?: Promise<unknown> } | undefined;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
};

let activeTraverseGuard: TraverseGuardHandler | null = null;
let activeRestore: RestoreTarget | null = null;

function readNumericField(state: unknown, field: "__sfStep" | "__sfEpoch"): number | null {
  if (state && typeof state === "object") {
    const value = (state as Record<string, unknown>)[field];
    if (typeof value === "number") return value;
  }
  return null;
}

function readStep(state: unknown): number | null {
  return readNumericField(state, "__sfStep");
}

function readEpoch(state: unknown): number | null {
  return readNumericField(state, "__sfEpoch");
}

function extractNextInternalState(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object") return {};
  const record = state as Record<string, unknown>;
  const extracted: Record<string, unknown> = {};
  if ("__NA" in record && record.__NA) {
    extracted.__NA = record.__NA;
  }
  if ("__PRIVATE_NEXTJS_INTERNALS_TREE" in record && record.__PRIVATE_NEXTJS_INTERNALS_TREE) {
    extracted.__PRIVATE_NEXTJS_INTERNALS_TREE = record.__PRIVATE_NEXTJS_INTERNALS_TREE;
  }
  return extracted;
}

function splitUrlBase(href: string): { base: string; hash: string } {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) return { base: href, hash: "" };
  return { base: href.slice(0, hashIndex), hash: href.slice(hashIndex) };
}

export function stripUrlFragment(href: string): string {
  return splitUrlBase(href).base;
}

function toRelativeHref(href: string): string {
  const schemeIndex = href.indexOf("://");
  if (schemeIndex === -1) return href;
  const pathIndex = href.indexOf("/", schemeIndex + 3);
  return pathIndex === -1 ? "/" : href.slice(pathIndex);
}

function matchesRestoreTarget(
  restore: RestoreTarget,
  state: unknown,
  href: string,
  navKey: string | null,
): boolean {
  if (restore.targetKey && navKey) return navKey === restore.targetKey;
  const step = readStep(state);
  const epoch = readEpoch(state);
  if (
    restore.targetStep !== null &&
    restore.targetEpoch !== null &&
    step !== null &&
    epoch !== null
  ) {
    return step === restore.targetStep && epoch === restore.targetEpoch;
  }
  return href === restore.targetUrl;
}

/**
 * Registers a guard invoked before the Next App Router processes popstate
 * traversals, preserving forward history without sentinel pushState entries.
 */
export function registerTraverseGuard(handler: TraverseGuardHandler | null) {
  activeTraverseGuard = handler;
}

export function isRestoringTraverseNavigation(
  destination?: HistoryNavigationDestination,
): boolean {
  if (!activeRestore) return false;
  if (activeRestore.targetKey && typeof destination?.key === "string") {
    return destination.key === activeRestore.targetKey;
  }
  if (typeof destination?.getState === "function") {
    const destState = destination.getState();
    const step = readStep(destState);
    const epoch = readEpoch(destState);
    if (
      activeRestore.targetStep !== null &&
      activeRestore.targetEpoch !== null &&
      step !== null &&
      epoch !== null
    ) {
      return step === activeRestore.targetStep && epoch === activeRestore.targetEpoch;
    }
  }
  if (typeof destination?.url === "string") {
    return destination.url === activeRestore.targetUrl;
  }
  return true;
}

export function HistoryGuard() {
  useEffect(() => {
    const nativePushState = window.history.pushState.bind(window.history);
    const nativeReplaceState = window.history.replaceState.bind(window.history);
    const navApi = (window as Window & { navigation?: HistoryNavigationApi }).navigation;

    const readHistoryLength = () =>
      typeof window.history.length === "number" ? window.history.length : null;

    let epochCounter = 1;
    let currentStep: number | null = 1;
    let currentEpoch: number | null = 1;
    let currentUrl = window.location.href;
    let currentState: unknown = window.history.state;
    let currentHistoryLength: number | null = readHistoryLength();
    let lastNextState = extractNextInternalState(window.history.state);
    let lastEntryNavigationType: string | null = null;
    let pendingPopFragment: {
      href: string;
      preStep: number | null;
      preEpoch: number | null;
      preHistoryLength: number | null;
    } | null = null;
    let currentNavKey: string | null = navApi?.currentEntry?.key ?? null;
    let currentNavIndex: number | null =
      typeof navApi?.currentEntry?.index === "number" ? navApi.currentEntry.index : null;

    const syncLastNextState = (state: unknown) => {
      const nextInternal = extractNextInternalState(state);
      if (Object.keys(nextInternal).length > 0) {
        lastNextState = nextInternal;
      }
    };

    const syncNavSnapshot = () => {
      if (!navApi?.currentEntry) return;
      currentNavKey = navApi.currentEntry.key ?? null;
      currentNavIndex =
        typeof navApi.currentEntry.index === "number" ? navApi.currentEntry.index : null;
    };

    const clearActiveRestore = (syncFromHistory: boolean) => {
      if (activeRestore?.timerId !== null && activeRestore?.timerId !== undefined) {
        if (typeof window.clearTimeout === "function") {
          window.clearTimeout(activeRestore.timerId);
        }
      }
      activeRestore = null;
      pendingPopFragment = null;
      if (syncFromHistory) {
        const committedStep = readStep(window.history.state);
        const committedEpoch = readEpoch(window.history.state);
        if (committedStep !== null && committedEpoch !== null) {
          currentStep = committedStep;
          currentEpoch = committedEpoch;
          epochCounter = Math.max(epochCounter, committedEpoch);
        } else {
          currentStep = null;
          currentEpoch = null;
        }
        currentUrl = window.location.href;
        currentState = window.history.state;
        currentHistoryLength = readHistoryLength();
        syncLastNextState(window.history.state);
        syncNavSnapshot();
      }
    };

    const initialStep = readStep(window.history.state);
    const initialEpoch = readEpoch(window.history.state);
    if (initialStep !== null && initialEpoch !== null) {
      currentStep = initialStep;
      currentEpoch = initialEpoch;
      epochCounter = Math.max(epochCounter, initialEpoch);
    } else {
      if (initialStep !== null) {
        currentStep = initialStep;
      }
      const initialState = window.history.state;
      nativeReplaceState(
        {
          ...(initialState && typeof initialState === "object" ? initialState : {}),
          __sfStep: currentStep,
          __sfEpoch: currentEpoch,
        },
        "",
        window.location.href,
      );
      currentState = window.history.state;
      syncLastNextState(window.history.state);
    }

    const withPosition = (data: unknown, step: number, epoch: number) =>
      data && typeof data === "object"
        ? { ...(data as Record<string, unknown>), __sfStep: step, __sfEpoch: epoch }
        : { __sfStep: step, __sfEpoch: epoch };

    const allocateNextPosition = (baseStep: number | null, baseEpoch: number | null) => {
      if (baseStep !== null && baseEpoch !== null) {
        return { nextStep: baseStep + 1, nextEpoch: baseEpoch };
      }
      return { nextStep: 1, nextEpoch: ++epochCounter };
    };

    const stampCurrentFragmentEntry = (
      baseStep: number | null = currentStep,
      baseEpoch: number | null = currentEpoch,
    ) => {
      const { nextStep, nextEpoch } = allocateNextPosition(baseStep, baseEpoch);
      const browserState =
        window.history.state && typeof window.history.state === "object"
          ? (window.history.state as Record<string, unknown>)
          : {};
      nativeReplaceState(
        {
          ...lastNextState,
          ...browserState,
          __sfStep: nextStep,
          __sfEpoch: nextEpoch,
        },
        "",
        window.location.href,
      );
      currentStep = readStep(window.history.state) ?? nextStep;
      currentEpoch = readEpoch(window.history.state) ?? nextEpoch;
      currentUrl = window.location.href;
      currentState = window.history.state;
      currentHistoryLength = readHistoryLength();
      syncLastNextState(window.history.state);
      syncNavSnapshot();
    };

    const preserveNextMetadataWithoutStep = () => {
      if (Object.keys(lastNextState).length === 0) return;
      const existing = window.history.state;
      if (existing && typeof existing === "object" && "__NA" in existing && existing.__NA) {
        return;
      }
      const browserState =
        existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
      nativeReplaceState(
        {
          ...lastNextState,
          ...browserState,
        },
        "",
        window.location.href,
      );
      currentState = window.history.state;
      currentHistoryLength = readHistoryLength();
      syncLastNextState(window.history.state);
      syncNavSnapshot();
    };

    window.history.pushState = function pushState(data, unused, url) {
      const previousStep = currentStep;
      const previousEpoch = currentEpoch;
      const previousUrl = currentUrl;
      pendingPopFragment = null;
      syncLastNextState(data);
      const { nextStep, nextEpoch } = allocateNextPosition(previousStep, previousEpoch);
      const result = nativePushState(withPosition(data, nextStep, nextEpoch), unused, url);
      const committedStep = readStep(window.history.state);
      const committedEpoch = readEpoch(window.history.state);
      if (committedStep === nextStep && committedEpoch === nextEpoch) {
        currentStep = nextStep;
        currentEpoch = nextEpoch;
        currentUrl = window.location.href;
        currentState = window.history.state;
        currentHistoryLength = readHistoryLength();
        syncLastNextState(window.history.state);
        syncNavSnapshot();
      } else if (committedStep !== null && committedEpoch !== null) {
        currentStep = committedStep;
        currentEpoch = committedEpoch;
        epochCounter = Math.max(epochCounter, committedEpoch);
        currentUrl = window.location.href;
        currentState = window.history.state;
        currentHistoryLength = readHistoryLength();
        syncLastNextState(window.history.state);
        syncNavSnapshot();
      } else {
        currentStep = previousStep;
        currentEpoch = previousEpoch;
        currentUrl = previousUrl;
      }
      return result;
    };

    window.history.replaceState = function replaceState(data, unused, url) {
      const previousStep = currentStep;
      const previousEpoch = currentEpoch;
      pendingPopFragment = null;
      syncLastNextState(data);
      const payload =
        previousStep !== null && previousEpoch !== null
          ? withPosition(data, previousStep, previousEpoch)
          : data;
      const result = nativeReplaceState(payload, unused, url);
      const committedStep = readStep(window.history.state);
      const committedEpoch = readEpoch(window.history.state);
      if (committedStep !== null && committedEpoch !== null) {
        currentStep = committedStep;
        currentEpoch = committedEpoch;
      } else {
        currentStep = previousStep;
        currentEpoch = previousEpoch;
      }
      currentUrl = window.location.href;
      currentState = window.history.state;
      currentHistoryLength = readHistoryLength();
      syncLastNextState(window.history.state);
      syncNavSnapshot();
      return result;
    };

    const onNavigationEvent: EventListener = (event) => {
      if (event.type === "currententrychange") {
        const navType = (event as Event & { navigationType?: string }).navigationType ?? null;
        lastEntryNavigationType = navType;
        if (navType !== "traverse") {
          syncNavSnapshot();
        }
        return;
      }
      const pending = activeRestore;
      if (!pending) return;
      if (event.type === "navigateerror") {
        clearActiveRestore(true);
        return;
      }
      const navEvent = event as Event & {
        defaultPrevented?: boolean;
        destination?: HistoryNavigationDestination;
      };
      if (!isRestoringTraverseNavigation(navEvent.destination)) return;
      const finalizeCheck = () => {
        if (navEvent.defaultPrevented && activeRestore === pending) {
          clearActiveRestore(true);
        }
      };
      if (typeof queueMicrotask === "function") {
        queueMicrotask(finalizeCheck);
      } else {
        finalizeCheck();
      }
    };

    const onHashChange = () => {
      if (activeRestore) return;
      const pendingPop =
        pendingPopFragment && pendingPopFragment.href === window.location.href
          ? pendingPopFragment
          : null;
      pendingPopFragment = null;
      const hashWasNavPush = lastEntryNavigationType === "push";
      lastEntryNavigationType = null;
      const nextHistoryLength = readHistoryLength();

      if (pendingPop) {
        const lengthGrew =
          nextHistoryLength !== null &&
          pendingPop.preHistoryLength !== null &&
          nextHistoryLength > pendingPop.preHistoryLength;
        currentHistoryLength = nextHistoryLength;
        if (hashWasNavPush || lengthGrew) {
          stampCurrentFragmentEntry(pendingPop.preStep, pendingPop.preEpoch);
        } else {
          preserveNextMetadataWithoutStep();
        }
        return;
      }

      if (window.location.href === currentUrl) return;
      const committedStep = readStep(window.history.state);
      const committedEpoch = readEpoch(window.history.state);
      if (
        committedStep === null ||
        committedEpoch === null ||
        (committedStep === currentStep && committedEpoch === currentEpoch)
      ) {
        stampCurrentFragmentEntry(currentStep, currentEpoch);
      } else {
        currentStep = committedStep;
        currentEpoch = committedEpoch;
        epochCounter = Math.max(epochCounter, committedEpoch);
        currentUrl = window.location.href;
        currentState = window.history.state;
        currentHistoryLength = nextHistoryLength;
        syncLastNextState(window.history.state);
        syncNavSnapshot();
      }
    };

    const onPopState = (event: PopStateEvent) => {
      const targetStep = readStep(event.state);
      const targetEpoch = readEpoch(event.state);
      const eventNavKey = navApi?.currentEntry?.key ?? null;
      const popWasNavPush = lastEntryNavigationType === "push";
      lastEntryNavigationType = null;
      const preHistoryLength = currentHistoryLength;
      const nextHistoryLength = readHistoryLength();
      const lengthGrew =
        nextHistoryLength !== null && preHistoryLength !== null && nextHistoryLength > preHistoryLength;

      if (
        activeRestore &&
        matchesRestoreTarget(activeRestore, event.state, window.location.href, eventNavKey)
      ) {
        clearActiveRestore(true);
        event.stopImmediatePropagation();
        return;
      }
      if (activeRestore) {
        clearActiveRestore(false);
      }
      pendingPopFragment = null;
      const restoreStep = currentStep;
      const restoreEpoch = currentEpoch;
      const restoreUrl = currentUrl;
      const restoreState = currentState;
      const restoreKey = currentNavKey;
      const restoreIndex = currentNavIndex;

      if (activeTraverseGuard && !activeTraverseGuard(window.location.href)) {
        event.stopImmediatePropagation();
        const knownNavIndexDelta =
          restoreIndex !== null &&
          typeof navApi?.currentEntry?.index === "number" &&
          navApi.currentEntry.index !== restoreIndex
            ? restoreIndex - navApi.currentEntry.index
            : null;
        const knownStepDelta =
          restoreStep !== null &&
          restoreEpoch !== null &&
          targetStep !== null &&
          targetEpoch !== null &&
          restoreEpoch === targetEpoch &&
          targetStep !== restoreStep
            ? restoreStep - targetStep
            : null;
        const canTraverseBackToKey = Boolean(restoreKey && typeof navApi?.traverseTo === "function");

        if (!canTraverseBackToKey && knownNavIndexDelta === null && knownStepDelta === null) {
          // Unknown/unproven offset without Navigation API: never guess history.go(+1);
          // restore the guarded URL & Next router state in a fresh contiguous epoch.
          const { nextStep, nextEpoch } = allocateNextPosition(null, null);
          const baseState =
            restoreState && typeof restoreState === "object"
              ? (restoreState as Record<string, unknown>)
              : {};
          nativePushState(
            {
              ...lastNextState,
              ...baseState,
              __sfStep: nextStep,
              __sfEpoch: nextEpoch,
            },
            "",
            toRelativeHref(restoreUrl),
          );
          currentStep = nextStep;
          currentEpoch = nextEpoch;
          currentUrl = window.location.href;
          currentState = window.history.state;
          currentHistoryLength = readHistoryLength();
          syncLastNextState(window.history.state);
          syncNavSnapshot();
          return;
        }

        const restoreEntry: RestoreTarget = {
          targetStep: restoreStep,
          targetEpoch: restoreEpoch,
          targetUrl: restoreUrl,
          targetKey: restoreKey,
          timerId: null,
        };
        activeRestore = restoreEntry;
        if (typeof window.setTimeout === "function") {
          restoreEntry.timerId = window.setTimeout(() => {
            if (activeRestore === restoreEntry) {
              clearActiveRestore(true);
            }
          }, 1000);
        }
        try {
          if (canTraverseBackToKey && restoreKey && navApi?.traverseTo) {
            const navResult = navApi.traverseTo(restoreKey);
            navResult?.committed?.catch?.(() => {
              if (activeRestore === restoreEntry) {
                clearActiveRestore(true);
              }
            });
            navResult?.finished?.catch?.(() => undefined);
          } else {
            const deltaToRestore = knownNavIndexDelta ?? knownStepDelta!;
            window.history.go(deltaToRestore);
          }
        } catch {
          if (activeRestore === restoreEntry) {
            clearActiveRestore(true);
          }
        }
        return;
      }
      if (targetStep !== null && targetEpoch !== null) {
        currentStep = targetStep;
        currentEpoch = targetEpoch;
        epochCounter = Math.max(epochCounter, targetEpoch);
        currentUrl = window.location.href;
        currentState = window.history.state;
        currentHistoryLength = nextHistoryLength;
        syncLastNextState(window.history.state);
        syncNavSnapshot();
        return;
      }
      if (popWasNavPush || lengthGrew) {
        stampCurrentFragmentEntry(restoreStep, restoreEpoch);
        return;
      }
      pendingPopFragment = {
        href: window.location.href,
        preStep: restoreStep,
        preEpoch: restoreEpoch,
        preHistoryLength,
      };
      currentStep = null;
      currentEpoch = null;
      currentUrl = window.location.href;
      currentState = window.history.state;
      currentHistoryLength = nextHistoryLength;
      syncLastNextState(window.history.state);
      syncNavSnapshot();
    };

    navApi?.addEventListener?.("navigate", onNavigationEvent);
    navApi?.addEventListener?.("navigateerror", onNavigationEvent);
    navApi?.addEventListener?.("currententrychange", onNavigationEvent);
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState, true);
    return () => {
      clearActiveRestore(false);
      navApi?.removeEventListener?.("navigate", onNavigationEvent);
      navApi?.removeEventListener?.("navigateerror", onNavigationEvent);
      navApi?.removeEventListener?.("currententrychange", onNavigationEvent);
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState, true);
      window.history.pushState = nativePushState;
      window.history.replaceState = nativeReplaceState;
    };
  }, []);

  return null;
}
