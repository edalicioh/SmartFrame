import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Heart, ShieldCheck, Wifi } from "lucide-react";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { getAuth } from "@/lib/auth";
import { isAdminLoginDisabled } from "@smartframe/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (isAdminLoginDisabled()) redirect("/");
  if (await getAuth().api.getSession({ headers: await headers() })) redirect("/");
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand light />
        <div className="story-copy">
          <span className="eyebrow">MENOS TELA. MAIS MEMÓRIAS.</span>
          <h1>
            Os seus melhores
            <br />
            momentos merecem
            <br />
            <em>ficar por perto.</em>
          </h1>
          <p>Dê uma nova vida ao seu tablet e um lugar especial às suas fotos favoritas.</p>
        </div>
        <div
          className="story-frame"
          aria-label="Ilustração de um porta-retratos digital com uma paisagem"
        >
          <div className="landscape">
            <div className="landscape-sun" />
            <div className="landscape-mountain back" />
            <div className="landscape-mountain front" />
            <div className="frame-clock">
              09:41<span>uma pausa para lembrar</span>
            </div>
          </div>
        </div>
        <div className="story-footer">
          <Heart size={15} /> Feito para guardar o que importa.
        </div>
      </section>
      <section className="login-content">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-box">
          <span className="eyebrow green">SEU CANTINHO DE MEMÓRIAS</span>
          <h2>Que bom ter você aqui.</h2>
          <p className="muted">Entre para cuidar das suas fotos e dos seus porta-retratos.</p>
          <LoginForm />
          <div className="login-trust">
            <span>
              <ShieldCheck size={16} /> Suas fotos, sob seu controle
            </span>
            <span>
              <Wifi size={16} /> Player online com atualização remota
            </span>
          </div>
        </div>
        <footer className="login-footer">
          SmartFrame <span>Uma nova vida para seu tablet.</span>
        </footer>
      </section>
    </main>
  );
}
