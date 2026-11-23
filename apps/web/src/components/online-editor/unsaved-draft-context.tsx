"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type UnsavedDraftContextValue = {
  hasUnsavedDraft: boolean;
  signingOut: boolean;
  setHasUnsavedDraft: (dirty: boolean) => void;
  setSigningOut: (pending: boolean) => void;
  authorizeSignOutRedirect: (targetPath: string) => void;
  isSignOutRedirectAuthorized: (destinationUrl?: string) => boolean;
};

const UnsavedDraftContext = createContext<UnsavedDraftContextValue | null>(null);

export function UnsavedDraftProvider({ children }: { children: ReactNode }) {
  const [hasUnsavedDraft, setHasUnsavedDraftState] = useState(false);
  const [signingOut, setSigningOutState] = useState(false);
  const signOutRedirectTargetRef = useRef<string | null>(null);

  const setHasUnsavedDraft = useCallback((dirty: boolean) => {
    if (dirty) signOutRedirectTargetRef.current = null;
    setHasUnsavedDraftState(dirty);
  }, []);

  const setSigningOut = useCallback((pending: boolean) => {
    if (!pending) signOutRedirectTargetRef.current = null;
    setSigningOutState(pending);
  }, []);

  const authorizeSignOutRedirect = useCallback((targetPath: string) => {
    signOutRedirectTargetRef.current = targetPath;
  }, []);

  const isSignOutRedirectAuthorized = useCallback((destinationUrl?: string): boolean => {
    const targetPath = signOutRedirectTargetRef.current;
    if (!targetPath || !destinationUrl) return false;
    try {
      const parsed = new URL(destinationUrl, window.location.href);
      return parsed.pathname === targetPath;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({
      hasUnsavedDraft,
      signingOut,
      setHasUnsavedDraft,
      setSigningOut,
      authorizeSignOutRedirect,
      isSignOutRedirectAuthorized,
    }),
    [
      hasUnsavedDraft,
      signingOut,
      setHasUnsavedDraft,
      setSigningOut,
      authorizeSignOutRedirect,
      isSignOutRedirectAuthorized,
    ],
  );

  return <UnsavedDraftContext.Provider value={value}>{children}</UnsavedDraftContext.Provider>;
}

export function useUnsavedDraft() {
  return useContext(UnsavedDraftContext);
}
