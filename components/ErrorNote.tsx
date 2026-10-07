import { AlertCircle } from "lucide-react";

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
    >
      <span className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
        {message}
      </span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 font-semibold underline">
          Coba lagi
        </button>
      )}
    </div>
  );
}
