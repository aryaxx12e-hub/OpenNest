import type { SelectHTMLAttributes } from "react";

import { cn } from "./cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "border-border bg-surface text-foreground min-h-11 w-full rounded-xl border px-3 text-sm",
        "focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}
