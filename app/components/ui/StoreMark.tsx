import { storeLabel } from "@/src/lib/stores";
import StoreLogo from "../StoreLogo";

/**
 * A store's identity: its own logo and name ("full"), or the logo alone with the name kept for
 * screen readers and as a tooltip ("compact").
 */
export default function StoreMark({ id, variant = "full", size = 20 }: { id: string; variant?: "full" | "compact"; size?: number }) {
  const name = storeLabel(id);
  return (
    <span className={`storemark storemark--${variant}`} title={variant === "compact" ? name : undefined}>
      <StoreLogo id={id} size={size} />
      <span className={variant === "compact" ? "visually-hidden" : "storemark__name"}>{name}</span>
    </span>
  );
}
