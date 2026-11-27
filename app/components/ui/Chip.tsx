import type { ReactNode } from "react";

type Common = { children: ReactNode; className?: string };
type CheckboxChip = Common & {
  kind: "checkbox";
  checked: boolean;
  onChange: (checked: boolean) => void;
  name?: string;
  value?: string;
  describedBy?: string;
};
type ToggleChip = Common & { kind: "toggle"; pressed: boolean; onToggle: () => void };

/**
 * A selectable chip, 44px tall. "checkbox": a real checkbox inside a label (stores, facets);
 * "toggle": a button with aria-pressed (rating, only discounted). Selected shows an ink edge and a
 * check mark, so it never relies on colour alone.
 */
export default function Chip(props: CheckboxChip | ToggleChip) {
  const cls = ["chip", props.className].filter(Boolean).join(" ");
  if (props.kind === "toggle") {
    return (
      <button type="button" className={cls} aria-pressed={props.pressed} onClick={props.onToggle}>
        {props.children}
      </button>
    );
  }
  return (
    <label className={cls}>
      <input
        type="checkbox"
        name={props.name}
        value={props.value}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        aria-describedby={props.describedBy}
      />
      {props.children}
    </label>
  );
}
