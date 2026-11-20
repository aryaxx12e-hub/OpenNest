import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="border-border bg-surface rounded-card border p-8 text-center shadow-sm">
      {icon === undefined ? null : (
        <span className="bg-primary-soft text-primary rounded-control mx-auto mb-3 grid size-12 place-items-center">
          {icon}
        </span>
      )}
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-muted mx-auto mt-1 max-w-md text-sm leading-6">{description}</p>
      {action === undefined ? null : (
        <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
