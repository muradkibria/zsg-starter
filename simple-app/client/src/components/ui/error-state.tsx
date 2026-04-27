import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "./button";

interface ErrorStateProps {
  title?: string;
  message?: string;
  error?: unknown;
  onRetry?: () => void;
  variant?: "card" | "inline" | "page";
}

function getErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const e = error as { message?: string; error?: string; detail?: string };
    return e.message ?? e.error ?? e.detail ?? "Unknown error";
  }
  return String(error);
}

function getStatusHint(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { status?: number };
  if (e.status === 502) return "The Colorlight Cloud is not reachable from this server.";
  if (e.status === 501) return "This feature isn't available yet.";
  if (e.status === 401 || e.status === 403) return "Authentication with Colorlight failed. Check server credentials.";
  if (e.status === 404) return "Not found.";
  return null;
}

export function ErrorState({
  title = "Couldn't load data",
  message,
  error,
  onRetry,
  variant = "card",
}: ErrorStateProps) {
  const detail = message ?? getErrorMessage(error);
  const hint = getStatusHint(error);

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive py-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">— {detail}</span>
        {onRetry && (
          <Button variant="ghost" size="sm" className="h-6 px-2 ml-auto" onClick={onRetry}>
            <RefreshCcw className="h-3 w-3 mr-1" /> Retry
          </Button>
        )}
      </div>
    );
  }

  const containerCls =
    variant === "page"
      ? "py-16 max-w-md mx-auto text-center"
      : "border border-destructive/30 bg-destructive/5 rounded-lg p-6 text-center";

  return (
    <div className={containerCls}>
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10 text-destructive mb-3">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{detail}</p>
      {hint && <p className="text-xs text-muted-foreground mt-2">{hint}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Try again
        </Button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  message?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export function EmptyState({ title, message, action, icon }: EmptyStateProps) {
  return (
    <div className="border border-dashed rounded-lg py-12 px-6 text-center">
      {icon && <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted text-muted-foreground mb-3">{icon}</div>}
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
