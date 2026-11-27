/** Lowercase tokens; hyphenated tokens (usb-c, wh-1000xm4) stay joined; 1-char tokens dropped. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 1);
}

/** Like tokenize but keeps 1-char tokens that are digits (model numbers such as "AirPods 2"). */
export function tokenizeKeepDigits(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 1 || /\d/.test(t));
}

const HAS_DIGIT = /\d/;
export const hasDigit = (t: string) => HAS_DIGIT.test(t);

/** Alternate forms of a token: itself, hyphen-free join, and (digit-free tokens only) parts of 2+ chars. */
export function tokenForms(t: string): string[] {
  if (!t.includes("-")) return [t];
  const forms = [t, t.replace(/-/g, "")];
  if (!hasDigit(t)) for (const p of t.split("-")) if (p.length > 1) forms.push(p);
  return forms;
}
