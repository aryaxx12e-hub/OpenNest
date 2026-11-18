import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "@opennest/localization";

import { RecoveryGuide } from "../recovery-guide";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function render(error: string | null) {
  act(() => {
    root?.render(
      <LocaleProvider>
        <RecoveryGuide error={error} />
      </LocaleProvider>
    );
  });
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

describe("RecoveryGuide", () => {
  it("shows the wrong-key tip and a diagnostics link", () => {
    render("backup.errors.wrongKey");

    expect(container?.textContent).toContain("If restore fails");
    expect(container?.textContent).toContain(
      "Check the passphrase or backup key. It must match the backup you chose."
    );
    expect(container?.querySelector('a[href="/privacy"]')?.textContent).toContain(
      "Open storage diagnostics"
    );
  });

  it("shows the generic tip for an unknown error", () => {
    render("backup.errors.unexpected");

    expect(container?.textContent).toContain(
      "Try another backup copy and check that storage is available."
    );
  });

  it("renders nothing without an error", () => {
    render(null);

    expect(container?.textContent).toBe("");
  });
});
