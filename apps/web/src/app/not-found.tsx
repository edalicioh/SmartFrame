import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-page">
      <h1>Esta página não está no álbum.</h1>
      <p>O endereço pode ter mudado ou não existir.</p>
      <Link className="button button-primary" href="/">
        Voltar ao início
      </Link>
    </main>
  );
}
