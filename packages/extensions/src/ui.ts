import { z } from "zod";

import { ExtensionError } from "./errors";

export const EXTENSION_MAX_UI_NODES = 200;
export const EXTENSION_MAX_UI_DEPTH = 6;
export const EXTENSION_MAX_UI_TEXT_LENGTH = 2_000;

const textSchema = z.string().max(EXTENSION_MAX_UI_TEXT_LENGTH);
const buttonIdSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);

export interface ExtensionUiStack {
  readonly type: "stack";
  readonly children: readonly ExtensionUiNode[];
}

export interface ExtensionUiHeading {
  readonly type: "heading";
  readonly text: string;
}

export interface ExtensionUiText {
  readonly type: "text";
  readonly text: string;
}

export interface ExtensionUiList {
  readonly type: "list";
  readonly items: readonly string[];
}

export interface ExtensionUiStatus {
  readonly type: "status";
  readonly tone: "info" | "success" | "warning" | "error";
  readonly text: string;
}

export interface ExtensionUiButton {
  readonly type: "button";
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export type ExtensionUiNode =
  | ExtensionUiStack
  | ExtensionUiHeading
  | ExtensionUiText
  | ExtensionUiList
  | ExtensionUiStatus
  | ExtensionUiButton;

export const extensionUiNodeSchema: z.ZodType<ExtensionUiNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("stack"),
      children: z.array(extensionUiNodeSchema).max(EXTENSION_MAX_UI_NODES),
    }),
    z.strictObject({
      type: z.literal("heading"),
      text: textSchema,
    }),
    z.strictObject({
      type: z.literal("text"),
      text: textSchema,
    }),
    z.strictObject({
      type: z.literal("list"),
      items: z.array(textSchema).max(50),
    }),
    z.strictObject({
      type: z.literal("status"),
      tone: z.enum(["info", "success", "warning", "error"]),
      text: textSchema,
    }),
    z.strictObject({
      type: z.literal("button"),
      id: buttonIdSchema,
      label: z.string().min(1).max(80),
      disabled: z.boolean().optional(),
    }),
  ])
);

interface UiStats {
  nodes: number;
  depth: number;
}

function collectStats(node: ExtensionUiNode, depth: number, stats: UiStats): void {
  stats.nodes += 1;
  stats.depth = Math.max(stats.depth, depth);

  if (node.type === "stack") {
    for (const child of node.children) {
      collectStats(child, depth + 1, stats);
    }
  }
}

export function validateExtensionUiTree(value: unknown): ExtensionUiNode {
  const result = extensionUiNodeSchema.safeParse(value);

  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue?.path.join(".") || "tree";

    throw new ExtensionError(
      "ui_invalid",
      `${location}: ${issue?.message ?? "Invalid UI."}`
    );
  }

  const stats: UiStats = { nodes: 0, depth: 0 };
  collectStats(result.data, 1, stats);

  if (stats.nodes > EXTENSION_MAX_UI_NODES) {
    throw new ExtensionError(
      "ui_invalid",
      `UI tree has ${stats.nodes} nodes, maximum is ${EXTENSION_MAX_UI_NODES}.`
    );
  }

  if (stats.depth > EXTENSION_MAX_UI_DEPTH) {
    throw new ExtensionError(
      "ui_invalid",
      `UI tree is ${stats.depth} levels deep, maximum is ${EXTENSION_MAX_UI_DEPTH}.`
    );
  }

  return result.data;
}
