"use client";

import { useId, useState } from "react";

type Props = {
  /** Field label, e.g. "Alert me at or under, SAR". */
  label: string;
  initial: number;
  /** Saves the target; resolves to an error message, or null when saved. */
  onSave: (target: number) => Promise<string | null>;
  onCancel: () => void;
};

/** Small inline form: one price field, Save and Cancel. */
export default function WatchForm({ label, initial, onSave, onCancel }: Props) {
  const id = useId();
  const [value, setValue] = useState(String(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = Number(value.trim());
    if (!value.trim() || !Number.isFinite(n) || n <= 0) {
      setError("Enter a price above 0");
      return;
    }
    setBusy(true);
    const err = await onSave(n);
    setBusy(false);
    setError(err);
  }

  return (
    <form
      className="watch-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`${id}-t`} className="label">
        {label}
      </label>
      <div className="watch-form__row">
        <input
          id={`${id}-t`}
          className="input input--compact"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          autoComplete="off"
          autoFocus
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-e` : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="btn btn--primary btn--small" disabled={busy} aria-busy={busy || undefined}>
          Save
        </button>
        <button type="button" className="btn btn--quiet btn--small" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p id={`${id}-e`} className="helper helper--error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** POSTs a new watch; resolves to an error message or null. */
export async function postWatch(body: Record<string, unknown>): Promise<string | null> {
  try {
    const r = await fetch("/api/watches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return null;
    const d = (await r.json().catch(() => null)) as { error?: string } | null;
    return d?.error ?? "Could not save the alert";
  } catch {
    return "Could not reach the app server";
  }
}
