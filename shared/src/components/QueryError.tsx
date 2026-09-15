import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "./ui/button";

/**
 * Standard query-failure banner (review P1-11): a failed query must never
 * render as an empty list or silent nothing. Red left-border strip with the
 * error message and a Retry button (the design-kit "ErrorBanner").
 */
export function QueryError({
  title = "Could not load data",
  message,
  onRetry,
  retrying = false,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-md border border-crit/40 border-l-4 border-l-crit bg-crit/10 px-4 py-3"
    >
      <CircleAlert className="h-4 w-4 flex-none text-crit" />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-crit">
          {title}
        </p>
        {message && (
          <p className="truncate font-mono text-xs text-crit/80" title={message}>
            {message}
          </p>
        )}
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="flex-none border-crit/40 text-crit hover:bg-crit/10"
          disabled={retrying}
          onClick={onRetry}
        >
          <RotateCw className={retrying ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"} />
          Retry
        </Button>
      )}
    </div>
  );
}
