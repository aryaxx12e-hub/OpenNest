import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "@opennest/localization";

import { PrivacyOverview } from "../privacy-overview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("PrivacyOverview", () => {
  it("shows storage usage, item counts, and the backup exclusion notice", () => {
    act(() => {
      root?.render(
        <LocaleProvider>
          <PrivacyOverview
            overview={{
              bytes: 1536,
              blobItems: 1,
              files: 1,
              notes: 2,
              folders: 3,
              tags: 4,
              totalItems: 10,
              grants: 5,
              auditEntries: 6,
              drafts: 1,
            }}
          />
        </LocaleProvider>
      );
    });

    expect(container?.textContent).toContain("1.5 KB");
    expect(container?.textContent).toContain("Drafts");
    expect(container?.textContent).toMatch(/not included in backup v1/i);
  });
});
