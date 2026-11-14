import type { HTMLAttributes } from "react";

import { cn } from "./cn";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("bg-border/60 animate-pulse rounded-lg", className)}
      {...props}
    />
  );
}
