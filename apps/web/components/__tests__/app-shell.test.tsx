import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "@opennest/localization";

import { AppShell } from "../app-shell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderShell(): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AppShell>
          <p>Content</p>
        </AppShell>
      </LocaleProvider>
    );
  });

  return container;
}

function navByName(host: HTMLElement, name: string): HTMLElement {
  const navs = Array.from(host.querySelectorAll("nav"));
  const match = navs.find((nav) => nav.getAttribute("aria-label") === name);

  if (match === undefined) {
    throw new Error(`No navigation landmark named ${name}`);
  }

  return match;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  document.documentElement.className = "";
});

describe("AppShell navigation", () => {
  it("gives the two navigation landmarks distinct accessible names", () => {
    const host = renderShell();

    expect(navByName(host, "Primary navigation")).toBeTruthy();
    expect(navByName(host, "Quick navigation")).toBeTruthy();
  });

  it("renders the current page as a link with aria-current in both navs", () => {
    const host = renderShell();

    for (const name of ["Primary navigation", "Quick navigation"]) {
      const links = Array.from(navByName(host, name).querySelectorAll("a"));

      expect(links).toHaveLength(1);
      expect(links[0]!.getAttribute("href")).toBe("/");
      expect(links[0]!.getAttribute("aria-current")).toBe("page");
      expect(links[0]!.textContent).toContain("Home");
    }
  });

  it("renders unavailable items as plain text without ARIA state", () => {
    const host = renderShell();

    for (const name of ["Primary navigation", "Quick navigation"]) {
      const nav = navByName(host, name);
      const unavailable = Array.from(nav.querySelectorAll("li")).filter((li) =>
        li.textContent?.includes("Coming soon")
      );

      expect(unavailable).toHaveLength(4);

      for (const item of unavailable) {
        expect(item.querySelector("a, button, select, input, textarea")).toBeNull();
        expect(item.querySelector("[aria-disabled]")).toBeNull();
        expect(item.querySelector("[aria-current]")).toBeNull();
        expect(item.querySelector("[tabindex]")).toBeNull();
      }
    }
  });

  it("never sets aria-disabled anywhere in the shell", () => {
    const host = renderShell();

    expect(host.querySelector("[aria-disabled]")).toBeNull();
  });

  it("keeps the sidebar toggle wired to the desktop nav", () => {
    const host = renderShell();
    const toggle = host.querySelector("header button");

    expect(toggle).not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");

    const controlledId = toggle!.getAttribute("aria-controls");
    expect(controlledId).toBe("primary-navigation");
    expect(host.querySelector(`#${controlledId}`)?.tagName).toBe("NAV");
  });

  it("exposes only real controls to keyboard focus", () => {
    const host = renderShell();
    const focusable = Array.from(
      host.querySelectorAll("a[href], button, select, input, textarea, [tabindex]")
    ).filter((element) => element.getAttribute("tabindex") !== "-1");

    const insideNavigation = focusable.filter(
      (element) => element.closest("nav") !== null
    );

    expect(insideNavigation).toHaveLength(2);
    expect(insideNavigation.every((element) => element.tagName === "A")).toBe(true);
    expect(host.querySelector("main")?.getAttribute("tabindex")).toBe("-1");
  });
});
