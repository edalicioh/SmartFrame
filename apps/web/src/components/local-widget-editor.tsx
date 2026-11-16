"use client";

import type { OnlineDashboard } from "@smartframe/contracts";
import { ValidatedNumberField } from "./online-editor/validated-number-field";

type Widgets = OnlineDashboard["widgets"];
type LocalKey = "notes" | "countdown" | "birthdays" | "tasks" | "pomodoro";

export function LocalWidgetEditor({
  widgets,
  checked,
  disabled,
  onEnabledChange,
  onChange,
  onNumericInvalid,
  onNumericIssuesRemove,
}: {
  widgets: Widgets;
  checked?: (key: LocalKey) => boolean;
  disabled?: (key: LocalKey) => boolean;
  onEnabledChange?: (key: LocalKey, enabled: boolean) => void;
  onChange: (widgets: Widgets) => void;
  onNumericInvalid: (id: string, message: string | null) => void;
  onNumericIssuesRemove: (ids: string[]) => void;
}) {
  function update<K extends LocalKey>(key: K, value: Partial<Widgets[K]>) {
    onChange({ ...widgets, [key]: { ...widgets[key], ...value } });
  }
  function isEnabled(key: LocalKey) {
    return checked?.(key) ?? widgets[key].enabled;
  }
  const id = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  return (
    <>
      {(
        [
          ["notes", "Recados"],
          ["countdown", "Contagem regressiva"],
          ["birthdays", "Aniversários"],
          ["tasks", "Tarefas"],
          ["pomodoro", "Pomodoro"],
        ] as const
      ).map(([key, label]) => (
        <fieldset key={key} className="progressive-widget">
          <legend>{label}</legend>
          <p className="widget-description">
            {key === "notes"
              ? "Exiba recados em sequência."
              : key === "countdown"
                ? "Acompanhe a contagem até uma data."
                : key === "birthdays"
                  ? "Lembre os próximos aniversários."
                  : key === "tasks"
                    ? "Mostre uma lista de tarefas."
                    : "Configure ciclos locais de foco e pausa."}
          </p>
          <label className="online-toggle">
            <input
              type="checkbox"
              checked={isEnabled(key)}
              disabled={disabled?.(key)}
              onChange={(event) => {
                if (onEnabledChange) onEnabledChange(key, event.target.checked);
                else update(key, { enabled: event.target.checked });
              }}
            />{" "}
            Ativar {label}
          </label>
          {isEnabled(key) && (
            <div>
              <label>
                Título
                <input
                  maxLength={80}
                  value={widgets[key].title}
                  onChange={(event) => update(key, { title: event.target.value })}
                />
              </label>
              {key === "notes" && (
                <>
                  <ValidatedNumberField
                    id="notes.interval"
                    label="Intervalo entre recados (segundos)"
                    value={widgets.notes.intervalSeconds}
                    min={5}
                    max={3600}
                    onInvalidChange={onNumericInvalid}
                    onChange={(intervalSeconds) => update("notes", { intervalSeconds })}
                  />
                  {widgets.notes.messages.map((item, index) => (
                    <div key={item.id}>
                      <label>
                        Recado {index + 1}
                        <input
                          maxLength={500}
                          value={item.text}
                          onChange={(e) =>
                            update("notes", {
                              messages: widgets.notes.messages.map((row) =>
                                row.id === item.id ? { ...row, text: e.target.value } : row,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          update("notes", {
                            messages: widgets.notes.messages.filter((row) => row.id !== item.id),
                          })
                        }
                      >
                        Remover recado
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={widgets.notes.messages.length >= 20}
                    onClick={() =>
                      update("notes", {
                        messages: [...widgets.notes.messages, { id: id(), text: "Novo recado" }],
                      })
                    }
                  >
                    Adicionar recado
                  </button>
                </>
              )}
              {key === "countdown" && (
                <>
                  <label>
                    Data do evento
                    <input
                      type="date"
                      value={
                        widgets.countdown.target.kind === "date"
                          ? widgets.countdown.target.date
                          : widgets.countdown.target.dateTime.slice(0, 10)
                      }
                      onChange={(e) =>
                        update("countdown", { target: { kind: "date", date: e.target.value } })
                      }
                    />
                  </label>
                  <label>
                    Mensagem ao terminar
                    <input
                      maxLength={100}
                      value={widgets.countdown.completedText}
                      onChange={(e) => update("countdown", { completedText: e.target.value })}
                    />
                  </label>
                </>
              )}
              {key === "birthdays" && (
                <>
                  {widgets.birthdays.people.map((person, index) => (
                    <div key={person.id}>
                      <label>
                        Nome {index + 1}
                        <input
                          maxLength={80}
                          value={person.name}
                          onChange={(e) =>
                            update("birthdays", {
                              people: widgets.birthdays.people.map((row) =>
                                row.id === person.id ? { ...row, name: e.target.value } : row,
                              ),
                            })
                          }
                        />
                      </label>
                      <ValidatedNumberField
                        id={`birthdays.day.${person.id}`}
                        label={`Dia do aniversário de ${person.name}`}
                        value={person.day}
                        min={1}
                        max={31}
                        onInvalidChange={onNumericInvalid}
                        onChange={(day) =>
                          update("birthdays", {
                            people: widgets.birthdays.people.map((row) =>
                              row.id === person.id ? { ...row, day } : row,
                            ),
                          })
                        }
                      />
                      <ValidatedNumberField
                        id={`birthdays.month.${person.id}`}
                        label={`Mês do aniversário de ${person.name}`}
                        value={person.month}
                        min={1}
                        max={12}
                        onInvalidChange={onNumericInvalid}
                        onChange={(month) =>
                          update("birthdays", {
                            people: widgets.birthdays.people.map((row) =>
                              row.id === person.id ? { ...row, month } : row,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => {
                          onNumericIssuesRemove([
                            `birthdays.day.${person.id}`,
                            `birthdays.month.${person.id}`,
                          ]);
                          update("birthdays", {
                            people: widgets.birthdays.people.filter((row) => row.id !== person.id),
                          });
                        }}
                      >
                        Remover aniversário
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={widgets.birthdays.people.length >= 50}
                    onClick={() =>
                      update("birthdays", {
                        people: [
                          ...widgets.birthdays.people,
                          { id: id(), name: "Pessoa", day: 1, month: 1 },
                        ],
                      })
                    }
                  >
                    Adicionar aniversário
                  </button>
                  <ValidatedNumberField
                    id="birthdays.displayCount"
                    label="Quantidade exibida"
                    value={widgets.birthdays.displayCount}
                    min={1}
                    max={10}
                    onInvalidChange={onNumericInvalid}
                    onChange={(displayCount) => update("birthdays", { displayCount })}
                  />
                </>
              )}
              {key === "tasks" && (
                <>
                  {widgets.tasks.items.map((item, index) => (
                    <div key={item.id}>
                      <label>
                        Tarefa {index + 1}
                        <input
                          maxLength={200}
                          value={item.text}
                          onChange={(e) =>
                            update("tasks", {
                              items: widgets.tasks.items.map((row) =>
                                row.id === item.id ? { ...row, text: e.target.value } : row,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="online-toggle">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={(e) =>
                            update("tasks", {
                              items: widgets.tasks.items.map((row) =>
                                row.id === item.id ? { ...row, completed: e.target.checked } : row,
                              ),
                            })
                          }
                        />{" "}
                        Concluída
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          update("tasks", {
                            items: widgets.tasks.items.filter((row) => row.id !== item.id),
                          })
                        }
                      >
                        Remover tarefa
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={widgets.tasks.items.length >= 50}
                    onClick={() =>
                      update("tasks", {
                        items: [
                          ...widgets.tasks.items,
                          { id: id(), text: "Nova tarefa", completed: false },
                        ],
                      })
                    }
                  >
                    Adicionar tarefa
                  </button>
                  <label className="online-toggle">
                    <input
                      type="checkbox"
                      checked={widgets.tasks.showCompleted}
                      onChange={(e) => update("tasks", { showCompleted: e.target.checked })}
                    />{" "}
                    Mostrar concluídas
                  </label>
                </>
              )}
              {key === "pomodoro" && (
                <>
                  <ValidatedNumberField
                    id="pomodoro.work"
                    label="Foco (minutos)"
                    value={widgets.pomodoro.workMinutes}
                    min={1}
                    max={180}
                    onInvalidChange={onNumericInvalid}
                    onChange={(workMinutes) => update("pomodoro", { workMinutes })}
                  />
                  <ValidatedNumberField
                    id="pomodoro.break"
                    label="Pausa (minutos)"
                    value={widgets.pomodoro.breakMinutes}
                    min={1}
                    max={60}
                    onInvalidChange={onNumericInvalid}
                    onChange={(breakMinutes) => update("pomodoro", { breakMinutes })}
                  />
                  <small>
                    Inicie e pause o timer no player. Ao terminar uma etapa, inicie a próxima
                    manualmente; o timer não é sincronizado entre dispositivos.
                  </small>
                </>
              )}
            </div>
          )}
        </fieldset>
      ))}
    </>
  );
}
