import { cx } from "@/lib/utils";

/** Placeholder block shown while data is loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-lg bg-gray-200", className)} />;
}
