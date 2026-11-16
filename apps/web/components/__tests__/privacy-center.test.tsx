import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { AppDataProvider } from "@/lib/data/app-data-provider";

import { PrivacyCenter } from "../privacy-center";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function settle() {
  for (let index = 0; index < 50; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (button === undefined) {
    throw new Error(`No button named ${text}`);
  }

  return button;
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AppDataProvider openStorage={async () => createMemoryStorage()}>
          <PrivacyCenter />
        </AppDataProvider>
      </LocaleProvider>
    );
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = undefined;
  container = undefined;
});

describe("PrivacyCenter", () => {
  it("shows the inventory and requires confirmation before deleting all data", async () => {
    await settle();

    expect(container?.textContent).toContain("Privacy Center");
    expect(container?.textContent).toContain("Data inventory");
    expect(container?.textContent).toContain("Audit log");
    expect(container?.textContent).toContain("Sync outbox");
    expect(container?.textContent).toContain(
      "Recovery drafts, permission grants, audit entries, search results, and sync metadata (including outbox and conflict records) are not included in backup v1."
    );

    await act(async () => {
      buttonByText(container!, "Delete all data").click();
    });
    await settle();

    expect(container?.textContent).toContain("Delete all data?");

    await act(async () => {
      buttonByText(container!, "Delete everything").click();
    });
    await settle();

    expect(container?.querySelector('[role="status"]')?.textContent).toContain(
      "All local data was deleted."
    );
  });
});
