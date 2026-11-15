"use client";

import { useState } from "react";

export function ValidatedNumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
  onInvalidChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onInvalidChange: (id: string, message: string | null) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState("");
  function edit(raw: string) {
    setDraft(raw);
    const number = raw === "" ? NaN : Number(raw);
    const message =
      raw === ""
        ? "Informe um valor."
        : !Number.isInteger(number)
          ? "Informe um número inteiro."
          : number < min || number > max
            ? `Use um valor entre ${min} e ${max}.`
            : "";
    setError(message);
    onInvalidChange(id, message || null);
    if (!message) onChange(number);
  }
  return (
    <label className="validated-number-field">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step="1"
        value={error ? draft : String(value)}
        aria-invalid={!!error}
        aria-describedby={`${id}-error`}
        onChange={(event) => edit(event.currentTarget.value)}
      />
      <small id={`${id}-error`} className="field-error" aria-live="polite">
        {error}
      </small>
    </label>
  );
}
