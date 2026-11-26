/** Lowercase tokens; hyphenated tokens (usb-c, wh-1000xm4) stay joined; 1-char tokens dropped. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 1);
}
