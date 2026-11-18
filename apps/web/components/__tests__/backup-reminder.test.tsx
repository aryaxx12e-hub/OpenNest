import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "@opennest/localization";

import { BackupReminder } from "../backup-reminder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-11-18T12:00:00.000Z");

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

function render(lastBackupAt: string | null) {
  act(() => {
    root?.render(
      <LocaleProvider>
        <BackupReminder lastBackupAt={lastBackupAt} now={NOW} />
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

describe("BackupReminder", () => {
  it("prompts for a first backup and links to backup settings", () => {
    render(null);

    expect(container?.textContent).toContain("Back up your library");
    expect(container?.querySelector('a[href="/settings#backup"]')?.textContent).toContain(
      "Open backup settings"
    );
  });

  it("prompts when the last backup is old and shows its date", () => {
    render("2026-10-19T12:00:00.000Z");

    expect(container?.textContent).toContain("Your backup is out of date");
    expect(container?.textContent).toContain("Oct 19, 2026");
  });

  it("renders nothing when the last backup is recent", () => {
    render("2026-11-17T12:00:00.000Z");

    expect(container?.textContent).toBe("");
  });
});
