import type { AttendanceStatus } from "@/lib/types";
import { STATUS_LABEL, STATUS_STYLES, cx } from "@/lib/utils";

export function StatusBadge({ status }: { status: AttendanceStatus }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        STATUS_STYLES[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
