import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createExtensionPackage,
  type ExtensionCapability,
  type InstallPreview,
} from "@opennest/extensions";
import { LocaleProvider } from "@opennest/localization";

import { ExtensionInstallDialog } from "../extension-install-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const scope =
    Array.from(host.querySelectorAll("dialog")).find((dialog) => dialog.open) ?? host;
  const button = Array.from(scope.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`No button named ${text}`);
  }

  return button;
}

function renderInstallDialog(
  preview: InstallPreview,
  onConfirm: (accepted: readonly ExtensionCapability[]) => void
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <ExtensionInstallDialog
          open
          preview={preview}
          onConfirm={onConfirm}
          onClose={() => undefined}
        />
      </LocaleProvider>
    );
  });

  return container;
}

async function previewWith(
  capabilities: InstallPreview["manifest"]["capabilities"],
  required = capabilities
): Promise<InstallPreview> {
  const pkg = await createExtensionPackage({
    manifest: {
      id: "com.example.demo",
      name: "Demo extension",
      version: "1.0.0",
      publisher: "Example",
      description: "A demo extension.",
      tier: 1,
      entry: "index.js",
      capabilities,
      dataScopes: ["notes"],
      networkOrigins: [],
      minHostVersion: "0.1.0",
    },
    code: "opennest.ready();",
  });

  return {
    action: "install",
    package: pkg,
    manifest: pkg.manifest,
    requiredCapabilities: required,
    requiresConsent: required.length > 0,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = undefined;
  container = undefined;
});

describe("ExtensionInstallDialog", () => {
  it("explains permissions and requires consent before install", async () => {
    const preview = await previewWith(["workspace.read.content"]);
    const onConfirm = vi.fn();
    const host = renderInstallDialog(preview, onConfirm);
    const confirm = buttonByText(host, "Install");
    const checkbox = host.querySelector('input[type="checkbox"]');

    expect(host.textContent).toContain("Read note text");
    expect(host.textContent).toContain("This package is not signed.");
    expect(host.textContent).toContain("This extension cannot access the network");
    expect(confirm.disabled).toBe(true);

    if (!(checkbox instanceof HTMLInputElement)) {
      throw new Error("No consent checkbox");
    }

    act(() => checkbox.click());
    expect(confirm.disabled).toBe(false);

    act(() => confirm.click());
    expect(onConfirm).toHaveBeenCalledWith(["workspace.read.content"]);
  });

  it("lists only new permissions for an update", async () => {
    const preview = await previewWith(
      ["workspace.read.metadata", "workspace.read.content"],
      ["workspace.read.content"]
    );
    const host = renderInstallDialog({ ...preview, action: "update" }, () => undefined);

    expect(host.textContent).toContain("New permissions in this update:");
    expect(host.textContent).toContain("Read note text");
    expect(host.textContent).not.toContain("Read workspace metadata");
    expect(host.textContent).toContain("Update");
  });

  it("allows an update that adds no permissions without another checkbox", async () => {
    const preview = await previewWith(["workspace.read.metadata"], []);
    const host = renderInstallDialog(
      { ...preview, action: "update", requiresConsent: false },
      () => undefined
    );

    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(buttonByText(host, "Update").disabled).toBe(false);
  });
});
