import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ImageIcon,
  LayoutGrid,
  Monitor,
  Paintbrush,
  Scan,
  ShieldCheck,
  Sparkles,
  Tablet,
  Wifi,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { SignOut } from "@/components/sign-out";
import {
  buildEditorShortcutHref,
  formatListCountLabel,
  type OverviewDeviceCard,
} from "@/lib/online-editor/overview";
import { photoStatusLabel } from "@/lib/online-editor/photos";
import { getOverviewData } from "@/lib/overview-data";
import { requireAdministrator } from "@/lib/session";
import { isAdminLoginDisabled } from "@smartframe/auth";
import { getDatabase } from "@smartframe/database";

export const dynamic = "force-dynamic";

function DeviceStatusIcon({ kind }: { kind: OverviewDeviceCard["statusKind"] }) {
  switch (kind) {
    case "confirmed":
      return <CheckCircle2 size={14} aria-hidden="true" />;
    case "pending":
      return <Clock size={14} aria-hidden="true" />;
    case "legacy-active":
      return <AlertTriangle size={14} aria-hidden="true" />;
    default:
      return <Tablet size={14} aria-hidden="true" />;
  }
}

function deviceStatusClassName(card: OverviewDeviceCard): string {
  switch (card.statusKind) {
    case "confirmed":
      return "is-confirmed";
    case "pending":
      return "is-pending";
    case "legacy-active":
      return card.statusLabel.includes("confirmada") ? "is-confirmed" : "is-pending";
    default:
      return "is-none";
  }
}

function photoStatusClassName(status: string): string {
  switch (status) {
    case "ready":
      return "is-confirmed";
    case "pending":
    case "processing":
      return "is-pending";
    case "failed":
    case "error":
      return "is-error";
    default:
      return "is-none";
  }
}

