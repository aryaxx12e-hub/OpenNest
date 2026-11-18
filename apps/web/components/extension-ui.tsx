"use client";

import type { ExtensionUiNode } from "@opennest/extensions";
import { Button } from "@opennest/ui";

interface ExtensionUiSurfaceProps {
  readonly tree: ExtensionUiNode;
  readonly onAction: (actionId: string) => void;
  readonly disabled?: boolean;
}

export function ExtensionUiSurface({
  tree,
  onAction,
  disabled = false,
}: ExtensionUiSurfaceProps) {
  return (
    <div className="flex flex-col gap-3 text-sm text-neutral-800 dark:text-neutral-200">
      <ExtensionUiNodeView node={tree} onAction={onAction} disabled={disabled} />
    </div>
  );
}

interface ExtensionUiNodeViewProps {
  readonly node: ExtensionUiNode;
  readonly onAction: (actionId: string) => void;
  readonly disabled: boolean;
}

function ExtensionUiNodeView({ node, onAction, disabled }: ExtensionUiNodeViewProps) {
  switch (node.type) {
    case "stack":
      return (
        <div className="flex flex-col gap-3">
          {node.children.map((child, index) => (
            <ExtensionUiNodeView
              key={index}
              node={child}
              onAction={onAction}
              disabled={disabled}
            />
          ))}
        </div>
      );
    case "heading":
      return <h3 className="text-base font-semibold">{node.text}</h3>;
    case "text":
      return <p className="break-words whitespace-pre-wrap">{node.text}</p>;
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-5">
          {node.items.map((item, index) => (
            <li key={index} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      );
    case "status":
      return <ExtensionUiStatusView tone={node.tone} text={node.text} />;
    case "button":
      return (
        <div>
          <Button
            type="button"
            size="sm"
            disabled={disabled || node.disabled === true}
            onClick={() => onAction(node.id)}
          >
            {node.label}
          </Button>
        </div>
      );
  }
}

interface ExtensionUiStatusViewProps {
  readonly tone: "info" | "success" | "warning" | "error";
  readonly text: string;
}

function ExtensionUiStatusView({ tone, text }: ExtensionUiStatusViewProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          : tone === "warning"
            ? "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            : tone === "success"
              ? "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
      }
    >
      {text}
    </div>
  );
}
