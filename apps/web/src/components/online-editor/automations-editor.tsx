"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isScheduleRulePollSafe,
  notificationSeverities,
  pushStatuses,
  scheduleRuleDurationSeconds,
  webhookPermissions,
  type DashboardRule,
  type NotificationSeverity,
  type OnlineDashboard,
  type PushStatus,
  type WebhookPermission,
} from "@smartframe/contracts";

type WebhookKeySummary = {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: WebhookPermission[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type DeviceOption = {
  id: string;
  name: string;
};

const WEEKDAY_LABELS = [
  { day: 0, label: "Dom" },
  { day: 1, label: "Seg" },
  { day: 2, label: "Ter" },
  { day: 3, label: "Qua" },
  { day: 4, label: "Qui" },
  { day: 5, label: "Sex" },
  { day: 6, label: "Sáb" },
];

const SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  info: "Informação",
  success: "Sucesso",
  warning: "Atenção",
  alert: "Alerta crítico",
};

const PERMISSION_LABELS: Record<WebhookPermission, string> = {
  push: "Push (dados)",
  notify: "Notify (alertas)",
  goto: "Goto (página)",
  refresh: "Refresh (atualizar)",
};

const STATUS_LABELS: Record<PushStatus, string> = {
  healthy: "Saudável",
  running: "Em execução",
  warning: "Atenção",
  failing: "Falha",
  idle: "Inativo",
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function AutomationsEditor({
  config,
  onChange,
  devices,
  selectedDeviceId,
  controlsDisabled,
  onNotice,
  onError,
}: {
  config: OnlineDashboard;
  onChange: (next: OnlineDashboard) => void;
  devices: DeviceOption[];
  selectedDeviceId: string;
  controlsDisabled: boolean;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [keys, setKeys] = useState<WebhookKeySummary[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [keyName, setKeyName] = useState("Automação local");
  const [selectedPermissions, setSelectedPermissions] = useState<WebhookPermission[]>([
    ...webhookPermissions,
  ]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [busyKeyAction, setBusyKeyAction] = useState(false);

  const [testAction, setTestAction] = useState<"notify" | "goto" | "push" | "refresh">("notify");
  const [testTitle, setTestTitle] = useState("Aviso de teste");
  const [testMessage, setTestMessage] = useState("Notificação disparada pelo painel.");
  const [testSeverity, setTestSeverity] = useState<NotificationSeverity>("info");
  const [testPage, setTestPage] = useState("next");
  const [testPushKey, setTestPushKey] = useState("ci-main");
  const [testPushStatus, setTestPushStatus] = useState<PushStatus>("healthy");
  const [testPushDetail, setTestPushDetail] = useState("120/120 checks");
  const [testTargetDevice, setTestTargetDevice] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  const rules = config.rules ?? [];
  const pages = config.pages ?? [];

  const candidateDevice = testTargetDevice ?? selectedDeviceId;
  const effectiveTestDevice = devices.some((device) => device.id === candidateDevice)
    ? candidateDevice
    : "";
  const effectiveTestPage =
    testPage === "next" || testPage === "prev" || pages.some((page) => page.id === testPage)
      ? testPage
      : "next";

  const loadKeys = useCallback(async () => {
    const response = await fetch("/api/webhooks/keys", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Falha ao carregar chaves.");
    return (data.keys ?? []) as WebhookKeySummary[];
  }, []);

  useEffect(() => {
    let active = true;
    loadKeys()
      .then((loaded) => {
        if (active) setKeys(loaded);
      })
      .catch((failure: unknown) => {
        if (active) {
          onError(
            failure instanceof Error ? failure.message : "Falha ao carregar chaves de webhook.",
          );
        }
      })
      .finally(() => {
        if (active) setKeysLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadKeys, onError]);

  function setRules(nextRules: DashboardRule[]) {
    const nextConfig: OnlineDashboard = { ...config };
    if (nextRules.length > 0) nextConfig.rules = nextRules;
    else delete nextConfig.rules;
    onChange(nextConfig);
  }

  function addRule() {
    if (rules.length >= 20) return;
    const defaultAction: DashboardRule["action"] =
      pages.length > 0
        ? { type: "goto_page", pageId: pages[0].id, durationSeconds: 0 }
        : {
            type: "show_notification",
            title: "Alerta automático",
            message: "Evento externo recebido via webhook.",
            severity: "warning",
            durationSeconds: 10,
          };
    setRules([
      ...rules,
      {
        id: newId(),
        name: `Regra ${rules.length + 1}`,
        enabled: true,
        trigger: { type: "push_event", feedKey: "ci-main", status: "failing" },
        action: defaultAction,
      },
    ]);
  }

  function updateRule(ruleId: string, updater: (current: DashboardRule) => DashboardRule) {
    setRules(rules.map((rule) => (rule.id === ruleId ? updater(rule) : rule)));
  }

  function togglePermission(permission: WebhookPermission) {
    setSelectedPermissions((current) => {
      if (current.includes(permission)) {
        return current.length > 1 ? current.filter((item) => item !== permission) : current;
      }
      return [...current, permission];
    });
  }

  async function handleCreateKey() {
    if (!keyName.trim() || busyKeyAction) return;
    setBusyKeyAction(true);
    onError("");
    onNotice("");
    try {
      const response = await fetch("/api/webhooks/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName.trim(), permissions: selectedPermissions }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível criar a chave.");
      setCreatedSecret(data.key.secret);
      onNotice("Chave de webhook criada. Copie o segredo abaixo; ele não será exibido novamente.");
      setKeys(await loadKeys());
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Erro ao criar chave de webhook.");
    } finally {
      setBusyKeyAction(false);
    }
  }

  async function handleRevokeKey(id: string) {
    if (busyKeyAction || !window.confirm("Revogar esta chave de webhook permanentemente?")) return;
    setBusyKeyAction(true);
    onError("");
    onNotice("");
    try {
      const response = await fetch("/api/webhooks/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível revogar a chave.");
      onNotice("Chave de webhook revogada.");
      setKeys(await loadKeys());
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Erro ao revogar chave.");
    } finally {
      setBusyKeyAction(false);
    }
  }

  async function handleRunTest() {
    if (testBusy) return;
    setTestBusy(true);
    onError("");
    onNotice("");
    try {
      const targetDevice = effectiveTestDevice || undefined;
      const body =
        testAction === "notify"
          ? {
              action: "notify",
              title: testTitle.trim() || undefined,
              message: testMessage.trim(),
              severity: testSeverity,
              durationSeconds: 8,
              ...(targetDevice ? { deviceId: targetDevice } : {}),
            }
          : testAction === "goto"
            ? {
                action: "goto",
                page: effectiveTestPage,
                durationSeconds: 0,
                ...(targetDevice ? { deviceId: targetDevice } : {}),
              }
            : testAction === "push"
              ? {
                  action: "push",
                  key: testPushKey.trim(),
                  status: testPushStatus,
                  detail: testPushDetail.trim(),
                }
              : {
                  action: "refresh",
                  ...(targetDevice ? { deviceId: targetDevice } : {}),
                };
      const response = await fetch("/api/webhooks/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao executar teste.");
      if (data.targetDevices === 0 || data.deliveredToDevices === 0) {
        onNotice("Comando processado, mas nenhum dispositivo ativo correspondente recebeu a ação.");
      } else {
        onNotice("Comando de teste enviado aos dispositivos pareados.");
      }
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Falha ao disparar teste.");
    } finally {
      setTestBusy(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  return (
    <div className="automations-editor">
      <fieldset disabled={controlsDisabled}>
        <legend>Regras automáticas deste painel</legend>
        <small>
          Troque de página ou exiba alertas automaticamente conforme eventos de webhook ou horários
          no fuso do painel.
        </small>
        {rules.length === 0 ? (
          <p className="online-empty">Nenhuma regra configurada neste painel.</p>
        ) : (
          <div className="rule-list">
            {rules.map((rule) => (
              <div key={rule.id} className="rule-card">
                <div className="rule-card-header">
                  <label className="online-toggle">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) =>
                        updateRule(rule.id, (cur) => ({ ...cur, enabled: e.target.checked }))
                      }
                    />
                    Ativa
                  </label>
                  <button
                    type="button"
                    onClick={() => setRules(rules.filter((item) => item.id !== rule.id))}
                  >
                    Remover regra
                  </button>
                </div>
                <label>
                  Nome da regra
                  <input
                    maxLength={80}
                    value={rule.name}
                    onChange={(e) =>
                      updateRule(rule.id, (cur) => ({ ...cur, name: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Quando (gatilho)
                  <select
                    value={rule.trigger.type}
                    onChange={(e) => {
                      const nextType = e.target.value as DashboardRule["trigger"]["type"];
                      updateRule(rule.id, (cur) => {
                        if (nextType === "push_event") {
                          return {
                            ...cur,
                            trigger: { type: "push_event", feedKey: "ci-main", status: "failing" },
                          };
                        }
                        if (nextType === "notify_event") {
                          return {
                            ...cur,
                            trigger: { type: "notify_event", minSeverity: "warning" },
                          };
                        }
                        return {
                          ...cur,
                          trigger: {
                            type: "time_range",
                            startTime: "09:00",
                            endTime: "18:00",
                            daysOfWeek: [1, 2, 3, 4, 5],
                          },
                        };
                      });
                    }}
                  >
                    <option value="push_event">Evento em webhook /api/push</option>
                    <option value="notify_event">Notificação recebida (/api/notify)</option>
                    <option value="time_range">Faixa de horário e dias da semana</option>
                  </select>
                </label>

                {rule.trigger.type === "push_event" && (
                  <div className="rule-row-fields">
                    <label>
                      Chave do feed
                      <input
                        maxLength={64}
                        value={rule.trigger.feedKey}
                        onChange={(e) =>
                          updateRule(rule.id, (cur) =>
                            cur.trigger.type === "push_event"
                              ? { ...cur, trigger: { ...cur.trigger, feedKey: e.target.value } }
                              : cur,
                          )
                        }
                      />
                    </label>
                    <label>
                      Estado esperado
                      <select
                        value={rule.trigger.status ?? ""}
                        onChange={(e) =>
                          updateRule(rule.id, (cur) =>
                            cur.trigger.type === "push_event"
                              ? {
                                  ...cur,
                                  trigger: {
                                    ...cur.trigger,
                                    status: (e.target.value || undefined) as PushStatus | undefined,
                                  },
                                }
                              : cur,
                          )
                        }
                      >
                        <option value="">Qualquer atualização</option>
                        {pushStatuses.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {rule.trigger.type === "notify_event" && (
                  <label>
                    Severidade mínima
                    <select
                      value={rule.trigger.minSeverity}
                      onChange={(e) =>
                        updateRule(rule.id, (cur) =>
                          cur.trigger.type === "notify_event"
                            ? {
                                ...cur,
                                trigger: {
                                  ...cur.trigger,
                                  minSeverity: e.target.value as NotificationSeverity,
                                },
                              }
                            : cur,
                        )
                      }
                    >
                      {notificationSeverities.map((severity) => (
                        <option key={severity} value={severity}>
                          {SEVERITY_LABELS[severity]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {rule.trigger.type === "time_range" && (
                  <>
                    <div className="rule-row-fields">
                      <label>
                        Início
                        <input
                          type="time"
                          value={rule.trigger.startTime}
                          onChange={(e) =>
                            updateRule(rule.id, (cur) =>
                              cur.trigger.type === "time_range"
                                ? {
                                    ...cur,
                                    trigger: { ...cur.trigger, startTime: e.target.value },
                                  }
                                : cur,
                            )
                          }
                        />
                      </label>
                      <label>
                        Fim
                        <input
                          type="time"
                          value={rule.trigger.endTime}
                          onChange={(e) =>
                            updateRule(rule.id, (cur) =>
                              cur.trigger.type === "time_range"
                                ? { ...cur, trigger: { ...cur.trigger, endTime: e.target.value } }
                                : cur,
                            )
                          }
                        />
                      </label>
                    </div>
                    {(!rule.trigger.startTime ||
                      !rule.trigger.endTime ||
                      rule.trigger.startTime === rule.trigger.endTime) ? (
                      <small className="online-error" role="status">
                        {!rule.trigger.startTime || !rule.trigger.endTime
                          ? "Informe os horários de início e fim."
                          : "Horário de início e fim devem ser diferentes."}
                      </small>
                    ) : rule.enabled && !isScheduleRulePollSafe(rule, config.refreshSeconds) ? (
                      <small className="online-error" role="status">
                        Janela ({Math.round(scheduleRuleDurationSeconds(rule.trigger) / 60)} min)
                        menor que o intervalo de atualização do painel ({config.refreshSeconds}s):
                        aumente a janela ou reduza o intervalo em Geral.
                      </small>
                    ) : null}
                    <div className="weekday-picker" role="group" aria-label="Dias da semana">
                      {WEEKDAY_LABELS.map(({ day, label }) => {
                        const checked =
                          rule.trigger.type === "time_range" &&
                          rule.trigger.daysOfWeek.includes(day);
                        return (
                          <label key={day} className="weekday-chip">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                updateRule(rule.id, (cur) => {
                                  if (cur.trigger.type !== "time_range") return cur;
                                  const nextDays = e.target.checked
                                    ? [...new Set([...cur.trigger.daysOfWeek, day])].sort()
                                    : cur.trigger.daysOfWeek.filter((d) => d !== day);
                                  if (!nextDays.length) return cur;
                                  return {
                                    ...cur,
                                    trigger: { ...cur.trigger, daysOfWeek: nextDays },
                                  };
                                })
                              }
                            />
                            <span>{label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}

                <label>
                  Então (ação)
                  <select
                    value={rule.action.type}
                    onChange={(e) => {
                      const nextActionType = e.target.value as DashboardRule["action"]["type"];
                      updateRule(rule.id, (cur) => {
                        if (nextActionType === "goto_page" && pages.length > 0) {
                          return {
                            ...cur,
                            action: { type: "goto_page", pageId: pages[0].id, durationSeconds: 0 },
                          };
                        }
                        return {
                          ...cur,
                          action: {
                            type: "show_notification",
                            title: "Alerta automático",
                            message: "Evento detectado na automação.",
                            severity: "warning",
                            durationSeconds: 10,
                          },
                        };
                      });
                    }}
                  >
                    <option value="goto_page" disabled={pages.length === 0}>
                      Trocar para página {pages.length === 0 ? "(requer múltiplas páginas)" : ""}
                    </option>
                    <option value="show_notification">Exibir alerta/toast no tablet</option>
                  </select>
                </label>

                {rule.action.type === "goto_page" &&
                  (pages.length > 0 ? (
                    <div className="rule-row-fields">
                      <label>
                        Página de destino
                        <select
                          value={rule.action.pageId}
                          onChange={(e) =>
                            updateRule(rule.id, (cur) =>
                              cur.action.type === "goto_page"
                                ? { ...cur, action: { ...cur.action, pageId: e.target.value } }
                                : cur,
                            )
                          }
                        >
                          {pages.map((page, idx) => (
                            <option key={page.id} value={page.id}>
                              {idx + 1}. {page.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Duração (s, 0 = permanente)
                        <input
                          type="number"
                          min={0}
                          max={3600}
                          step={1}
                          value={rule.action.durationSeconds}
                          onChange={(e) => {
                            const parsed = Math.trunc(Number(e.target.value));
                            const value = Number.isFinite(parsed)
                              ? Math.max(0, Math.min(3600, parsed))
                              : 0;
                            updateRule(rule.id, (cur) =>
                              cur.action.type === "goto_page"
                                ? { ...cur, action: { ...cur.action, durationSeconds: value } }
                                : cur,
                            );
                          }}
                        />
                      </label>
                    </div>
                  ) : (
                    <small>
                      Ative múltiplas páginas na aba Aparência para direcionar esta regra a uma
                      página.
                    </small>
                  ))}

                {rule.action.type === "show_notification" && (
                  <>
                    <div className="rule-row-fields">
                      <label>
                        Título do alerta
                        <input
                          maxLength={80}
                          value={rule.action.title}
                          onChange={(e) =>
                            updateRule(rule.id, (cur) =>
                              cur.action.type === "show_notification"
                                ? { ...cur, action: { ...cur.action, title: e.target.value } }
                                : cur,
                            )
                          }
                        />
                      </label>
                      <label>
                        Severidade
                        <select
                          value={rule.action.severity}
                          onChange={(e) =>
                            updateRule(rule.id, (cur) =>
                              cur.action.type === "show_notification"
                                ? {
                                    ...cur,
                                    action: {
                                      ...cur.action,
                                      severity: e.target.value as NotificationSeverity,
                                    },
                                  }
                                : cur,
                            )
                          }
                        >
                          {notificationSeverities.map((severity) => (
                            <option key={severity} value={severity}>
                              {SEVERITY_LABELS[severity]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Duração (3–120s)
                        <input
                          type="number"
                          min={3}
                          max={120}
                          step={1}
                          value={rule.action.durationSeconds}
                          onChange={(e) => {
                            const parsed = Math.trunc(Number(e.target.value));
                            const value = Number.isFinite(parsed)
                              ? Math.max(3, Math.min(120, parsed))
                              : 8;
                            updateRule(rule.id, (cur) =>
                              cur.action.type === "show_notification"
                                ? { ...cur, action: { ...cur.action, durationSeconds: value } }
                                : cur,
                            );
                          }}
                        />
                      </label>
                    </div>
                    <label>
                      Mensagem
                      <input
                        maxLength={300}
                        value={rule.action.message}
                        onChange={(e) =>
                          updateRule(rule.id, (cur) =>
                            cur.action.type === "show_notification"
                              ? { ...cur, action: { ...cur.action, message: e.target.value } }
                              : cur,
                          )
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <button type="button" disabled={controlsDisabled || rules.length >= 20} onClick={addRule}>
          + Adicionar regra automática
        </button>
      </fieldset>

      <fieldset>
        <legend>Chaves de Webhook (API externa)</legend>
        <small>
          Chaves dedicadas para scripts, CI e automação residencial. Nunca utilize tokens de tablets
          aqui.
        </small>
        <div className="rule-row-fields">
          <label>
            Nome da integração
            <input
              maxLength={80}
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="ex: GitHub Actions / Home Assistant"
            />
          </label>
        </div>
        <div className="weekday-picker" role="group" aria-label="Permissões da chave">
          {webhookPermissions.map((permission) => (
            <label key={permission} className="weekday-chip">
              <input
                type="checkbox"
                checked={selectedPermissions.includes(permission)}
                onChange={() => togglePermission(permission)}
              />
              <span>{PERMISSION_LABELS[permission]}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="online-primary"
          disabled={busyKeyAction || !keyName.trim()}
          onClick={() => void handleCreateKey()}
        >
          Gerar nova chave de webhook
        </button>

        {createdSecret && (
          <div className="webhook-secret-box">
            <strong>Copie sua chave agora (exibição única):</strong>
            <code>{createdSecret}</code>
            <div className="online-device-actions">
              <button
                type="button"
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    void navigator.clipboard.writeText(createdSecret);
                    onNotice("Chave copiada para a área de transferência.");
                  }
                }}
              >
                Copiar chave
              </button>
              <button type="button" onClick={() => setCreatedSecret(null)}>
                Ocultar
              </button>
            </div>
          </div>
        )}

        {keysLoading ? (
          <p className="online-empty">Carregando chaves…</p>
        ) : keys.length === 0 ? (
          <p className="online-empty">Nenhuma chave criada ainda.</p>
        ) : (
          <div className="webhook-key-list">
            {keys.map((item) => (
              <div key={item.id} className="webhook-key-row">
                <div>
                  <strong>
                    {item.name} ({item.keyPrefix}…)
                  </strong>
                  <small>
                    Permissões: {item.permissions.join(", ")} ·{" "}
                    {item.revokedAt
                      ? `Revogada em ${new Date(item.revokedAt).toLocaleDateString("pt-BR")}`
                      : item.lastUsedAt
                        ? `Último uso: ${new Date(item.lastUsedAt).toLocaleString("pt-BR")}`
                        : "Nunca usada"}
                  </small>
                </div>
                {!item.revokedAt && (
                  <button
                    type="button"
                    className="online-danger"
                    disabled={busyKeyAction}
                    onClick={() => void handleRevokeKey(item.id)}
                  >
                    Revogar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <details className="online-advanced">
          <summary>Exemplos rápidos de uso (curl)</summary>
          <pre className="webhook-curl">{`# Enviar status externo (/api/push/<key>)
curl -X POST ${origin}/api/push/ci-main \\
  -H "Authorization: Bearer SUA_CHAVE_SF_WH" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"CI Main","category":"ci","status":"healthy","detail":"150 testes ok"}'

# Enviar toast temporário (/api/notify)
curl -X POST ${origin}/api/notify \\
  -H "Authorization: Bearer SUA_CHAVE_SF_WH" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Deploy","message":"Versão publicada","severity":"success","durationSeconds":8}'

# Trocar página e atualizar widgets (/api/goto/<page>)
curl -X POST "${origin}/api/goto/${pages[0]?.id ?? "next"}?refresh=true" \\
  -H "Authorization: Bearer SUA_CHAVE_SF_WH"`}</pre>
        </details>
      </fieldset>

      <fieldset>
        <legend>Testar comando imediato nos tablets</legend>
        <div className="rule-row-fields">
          <label>
            Ação de teste
            <select
              value={testAction}
              onChange={(e) =>
                setTestAction(e.target.value as "notify" | "goto" | "push" | "refresh")
              }
            >
              <option value="notify">Enviar notificação (toast)</option>
              <option value="goto">Trocar página remota</option>
              <option value="push">Enviar push de dados</option>
              <option value="refresh">Atualizar widgets agora</option>
            </select>
          </label>
          <label>
            Dispositivo alvo
            <select
              value={effectiveTestDevice}
              onChange={(e) => setTestTargetDevice(e.target.value)}
            >
              <option value="">Todos os dispositivos da casa</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {testAction === "notify" && (
          <>
            <div className="rule-row-fields">
              <label>
                Título
                <input
                  maxLength={80}
                  value={testTitle}
                  onChange={(e) => setTestTitle(e.target.value)}
                />
              </label>
              <label>
                Severidade
                <select
                  value={testSeverity}
                  onChange={(e) => setTestSeverity(e.target.value as NotificationSeverity)}
                >
                  {notificationSeverities.map((severity) => (
                    <option key={severity} value={severity}>
                      {SEVERITY_LABELS[severity]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Mensagem
              <input
                maxLength={300}
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
              />
            </label>
          </>
        )}

        {testAction === "goto" && (
          <label>
            Página de destino
            <select value={effectiveTestPage} onChange={(e) => setTestPage(e.target.value)}>
              <option value="next">Próxima página (next)</option>
              <option value="prev">Página anterior (prev)</option>
              {pages.map((page, idx) => (
                <option key={page.id} value={page.id}>
                  {idx + 1}. {page.title} ({page.id})
                </option>
              ))}
            </select>
          </label>
        )}

        {testAction === "push" && (
          <div className="rule-row-fields">
            <label>
              Chave do feed
              <input
                maxLength={64}
                value={testPushKey}
                onChange={(e) => setTestPushKey(e.target.value)}
              />
            </label>
            <label>
              Estado
              <select
                value={testPushStatus}
                onChange={(e) => setTestPushStatus(e.target.value as PushStatus)}
              >
                {pushStatuses.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Detalhe
              <input
                maxLength={120}
                value={testPushDetail}
                onChange={(e) => setTestPushDetail(e.target.value)}
              />
            </label>
          </div>
        )}

        <button
          type="button"
          className="online-primary"
          disabled={testBusy}
          onClick={() => void handleRunTest()}
        >
          {testBusy ? "Enviando…" : "Executar teste agora"}
        </button>
      </fieldset>
    </div>
  );
}
