import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@opennest/localization";

import type { StorageStatus } from "../../lib/privacy/storage-status";
import { StorageDiagnostics } from "../storage-diagnostics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function render(status: StorageStatus, onRequestPersist = vi.fn()) {
  act(() => {
    root?.render(
      <LocaleProvider>
        <StorageDiagnostics
          status={status}
          busy={false}
          onRequestPersist={onRequestPersist}
        />
      </LocaleProvider>
    );
  });

  return onRequestPersist;
}

beforeEach(() => {
  window.localStorage.clear();
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

describe("StorageDiagnostics", () => {
  it("shows usage, quota, persistence, and the request action", () => {
    render({
      supported: true,
      usage: 1536,
      quota: 2 * 1024 * 1024,
      persisted: false,
    });

    expect(container?.textContent).toContain("Browser storage");
    expect(container?.textContent).toContain("1.5 KB");
    expect(container?.textContent).toContain("2 MB");
    expect(container?.textContent).toContain("Not granted");
    expect(container?.textContent).toContain("Keep this data");
  });

  it("requests persistence when the action is clicked", () => {
    const onRequestPersist = render({
      supported: true,
      usage: 1536,
      quota: 2 * 1024 * 1024,
      persisted: false,
    });
    const button = Array.from(container?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent === "Keep this data"
    );

    act(() => button?.click());

    expect(onRequestPersist).toHaveBeenCalledTimes(1);
  });

  it("explains unsupported diagnostics without a request action", () => {
    render({
      supported: false,
      usage: null,
      quota: null,
      persisted: null,
    });

    expect(container?.textContent).toContain(
      "This browser does not report storage diagnostics."
    );
    expect(container?.querySelector("button")).toBeNull();
  });
});
