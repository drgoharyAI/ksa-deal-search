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
