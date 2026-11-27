"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEBOUNCE_MS,
  MIN_SUGGEST_CHARS,
  RECENTS_KEY,
  activeIndex,
  addRecent,
  buildOptions,
  comboKey,
  highlightParts,
  parseRecents,
  optionKey,
  removeRecent,
} from "@/src/lib/suggest-ui";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Submit a search for this query (already set as the value). */
  onSubmit: (query: string) => void;
  loading: boolean;
  invalid: boolean;
  describedBy: string;
};

const LIST_ID = "q-suggestions";
const optId = (i: number) => `q-opt-${i}`;
const BLUR_CLOSE_MS = 150;
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function readRecents(): string[] {
  try {
    return parseRecents(window.localStorage.getItem(RECENTS_KEY));
  } catch {
    return [];
  }
}

function writeRecents(list: string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked or full: recents simply are not kept.
  }
}

function ClockIcon() {
  return (
    <svg className="combo__icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function QueryCombobox({ value, onChange, onSubmit, loading, invalid, describedBy }: Props) {
  const [open, setOpen] = useState(false);
  // Highlighted option by identity, so a list update never moves the highlight onto another item.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Recents only render while the list is open (never on the server pass), so reading storage
  // in the initializer cannot cause a hydration mismatch.
  const [recents, setRecents] = useState<string[]>(() => (typeof window === "undefined" ? [] : readRecents()));
  const [remote, setRemote] = useState<{ q: string; items: string[] }>({ q: "", items: [] });
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memo = useRef(new Map<string, string[]>());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  const q = norm(value);

  // Debounced fetch; each keystroke cancels the pending timer and the in-flight request, so a
  // stale answer can never land (its controller is aborted before the next one starts).
  useEffect(() => {
    if (!open || q.length < MIN_SUGGEST_CHARS) return;
    const cached = memo.current.get(q);
    const ctrl = new AbortController();
    const fetchSuggestions = async () => {
      if (cached) {
        setRemote({ q, items: cached });
        return;
      }
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { suggestions?: unknown };
        if (ctrl.signal.aborted) return;
        const items = Array.isArray(data.suggestions)
          ? data.suggestions.filter((s): s is string => typeof s === "string")
          : [];
        memo.current.set(q, items);
        setRemote({ q, items });
      } catch {
        // Aborted or offline: keep what is shown.
      }
    };
    const timer = setTimeout(() => void fetchSuggestions(), cached ? 0 : DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, open]);

  // While the answer for the current text is on its way, keep earlier remote items that still fit it.
  const remoteItems = useMemo(
    () => (remote.q === q ? remote.items : remote.items.filter((s) => s.toLowerCase().includes(q))),
    [remote, q],
  );
  const options = useMemo(() => buildOptions(recents, remoteItems, value), [recents, remoteItems, value]);
  const shown = open && options.length > 0;
  const activeIdx = shown ? activeIndex(options, activeKey) : -1;
  const setActive = (i: number) => setActiveKey(i >= 0 && options[i] ? optionKey(options[i]) : null);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const remember = (query: string) => {
    const next = addRecent(readRecents(), query);
    setRecents(next);
    writeRecents(next);
  };

  // A form submit (Enter with nothing highlighted, or the Search button) closes the list and
  // remembers the query; picking a suggestion submits through onSubmit instead.
  const valueRef = useRef(value);
  const rememberRef = useRef(remember);
  useEffect(() => {
    valueRef.current = value;
    rememberRef.current = remember;
  });
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onFormSubmit = () => {
      setOpen(false);
      setActiveKey(null);
      if (valueRef.current.trim()) rememberRef.current(valueRef.current);
    };
    form.addEventListener("submit", onFormSubmit);
    return () => form.removeEventListener("submit", onFormSubmit);
  }, []);

  const submit = (query: string) => {
    close();
    remember(query);
    onSubmit(query);
  };

  const select = (i: number) => {
    const o = options[i];
    if (!o) return;
    onChange(o.value);
    submit(o.value);
  };

  return (
    <div className="combo">
      <input
        ref={inputRef}
        id="q"
        name="q"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={LIST_ID}
        aria-activedescendant={activeIdx >= 0 ? optId(activeIdx) : undefined}
        className="input input--query"
        autoComplete="off"
        enterKeyHint="search"
        spellCheck={false}
        maxLength={200}
        placeholder="anc earbuds under 300"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          // Do not pop the list over a search in progress; typing still opens it.
          if (!loading) setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(close, BLUR_CLOSE_MS);
        }}
        onKeyDown={(e) => {
          const act = comboKey(e.key, { open: shown, active: activeIdx, count: options.length }, e.shiftKey);
          switch (act.type) {
            case "move":
              e.preventDefault();
              setOpen(true);
              setActive(act.active);
              break;
            case "select":
              e.preventDefault();
              select(act.index);
              break;
            case "close":
              if (act.preventDefault) e.preventDefault();
              close();
              break;
            case "remove": {
              e.preventDefault();
              const o = options[act.index];
              if (o?.recent) {
                const next = removeRecent(recents, o.value);
                setRecents(next);
                writeRecents(next);
                setActive(-1);
              }
              break;
            }
          }
        }}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
      />
      {value !== "" && (
        <button
          type="button"
          className="combo__clear"
          aria-label="Clear search text"
          title="Clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            setActive(-1);
            inputRef.current?.focus();
            setOpen(true);
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <ul id={LIST_ID} role="listbox" aria-label="Suggestions" className="combo__list" hidden={!shown}>
        {shown &&
          options.map((o, i) => (
            <li
              key={optionKey(o)}
              id={optId(i)}
              role="option"
              aria-selected={i === activeIdx}
              className={o.recent ? "combo__opt combo__opt--recent" : "combo__opt"}
              // Keep focus in the input so blur does not close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(i)}
              onMouseMove={() => i !== activeIdx && setActive(i)}
            >
              {o.recent && <ClockIcon />}
              <span className="combo__text">
                {highlightParts(o.value, value).map((p, j) =>
                  p.typed ? <span key={j}>{p.text}</span> : <strong key={j} className="combo__rest">{p.text}</strong>,
                )}
              </span>
              {o.recent && <span className="combo__tag">recent</span>}
            </li>
          ))}
      </ul>
    </div>
  );
}
