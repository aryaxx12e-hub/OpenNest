import type { InputHTMLAttributes } from "react";

import { cn } from "./cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        "border-border bg-surface text-foreground min-h-11 w-full rounded-xl border px-3 text-sm",
        "placeholder:text-muted",
        "focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
}
