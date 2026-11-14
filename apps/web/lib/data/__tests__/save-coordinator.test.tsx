import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { SaveCoordinatorProvider, useSaveCoordinator } from "../save-coordinator";
import {
  createSaveCoordinator,
  type SaveCoordinator,
} from "@/lib/autosave/save-coordinator";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

function Probe({ onValue }: { onValue: (value: SaveCoordinator) => void }) {
  onValue(useSaveCoordinator());
  return null;
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});

describe("SaveCoordinatorProvider", () => {
  it("provides one stable coordinator for the whole tree", () => {
    const values: SaveCoordinator[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <SaveCoordinatorProvider>
          <Probe onValue={(value) => values.push(value)} />
        </SaveCoordinatorProvider>
      );
    });

    act(() => {
      root.render(
        <SaveCoordinatorProvider>
          <Probe onValue={(value) => values.push(value)} />
        </SaveCoordinatorProvider>
      );
    });

    expect(values.length).toBeGreaterThan(1);
    expect(new Set(values).size).toBe(1);
  });

  it("accepts an injected coordinator for tests", () => {
    const coordinator = createSaveCoordinator();
    let received: SaveCoordinator | null = null;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <SaveCoordinatorProvider coordinator={coordinator}>
          <Probe onValue={(value) => (received = value)} />
        </SaveCoordinatorProvider>
      );
    });

    expect(received).toBe(coordinator);
  });
});
