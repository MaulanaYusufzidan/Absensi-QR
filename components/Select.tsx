"use client";

import { SelectHTMLAttributes, forwardRef, useId } from "react";
import { cx } from "@/lib/utils";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, id, children, ...props }, ref) => {
    const autoId = useId();
    const selectId = id ?? props.name ?? autoId;
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cx(
            "h-11 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-sm",
            "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
            "disabled:bg-gray-100 disabled:text-muted",
            className
          )}
          {...props}
        >
          {children}
        </select>
      </div>
    );
  }
);
Select.displayName = "Select";
