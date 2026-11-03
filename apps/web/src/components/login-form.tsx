"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.email({
        email: String(data.get("email")).trim(),
        password: String(data.get("password")),
      });
      if (result.error) {
        setError(
          result.error.status === 429
            ? "Muitas tentativas. Aguarde um minuto e tente novamente."
            : "Não foi possível entrar. Confira seu e-mail e senha.",
        );
      } else {
        router.replace("/");
        router.refresh();
      }
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="login-form">
      <label htmlFor="email">E-mail</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        placeholder="voce@exemplo.com"
        required
        maxLength={254}
        disabled={pending}
      />
      <label htmlFor="password">Senha</label>
      <div className="password-field">
        <input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Sua senha de administrador"
          required
          maxLength={128}
          disabled={pending}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button button-primary login-submit" disabled={pending} type="submit">
        {pending ? (
          <>
            <LoaderCircle size={18} className="spin" /> Entrando…
          </>
        ) : (
          <>
            Entrar no meu espaço <ArrowRight size={18} />
          </>
        )}
      </button>
      <p className="login-help">
        Primeiro acesso? O administrador é criado pelo terminal do servidor. Não há cadastro
        público.
      </p>
    </form>
  );
}
