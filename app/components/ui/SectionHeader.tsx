import type { ReactNode } from "react";

/** A section or page title, an optional note under it, and actions at the end of the row. */
export default function SectionHeader({ title, as = "h2", id, note, actions }: { title: ReactNode; as?: "h1" | "h2"; id?: string; note?: ReactNode; actions?: ReactNode }) {
  const Tag = as;
  return (
    <div className={as === "h1" ? "section-head section-head--page" : "section-head"}>
      <div className="section-head__text">
        <Tag id={id} className="section-head__title">
          {title}
        </Tag>
        {note && <p className="section-head__note">{note}</p>}
      </div>
      {actions && <div className="section-head__actions">{actions}</div>}
    </div>
  );
}
