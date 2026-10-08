"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "@/lib/utils";

interface AttendanceHistoryProps {
  /** Selected date, YYYY-MM-DD. */
  selected: string;
  onSelect: (date: string) => void;
}

const DAY_LABEL = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

// Dates are handled as UTC calendar days so the result never depends on the browser timezone.
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

export function AttendanceHistory({ selected, onSelect }: AttendanceHistoryProps) {
  const selectedDate = useMemo(() => parseISO(selected), [selected]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(selectedDate, i - 3)),
    [selectedDate]
  );

  const rangeLabel = `${days[0].getUTCDate()}–${days[6].getUTCDate()} ${new Intl.DateTimeFormat("id-ID", {
    month: "long",
    timeZone: "UTC",
  }).format(days[6])}`;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted">{rangeLabel}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSelect(toISO(addDays(selectedDate, -7)))}
            aria-label="Minggu sebelumnya"
            className="rounded-full bg-primary p-2 text-white hover:brightness-110"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => onSelect(toISO(addDays(selectedDate, 7)))}
            aria-label="Minggu berikutnya"
            className="rounded-full bg-primary p-2 text-white hover:brightness-110"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => {
          const iso = toISO(d);
          const isSelected = iso === selected;
          return (
            <button
              key={iso}
              onClick={() => onSelect(iso)}
              aria-pressed={isSelected}
              aria-label={iso}
              className={cx(
                "flex min-h-11 min-w-[60px] flex-col items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium transition-colors",
                isSelected ? "bg-primary text-white shadow-md" : "bg-gray-100 text-foreground/80 hover:bg-gray-200"
              )}
            >
              <span>{DAY_LABEL[d.getUTCDay()]}</span>
              <span
                className={cx(
                  "flex h-7 w-7 items-center justify-center rounded-full font-bold",
                  isSelected ? "bg-white/20" : "bg-white"
                )}
              >
                {d.getUTCDate()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
