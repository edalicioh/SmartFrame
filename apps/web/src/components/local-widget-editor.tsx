"use client";

import type { OnlineDashboard } from "@smartframe/contracts";

type Widgets = OnlineDashboard["widgets"];
type LocalKey = "notes" | "countdown" | "birthdays" | "tasks" | "pomodoro";

export function LocalWidgetEditor({
  widgets,
  onChange,
}: {
  widgets: Widgets;
  onChange: (widgets: Widgets) => void;
}) {
  function update<K extends LocalKey>(key: K, value: Partial<Widgets[K]>) {
    onChange({ ...widgets, [key]: { ...widgets[key], ...value } });
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
        <fieldset key={key}>
          <legend>{label}</legend>
          <label className="online-toggle">
            <input
              type="checkbox"
              checked={widgets[key].enabled}
              onChange={(event) => update(key, { enabled: event.target.checked })}
            />{" "}
            Ativar {label}
          </label>
          {widgets[key].enabled && (
            <label>
              Título
              <input
                maxLength={80}
                value={widgets[key].title}
                onChange={(event) => update(key, { title: event.target.value })}
              />
            </label>
          )}
          {key === "notes" && widgets.notes.enabled && (
            <>
              <label>
                Intervalo entre recados (segundos)
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={widgets.notes.intervalSeconds}
                  onChange={(e) => update("notes", { intervalSeconds: Number(e.target.value) })}
                />
              </label>
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
          {key === "countdown" && widgets.countdown.enabled && (
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
          {key === "birthdays" && widgets.birthdays.enabled && (
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
                  <label>
                    Dia
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={person.day}
                      onChange={(e) =>
                        update("birthdays", {
                          people: widgets.birthdays.people.map((row) =>
                            row.id === person.id ? { ...row, day: Number(e.target.value) } : row,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Mês
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={person.month}
                      onChange={(e) =>
                        update("birthdays", {
                          people: widgets.birthdays.people.map((row) =>
                            row.id === person.id ? { ...row, month: Number(e.target.value) } : row,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      update("birthdays", {
                        people: widgets.birthdays.people.filter((row) => row.id !== person.id),
                      })
                    }
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
              <label>
                Quantidade exibida
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={widgets.birthdays.displayCount}
                  onChange={(e) => update("birthdays", { displayCount: Number(e.target.value) })}
                />
              </label>
            </>
          )}
          {key === "tasks" && widgets.tasks.enabled && (
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
          {key === "pomodoro" && widgets.pomodoro.enabled && (
            <>
              <label>
                Foco (minutos)
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={widgets.pomodoro.workMinutes}
                  onChange={(e) => update("pomodoro", { workMinutes: Number(e.target.value) })}
                />
              </label>
              <label>
                Pausa (minutos)
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={widgets.pomodoro.breakMinutes}
                  onChange={(e) => update("pomodoro", { breakMinutes: Number(e.target.value) })}
                />
              </label>
              <small>
                Inicie e pause o timer no player. Ao terminar uma etapa, inicie a próxima
                manualmente; o timer não é sincronizado entre dispositivos.
              </small>
            </>
          )}
        </fieldset>
      ))}
    </>
  );
}
