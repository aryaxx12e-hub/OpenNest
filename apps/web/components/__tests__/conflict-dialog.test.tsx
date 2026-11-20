import { randomUUID } from "node:crypto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncConflictRow } from "@opennest/sync";
import { LocaleProvider } from "@opennest/localization";

import { ConflictDialog } from "../conflict-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-11-19T12:00:00.000Z";

function conflict(): SyncConflictRow {
  return {
    conflictId: randomUUID(),
    workspaceId: randomUUID(),
    entityType: "note",
    entityId: randomUUID(),
    fieldPath: "title",
    localFieldRevision: 2,
    remoteFieldRevision: 3,
    localOpId: randomUUID(),
    remoteOpId: randomUUID(),
    localValue: "My title",
    remoteValue: "Their title",
    localDeviceId: randomUUID(),
    remoteDeviceId: randomUUID(),
    createdAt: NOW,
    state: "open",
    resolution: null,
    resolvedAt: null,
    resolvedByDeviceId: null,
  };
}

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function findButton(text: string): HTMLButtonElement {
  const button = [...(container?.querySelectorAll("button") ?? [])].find((item) =>
    item.textContent?.includes(text)
  );

  if (button === undefined) {
    throw new Error(`Button not found: ${text}`);
  }

  return button as HTMLButtonElement;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  container = undefined;
  root = undefined;
  vi.restoreAllMocks();
});

describe("ConflictDialog", () => {
  it("shows both values and resolves with the local choice", async () => {
    const item = conflict();
    const onResolve = vi.fn(async () => undefined);
    const onClose = vi.fn();

    act(() => {
      root?.render(
        <LocaleProvider>
          <ConflictDialog conflict={item} onResolve={onResolve} onClose={onClose} />
        </LocaleProvider>
      );
    });

    expect(container?.textContent).toContain("My title");
    expect(container?.textContent).toContain("Their title");

    await act(async () => {
      findButton("Keep mine").click();
      await Promise.resolve();
    });

    expect(onResolve).toHaveBeenCalledWith("local", "My title");
    expect(onClose).toHaveBeenCalled();
  });

  it("resolves with the remote choice", async () => {
    const item = conflict();
    const onResolve = vi.fn(async () => undefined);
    const onClose = vi.fn();

    act(() => {
      root?.render(
        <LocaleProvider>
          <ConflictDialog conflict={item} onResolve={onResolve} onClose={onClose} />
        </LocaleProvider>
      );
    });

    await act(async () => {
      findButton("Use server version").click();
      await Promise.resolve();
    });

    expect(onResolve).toHaveBeenCalledWith("remote", "Their title");
    expect(onClose).toHaveBeenCalled();
  });
});
