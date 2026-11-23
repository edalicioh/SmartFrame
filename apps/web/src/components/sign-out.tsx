"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useUnsavedDraft } from "@/components/online-editor/unsaved-draft-context";

export function SignOut() {
  const router = useRouter();
  const unsavedDraft = useUnsavedDraft();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    if (
      unsavedDraft?.hasUnsavedDraft &&
      !window.confirm("Há alterações não salvas. Sair da conta e descartar as alterações?")
    ) {
      return;
    }
    setPending(true);
    unsavedDraft?.setSigningOut(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        unsavedDraft?.setSigningOut(false);
        setError(true);
        return;
      }
      unsavedDraft?.authorizeSignOutRedirect("/login");
      router.replace("/login");
      router.refresh();
    } catch {
      unsavedDraft?.setSigningOut(false);
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button className="sign-out" onClick={logout} disabled={pending}>
        <LogOut size={17} />
        {pending ? "Saindo…" : "Sair da conta"}
      </button>
      {error && (
        <p className="form-error" role="alert">
          Não foi possível sair. Tente novamente.
        </p>
      )}
    </div>
  );
}
