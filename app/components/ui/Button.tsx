import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

type Common = { variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode };
type AsButton = Common & { href?: undefined; loading?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;
type AsLink = Common & { href: string; external?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href">;

const buttonClass = (variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) =>
  ["btn", `btn--${variant}`, `btn--${size}`, extra].filter(Boolean).join(" ");

/**
 * The one button. `loading` keeps the label, sets aria-busy and disables it (no double submit).
 * With `href` it renders a link that looks the same (`external` opens a new tab, safely).
 */
export default function Button(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { variant, size, className, children, href, external, ...rest } = props;
    return (
      <a className={buttonClass(variant, size, className)} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...rest}>
        {children}
      </a>
    );
  }
  const { variant, size, className, children, loading = false, disabled, type = "button", ...rest } = props;
  return (
    <button className={buttonClass(variant, size, className)} type={type} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
