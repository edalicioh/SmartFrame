"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    setPending(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(true);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
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
