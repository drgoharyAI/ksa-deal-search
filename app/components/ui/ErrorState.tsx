import Button from "./Button";

/** A failure the user can read (and retry, when `onRetry` is given). Announced as an alert. */
export default function ErrorState({ message, onRetry, retryLabel = "Try again" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="notice notice--error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/** Words for the server's safety caps when its answer carries no message of its own. */
const STATUS_WORDS: Record<number, string> = {
  409: "That limit is reached; remove one and try again",
  413: "The request is too large",
  429: "Too many requests; wait a minute and try again",
  503: "Busy, try again in a moment",
};

/**
 * The message for a failed response: the server's own `error` string when the body has one (the
 * safety caps always do), else words for its status, else `fallback`. Never throws.
 */
export async function responseError(r: Pick<Response, "status" | "json">, fallback: string): Promise<string> {
  const d = (await r.json().catch(() => null)) as { error?: unknown } | null;
  if (d && typeof d.error === "string" && d.error.trim()) return d.error;
  return STATUS_WORDS[r.status] ?? fallback;
}
