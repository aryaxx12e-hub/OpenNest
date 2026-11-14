import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="border-border bg-surface rounded-2xl border border-dashed p-8 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted mx-auto mt-1 max-w-md text-sm leading-6">{description}</p>
      {action === undefined ? null : (
        <div className="mt-4 flex justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
