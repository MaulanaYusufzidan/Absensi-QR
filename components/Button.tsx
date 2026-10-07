"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { cx } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANT_STYLES: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-dark active:scale-[0.98] shadow-sm",
  secondary: "bg-secondary text-white hover:brightness-110 active:scale-[0.98]",
  outline: "border border-gray-300 bg-white text-foreground hover:bg-gray-50 active:scale-[0.98]",
  ghost: "text-foreground hover:bg-gray-100 active:scale-[0.98]",
  danger: "bg-danger text-white hover:brightness-110 active:scale-[0.98]",
};

// Touch-friendly: md and lg are at least 44px tall.
const SIZE_STYLES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-14 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cx(
          "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all",
          "disabled:cursor-not-allowed disabled:opacity-50",
          VARIANT_STYLES[variant],
          SIZE_STYLES[size],
          className
        )}
        {...props}
      >
        {loading && (
          <span
            aria-hidden
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
