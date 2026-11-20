import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "@opennest/localization";

import { SyncStatus } from "../sync-status";
import type { SyncStatus as SyncStatusValue } from "@/lib/sync/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels: Array<[SyncStatusValue, string]> = [
  ["connecting", "Connecting"],
  ["online", "Online"],
  ["offline", "Offline"],
  ["syncing", "Syncing"],
  ["error", "Sync error"],
  ["disabled", "Sync off"],
];

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

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
});

describe("SyncStatus", () => {
  it("renders every sync state", () => {
    for (const [status, label] of labels) {
      act(() => {
        root?.render(
          <LocaleProvider>
            <SyncStatus status={status} pendingCount={2} />
          </LocaleProvider>
        );
      });

      expect(container?.textContent).toContain(label);
      expect(container?.querySelector('[role="status"]')).not.toBeNull();
    }
  });
});