export default async function DashboardPage() {
  const { session, household } = await requireAdministrator();
  const data = await getOverviewData(getDatabase(), household.id);
  const firstName = session.user.name.split(" ")[0] || session.user.name;

  const confirmedDevicesCount = data.totals.confirmedDevices;
  const devicesWithoutPanelCount = data.totals.devicesWithoutPanel;
  const libraryHref = buildEditorShortcutHref({ panelId: data.panels[0]?.id ?? null });

  const deviceMetricHint =
    data.totals.devices === 0
      ? "Nenhum tablet vinculado ainda"
      : `${confirmedDevicesCount} confirmado(s) · ${devicesWithoutPanelCount} sem painel enviado`;

  const panelMetricHint =
    data.totals.panels === 0
      ? "Crie seu primeiro painel no editor"
      : data.totals.panels === 1
        ? "1 painel editável na conta"
        : `${data.totals.panels} painéis editáveis na conta`;

  const photoMetricHint =
    data.totals.photos === 0
      ? "Opcional para painéis só com widgets"
      : [
          `${data.totals.readyPhotos} ${
            data.totals.readyPhotos === 1 ? "pronta" : "prontas"
          } para publicar`,
          data.totals.pendingPhotos > 0 ? `${data.totals.pendingPhotos} em processamento` : null,
          data.totals.failedPhotos > 0 ? `${data.totals.failedPhotos} com falha` : null,
        ]
          .filter(Boolean)
          .join(" · ");

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
            <LayoutGrid size={19} aria-hidden="true" /> Visão geral
          </a>
          <a className="nav-item" href="#devices">
            <Monitor size={19} aria-hidden="true" /> Dispositivos{" "}
            <span className="nav-count">{data.totals.devices}</span>
          </a>
          <a className="nav-item" href="#panels">
            <Paintbrush size={19} aria-hidden="true" /> Painéis{" "}
            <span className="nav-count">{data.totals.panels}</span>
          </a>
          <a className="nav-item" href="#library">
            <ImageIcon size={19} aria-hidden="true" /> Biblioteca{" "}
            <span className="nav-count">{data.totals.photos}</span>
          </a>
          <Link className="nav-item" href="/layouts">
            <Sparkles size={19} aria-hidden="true" /> Personalizar
          </Link>
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <Wifi size={20} aria-hidden="true" />
          </div>
          <strong>Rascunho e publicação separados.</strong>
          <p>
            Edite e salve rascunhos de painéis no editor e publique quando quiser atualizar cada
            dispositivo vinculado.
          </p>
          <span>GESTÃO DE PAINÉIS</span>
        </div>
        <div className="sidebar-bottom">
          <div className="account-avatar" aria-hidden="true">
            {firstName.slice(0, 1).toUpperCase()}
          </div>
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
              <span aria-hidden="true" />{" "}
              {isAdminLoginDisabled() ? "Acesso local sem login" : "Instalação própria"}
            </div>
            <div className="mobile-sign-out">{!isAdminLoginDisabled() && <SignOut />}</div>
          </div>
        </header>
        <main id="main" className="main-content">
          <section className="page-heading" id="overview">
            <div>
              <span className="eyebrow green">
                {data.guidance.mode === "empty" ? "BEM-VINDO AO SMARTFRAME" : "VISÃO GERAL"}
              </span>
              <h1>
                Olá, {firstName}
                <span className="greeting-dot">.</span>
              </h1>
              <p>{data.guidance.summary}</p>
            </div>
            <Link className="button button-primary" href={data.guidance.primaryCta.href}>
              {data.guidance.primaryCta.label} <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </section>

          {data.guidance.mode === "empty" && (
            <section className="welcome-banner" aria-label="Boas-vindas e primeiros passos">
              <div className="welcome-text">
                <span className="banner-tag">
                  <Sparkles size={14} aria-hidden="true" /> PRIMEIRO ACESSO
                </span>
                <h2>
                  Seus painéis.
                  <br />
                  <em>No seu ritmo.</em>
                </h2>
                <p>
                  Crie seu primeiro painel, adicione fotos se quiser e vincule um tablet quando
                  estiver pronto para publicar.
                </p>
                <Link className="button button-light" href={data.guidance.primaryCta.href}>
                  {data.guidance.primaryCta.label} <ArrowRight size={16} aria-hidden="true" />
                </Link>
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
                      09:41<span>seu painel, do seu jeito</span>
                    </div>
                  </div>
                </div>
                <div className="floating-note">
                  <HeartIcon /> pronto para começar
                </div>
              </div>
            </section>
          )}

          {data.guidance.steps.length > 0 && (
            <section
              className={`guidance-section${data.guidance.mode === "active" ? " is-compact" : ""}`}
              aria-label="Próximos passos"
            >
              {data.guidance.mode === "partial" && (
                <div className="guidance-header">
                  <h2>{data.guidance.headline}</h2>
                </div>
              )}
              <ul className="next-steps-grid">
                {data.guidance.steps.map((step) => (
                  <li key={step.key} className="next-step-card">
                    <div className="next-step-copy">
                      <div className="next-step-title-row">
                        <h3>{step.title}</h3>
                        {step.optional && <span className="pill">Opcional</span>}
                      </div>
                      <p>{step.description}</p>
                    </div>
                    <Link className="button button-outline" href={step.href}>
                      {step.ctaLabel} <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="stats-grid" aria-label="Resumo da conta">
            <Stat
              icon={<Monitor size={20} aria-hidden="true" />}
              label="Dispositivos"
              value={data.totals.devices}
              hint={deviceMetricHint}
              href="#devices"
            />
            <Stat
              icon={<Paintbrush size={20} aria-hidden="true" />}
              label="Painéis"
              value={data.totals.panels}
              hint={panelMetricHint}
              href="#panels"
            />
            <Stat
              icon={<ImageIcon size={20} aria-hidden="true" />}
              label="Fotos na biblioteca"
              value={data.totals.photos}
              hint={photoMetricHint}
              href="#library"
            />
          </section>

          <div className="content-columns">
            <section className="panel" id="devices" aria-labelledby="devices-heading">
              <div className="panel-heading">
                <h2 id="devices-heading">Dispositivos</h2>
                <span className="pill">
                  {formatListCountLabel(
                    data.devices.length,
                    data.totals.devices,
                    "dispositivo",
                    "dispositivos",
                  )}
                </span>
              </div>

              {data.devices.length === 0 ? (
                <div className="empty-device">
                  <div className="device-drawing" aria-hidden="true">
                    <Scan size={46} strokeWidth={1} />
                    <span />
                  </div>
                  <h3>Nenhum dispositivo vinculado</h3>
                  <p>
                    Você já pode criar, editar e salvar rascunhos normalmente. Quando quiser exibir
                    um painel em um tablet, gere um código na área Dispositivos, permissões e
                    pareamento do editor.
                  </p>
                  <Link className="button button-primary" href="/layouts">
                    Abrir editor e parear tablet
                  </Link>
                </div>
              ) : (
                <ul className="overview-list">
                  {data.devices.map((device) => (
                    <li key={device.id} className="overview-item-card">
                      <div className="overview-item-main">
                        <div className="overview-item-header">
                          <h3>
                            <Tablet size={16} aria-hidden="true" />
                            <span>{device.displayName}</span>
                          </h3>
                          <span
                            className={`overview-status-pill ${deviceStatusClassName(device)}`}
                          >
                            <DeviceStatusIcon kind={device.statusKind} />
                            {device.statusLabel}
                          </span>
                        </div>
                        <dl className="overview-item-facts">
                          <div>
                            <dt>Painel enviado</dt>
                            <dd>
                              {device.activePanelName ? (
                                <strong>{device.activePanelName}</strong>
                              ) : (
                                "Nenhum painel enviado"
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Comunicação registrada</dt>
                            <dd>{device.lastCommunicationLabel}</dd>
                          </div>
                        </dl>
                        <p className="overview-item-next">{device.nextStepLabel}</p>
                      </div>
                      <div className="overview-item-actions">
                        <Link className="button button-outline" href={device.editorHref}>
                          Personalizar
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="panel-foot">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>
                  A última comunicação indica apenas o contato mais recente registrado, não garantia
                  de conexão ativa agora.
                </span>
              </div>
            </section>

            <section className="panel" id="panels" aria-labelledby="panels-heading">
              <div className="panel-heading">
                <h2 id="panels-heading">Painéis</h2>
                <span className="pill">
                  {formatListCountLabel(data.panels.length, data.totals.panels, "painel", "painéis")}
                </span>
              </div>

              {data.panels.length === 0 ? (
                <div className="empty-device">
                  <div className="device-drawing" aria-hidden="true">
                    <Paintbrush size={38} strokeWidth={1.2} />
                    <span />
                  </div>
                  <h3>Nenhum painel criado</h3>
                  <p>
                    Crie seu primeiro painel para organizar fotos, escolher widgets e salvar
                    rascunhos antes de publicar para seus dispositivos.
                  </p>
                  <Link className="button button-primary" href="/layouts">
                    Criar primeiro painel
                  </Link>
                </div>
              ) : (
                <ul className="overview-list">
                  {data.panels.map((panel) => (
                    <li key={panel.id} className="overview-item-card">
                      <div className="overview-item-main">
                        <div className="overview-item-header">
                          <h3>
                            <Paintbrush size={16} aria-hidden="true" />
                            <span>{panel.displayName}</span>
                          </h3>
                          <span
                            className={`overview-status-pill is-${panel.badgeTone}`}
                          >
                            {panel.badgeLabel}
                          </span>
                        </div>
                        <p className="overview-item-meta">
                          Rascunho r{panel.draftRevision} · {panel.statusLabel}
                        </p>
                      </div>
                      <div className="overview-item-actions">
                        <Link className="button button-outline" href={panel.editorHref}>
                          Personalizar
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="panel-foot panel-foot-link">
                <Link href="/layouts">
                  {data.totals.panels > data.panels.length
                    ? "Ver todos os painéis e criar novos no editor"
                    : "Criar, duplicar ou gerenciar painéis no editor"}{" "}
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
            </section>
          </div>

          <section className="panel library-section" id="library" aria-labelledby="library-heading">
            <div className="panel-heading">
              <div className="library-heading-copy">
                <h2 id="library-heading">Biblioteca de fotos</h2>
                <p>
                  {data.totals.photos === 0
                    ? "Nenhuma foto enviada ainda. Você pode enviar fotos pelo editor quando quiser, ou usar painéis apenas com widgets."
                    : `Total de ${data.totals.photos} ${
                        data.totals.photos === 1 ? "arquivo" : "arquivos"
                      } na conta (${photoMetricHint}).`}
                </p>
              </div>
              <div className="library-heading-actions">
                <span className="pill">
                  {formatListCountLabel(
                    data.recentPhotos.length,
                    data.totals.photos,
                    "foto",
                    "fotos",
                  )}
                </span>
                <Link className="button button-outline" href={libraryHref}>
                  {data.totals.photos === 0
                    ? data.totals.panels === 0
                      ? "Criar painel ou enviar fotos"
                      : "Enviar fotos para o painel"
                    : data.totals.panels === 0
                      ? "Ver biblioteca ou criar painel"
                      : "Gerenciar fotos no painel"}
                </Link>
              </div>
            </div>

            {data.recentPhotos.length > 0 && (
              <ul className="overview-photo-list">
                {data.recentPhotos.map((photo) => (
                  <li key={photo.id} className="overview-photo-item">
                    <div className="overview-photo-name">
                      <ImageIcon size={15} aria-hidden="true" />
                      <span>{photo.filename}</span>
                    </div>
                    <span className={`overview-status-pill ${photoStatusClassName(photo.status)}`}>
                      {photoStatusLabel(photo.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <footer className="dashboard-footer">
            <span>SmartFrame · Seus painéis e dispositivos em um só lugar.</span>
            <span>{household.name}</span>
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
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
  href: string;
}) {
  return (
    <article className="stat-card">
      <a className="stat-link" href={href}>
        <div className="stat-top">
          <span className="stat-icon">{icon}</span>
          <span>{label}</span>
        </div>
        <strong>{value.toLocaleString("pt-BR")}</strong>
        <p>{hint}</p>
      </a>
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
