"use client";

import { useEffect, useId, useRef, useState } from "react";
import Button from "./ui/Button";
import Input from "./ui/Input";

type ClipboardLike = { writeText?: (text: string) => Promise<void> } | undefined;
type DocLike = {
  createElement: (tag: "textarea") => HTMLTextAreaElement;
  body: { appendChild: (n: Node) => unknown; removeChild: (n: Node) => unknown };
  execCommand?: (cmd: string) => boolean;
};

/**
 * Copies `text`: the Clipboard API first, then the older select-and-copy command. Resolves true
 * when either worked; false means the page should show the link for the user to copy by hand.
 */
export async function copyText(text: string, clipboard: ClipboardLike, doc: DocLike | undefined): Promise<boolean> {
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission, not focused): try the older way.
  }
  if (!doc?.execCommand) return false;
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  doc.body.appendChild(area);
  try {
    area.select();
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    doc.body.removeChild(area);
  }
}

/** How long "Link copied" stays (ms). */
const SHOWN = 4000;

/**
 * "Copy link": copies this results page's URL, which carries the search, the filters and the
 * compare selection. "Link copied" is announced (role=status); when copying is not allowed, the
 * link is shown selected in a field to copy by hand.
 */
export default function CopyLink() {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [url, setUrl] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setState("idle"), SHOWN);
    return () => clearTimeout(t);
  }, [state]);
  useEffect(() => {
    if (state === "manual") field.current?.select();
  }, [state]);

  return (
    <div className="copylink">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const href = window.location.href;
          setUrl(href);
          void copyText(href, typeof navigator === "undefined" ? undefined : navigator.clipboard, document).then((ok) => setState(ok ? "copied" : "manual"));
        }}
      >
        Copy link
      </Button>
      <p className={state === "copied" ? "copylink__done" : "visually-hidden"} role="status">
        {state === "copied" ? "Link copied" : ""}
      </p>
      {state === "manual" && (
        <div className="copylink__manual">
          <label htmlFor={id} className="label">
            Copying is blocked here. Copy this link:
          </label>
          <div className="copylink__row">
            <Input id={id} ref={field} size="compact" className="copylink__field" readOnly value={url} onFocus={(e) => e.target.select()} />
            <Button size="sm" variant="ghost" onClick={() => setState("idle")}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
