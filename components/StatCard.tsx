import { cx } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "secondary" | "neutral";

interface StatCardProps {
  label: string;
  value: number | string;
  tone?: Tone;
  className?: string;
}

const TONE_STYLES: Record<Tone, string> = {
  success: "bg-success text-white",
  warning: "bg-warning text-gray-900",
  danger: "bg-danger text-white",
  secondary: "bg-secondary text-white",
  neutral: "border border-gray-200 bg-white text-foreground",
};

/** Summary tile. `value` always comes from the API; never pass a hard-coded number. */
export function StatCard({ label, value, tone = "neutral", className }: StatCardProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-1 rounded-2xl p-5 shadow-sm",
        TONE_STYLES[tone],
        className
      )}
    >
      <span className="text-3xl font-bold tabular-nums sm:text-4xl">{value}</span>
      <span
        className={cx(
          "text-center text-xs font-medium sm:text-sm",
          tone === "neutral" ? "text-muted" : "opacity-90"
        )}
      >
        {label}
      </span>
    </div>
  );
}
