import type { InputHTMLAttributes, Ref } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: "md" | "compact";
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
};

/** A text or number field with the shared focus ring; `invalid` sets aria-invalid and the error edge. */
export default function Input({ size = "md", invalid = false, className, ref, ...rest }: Props) {
  const cls = ["input", size === "compact" && "input--compact", className].filter(Boolean).join(" ");
  return <input ref={ref} className={cls} aria-invalid={invalid || undefined} {...rest} />;
}
