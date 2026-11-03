"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <h1>Não conseguimos abrir este espaço.</h1>
      <p>Verifique se o banco foi inicializado e se a configuração do servidor está correta.</p>
      <button className="button button-primary" onClick={reset}>
        Tentar novamente
      </button>
    </main>
  );
}
