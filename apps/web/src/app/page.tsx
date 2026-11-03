import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  Circle,
  Clock3,
  Code2,
  FolderHeart,
  ImageIcon,
  LayoutGrid,
  Monitor,
  Paintbrush,
  Scan,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { SignOut } from "@/components/sign-out";
import { requireAdministrator } from "@/lib/session";
import { getDatabase } from "@smartframe/database";
import { isAdminLoginDisabled } from "@smartframe/auth";

export const dynamic = "force-dynamic";

const stages = [
  "Fundação do projeto",
  "Player Android",
  "Fotos e dispositivos",
  "Publicação online",
  "Widgets e editor visual",
  "Integrações e agendamentos",
  "Testes e entrega",
];

export default async function DashboardPage() {
  const { session, household } = await requireAdministrator();
  const database = getDatabase();
  const where = { householdId: household.id };
  const [photos, albums, devices, layouts] = await Promise.all([
    database.media.count({ where }),
    database.album.count({ where }),
    database.device.count({ where: { ...where, revokedAt: null } }),
    database.layout.count({ where }),
  ]);
  const firstName = session.user.name.split(" ")[0];

  return (
    <div className="dashboard">
      <a className="skip-link" href="#main">
        Pular para o conteúdo
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">MEU ESPAÇO</div>
        <nav aria-label="Navegação principal">
          <a className="nav-item active" href="#overview" aria-current="page">
            <LayoutGrid size={19} /> Visão geral
          </a>
          <a className="nav-item" href="#library">
            <ImageIcon size={19} /> Biblioteca <span className="nav-count">{photos}</span>
          </a>
          <a className="nav-item" href="#devices">
            <Monitor size={19} /> Dispositivos <span className="nav-count">{devices}</span>
          </a>
          <a className="nav-item" href="/layouts">
            <Paintbrush size={19} /> Personalizar
          </a>
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <Wifi size={20} />
          </div>
          <strong>Seu painel, sempre conectado.</strong>
          <p>
            Fotos e widgets vêm do servidor. Personalize pelo celular e mantenha o tablet conectado
            para receber suas publicações.
          </p>
          <span>ONLINE PLAYER</span>
        </div>
        <div className="sidebar-bottom">
          <div className="account-avatar">{firstName.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{session.user.name}</strong>
            <span>Administrador · {household.name}</span>
          </div>
          {!isAdminLoginDisabled() && <SignOut />}
        </div>
      </aside>
      <div className="dashboard-body">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="breadcrumb">
            Meu espaço <span>/</span> <strong>Visão geral</strong>
          </div>
          <div className="topbar-actions">
            <div className="environment">
              <span /> {isAdminLoginDisabled() ? "Acesso local sem login" : "Instalação própria"}{" "}
              <span className="version">v0.4.0</span>
            </div>
            <div className="mobile-sign-out">{!isAdminLoginDisabled() && <SignOut />}</div>
          </div>
        </header>
        <main id="main" className="main-content">
          <section className="page-heading" id="overview">
            <div>
              <span className="eyebrow green">BEM-VINDO AO SEU SMARTFRAME</span>
              <h1>
                Olá, {firstName}
                <span className="greeting-dot">.</span>
              </h1>
              <p>Um lugar para suas fotos. Uma nova vida para seu tablet.</p>
            </div>
            <span className="phase-label">
              <Code2 size={15} /> Online Player · WebView
            </span>
          </section>
          <section className="welcome-banner">
            <div className="welcome-text">
              <span className="banner-tag">
                <Sparkles size={14} /> O COMEÇO DE ALGO ESPECIAL
              </span>
              <h2>
                Suas memórias.
                <br />
                <em>Sempre em cena.</em>
              </h2>
              <p>Escolha suas fotos, personalize os cinco widgets e publique para cada tablet.</p>
              <a className="button button-light" href="/layouts">
                Personalizar meu porta-retratos <ArrowRight size={16} />
              </a>
            </div>
            <div className="banner-art" aria-hidden="true">
              <div className="mini-frame frame-secondary">
                <div className="abstract-photo" />
              </div>
              <div className="mini-frame frame-primary">
                <div className="landscape">
                  <div className="landscape-sun" />
                  <div className="landscape-mountain back" />
                  <div className="landscape-mountain front" />
                  <div className="frame-clock">
                    09:41<span>sexta-feira, boas memórias</span>
                  </div>
                </div>
              </div>
              <div className="floating-note">
                <HeartIcon /> um momento de cada vez
              </div>
            </div>
          </section>
          <section className="stats-grid" aria-label="Resumo da conta">
            <Stat
              icon={<ImageIcon size={20} />}
              label="Fotos na biblioteca"
              value={photos}
              hint="Suas histórias em imagens"
            />
            <Stat
              icon={<FolderHeart size={20} />}
              label="Álbuns"
              value={albums}
              hint="Cada coleção, uma lembrança"
            />
            <Stat
              icon={<Monitor size={20} />}
              label="Dispositivos"
              value={devices}
              hint="Porta-retratos conectados à conta"
            />
            <Stat
              icon={<Paintbrush size={20} />}
              label="Layouts"
              value={layouts}
              hint="Espaços com a sua personalidade"
            />
          </section>
          <div className="content-columns">
            <section className="panel" id="devices">
              <div className="panel-heading">
                <h2>Seus porta-retratos</h2>
                <span className="pill">{devices} dispositivos</span>
              </div>
              <div className="empty-device">
                <div className="device-drawing">
                  <Scan size={46} strokeWidth={1} />
                  <span />
                </div>
                <h3>Seu tablet, do seu jeito.</h3>
                <p>
                  Abra o editor para organizar suas fotos, personalizar os widgets e conectar seu
                  tablet por código.
                </p>
                <a className="button button-primary" href="/layouts">
                  <Clock3 size={14} /> Abrir personalização
                </a>
              </div>
              <div className="panel-foot">
                <ShieldCheck size={16} /> Cada dispositivo terá sua própria credencial de acesso.
              </div>
            </section>
            <section className="panel roadmap-panel" id="roadmap">
              <div className="panel-heading">
                <h2>Da ideia à sua tela</h2>
                <span className="pill">Roadmap</span>
              </div>
              <ol className="roadmap-list">
                {stages.map((stage, index) => (
                  <li key={stage} className={index === 0 ? "completed" : ""}>
                    <span className="stage-icon">
                      {index === 0 ? <Check size={13} /> : <Circle size={11} />}
                    </span>
                    <span>{stage}</span>
                    {index === 0 && <span className="stage-status">base criada</span>}
                  </li>
                ))}
              </ol>
              <div className="roadmap-notice">
                O player online oferece carrossel, relógio, clima, moedas e calendário. Integrações,
                agendamentos e widgets livres continuam nas próximas etapas.
              </div>
            </section>
          </div>
          <section className="panel library-panel" id="library">
            <div className="library-illustration">
              <ImageIcon size={28} strokeWidth={1.4} />
              <FolderHeart size={20} />
            </div>
            <div>
              <h2>Uma biblioteca cheia de significado.</h2>
              <p>
                Envie várias fotos pelo editor, escolha sua ordem e publique o carrossel. O servidor
                otimiza as imagens para o tablet.
              </p>
            </div>
            <a className="planned-label" href="/layouts">
              <ArrowDownToLine size={14} /> Abrir biblioteca no editor
            </a>
          </section>
          <footer className="dashboard-footer">
            <span>SmartFrame · Feito para guardar o que importa.</span>
            <span>
              <Settings2 size={13} /> Next.js + Kotlin/WebView
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className="stat-icon">{icon}</span>
        <span>{label}</span>
      </div>
      <strong>{value.toLocaleString("pt-BR")}</strong>
      <p>{hint}</p>
    </article>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M12 21s-9-5.8-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.2-9 12-9 12Z" />
    </svg>
  );
}
