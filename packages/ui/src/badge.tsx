import type { HTMLAttributes } from "react";

import { cn } from "./cn";

export type BadgeTone = "neutral" | "primary" | "success" | "warning";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-border bg-background text-muted",
  primary: "border-primary/30 bg-primary/10 text-primary",
  success: "border-green-700/30 bg-green-700/10 text-green-800 dark:text-green-300",
  warning: "border-amber-700/30 bg-amber-700/10 text-amber-800 dark:text-amber-300",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className
      )}
      {...props}
    />
  );
}
