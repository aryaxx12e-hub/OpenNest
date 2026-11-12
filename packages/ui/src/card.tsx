import type { HTMLAttributes } from "react";

import { cn } from "./cn";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "border-border bg-surface rounded-2xl border p-5 shadow-sm",
        className
      )}
      {...props}
    />
  );
}
