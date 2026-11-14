import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@opennest/localization";

import { SaveCoordinatorProvider } from "@/lib/data/save-coordinator";

import { AppShell } from "../app-shell";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

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
        <SaveCoordinatorProvider>
          <AppShell>
            <p>Content</p>
          </AppShell>
        </SaveCoordinatorProvider>
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

beforeEach(() => {
  navigation.pathname = "/";
  window.localStorage.clear();
});

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

  it("renders enabled pages as links and marks only the current one", () => {
    const host = renderShell();

    for (const name of ["Primary navigation", "Quick navigation"]) {
      const links = Array.from(navByName(host, name).querySelectorAll("a"));

      expect(links).toHaveLength(5);
      expect(links[0]!.getAttribute("href")).toBe("/");
      expect(links[0]!.getAttribute("aria-current")).toBe("page");
      expect(links[0]!.textContent).toContain("Home");
      expect(links[1]!.getAttribute("href")).toBe("/library");
      expect(links[1]!.getAttribute("aria-current")).toBeNull();
      expect(links[2]!.getAttribute("href")).toBe("/notes");
      expect(links[2]!.getAttribute("aria-current")).toBeNull();
      expect(links[3]!.getAttribute("href")).toBe("/search");
      expect(links[3]!.getAttribute("aria-current")).toBeNull();
      expect(links[4]!.getAttribute("href")).toBe("/settings");
      expect(links[4]!.getAttribute("aria-current")).toBeNull();
    }
  });

  it("marks the library as current on file routes", () => {
    navigation.pathname = "/files/abc";
    const host = renderShell();

    for (const name of ["Primary navigation", "Quick navigation"]) {
      const links = Array.from(navByName(host, name).querySelectorAll("a"));
      const library = links.find((link) => link.getAttribute("href") === "/library");

      expect(library?.getAttribute("aria-current")).toBe("page");
    }
  });

  it("marks notes as current on note routes", () => {
    navigation.pathname = "/notes/abc";
    const host = renderShell();

    for (const name of ["Primary navigation", "Quick navigation"]) {
      const links = Array.from(navByName(host, name).querySelectorAll("a"));
      const notes = links.find((link) => link.getAttribute("href") === "/notes");

      expect(notes?.getAttribute("aria-current")).toBe("page");
    }
  });

  it("marks search as current on the search route", () => {
    navigation.pathname = "/search";
    const host = renderShell();

    for (const name of ["Primary navigation", "Quick navigation"]) {
      const links = Array.from(navByName(host, name).querySelectorAll("a"));
      const search = links.find((link) => link.getAttribute("href") === "/search");

      expect(search?.getAttribute("aria-current")).toBe("page");
    }
  });

  it("renders every navigation item as an enabled link", () => {
    const host = renderShell();

    for (const name of ["Primary navigation", "Quick navigation"]) {
      const nav = navByName(host, name);
      const unavailable = Array.from(nav.querySelectorAll("li")).filter((li) =>
        li.textContent?.includes("Coming soon")
      );

      expect(unavailable).toHaveLength(0);
      expect(nav.querySelectorAll("a")).toHaveLength(5);
    }
  });

  it("never sets aria-disabled anywhere in the shell", () => {
    const host = renderShell();

    expect(host.querySelector("[aria-disabled]")).toBeNull();
  });

  it("keeps the sidebar toggle wired to the desktop nav", () => {
    const host = renderShell();
    const toggle = host.querySelector('[aria-controls="primary-navigation"]');

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

    expect(insideNavigation).toHaveLength(10);
    expect(insideNavigation.every((element) => element.tagName === "A")).toBe(true);
    expect(host.querySelector("main")?.getAttribute("tabindex")).toBe("-1");
  });
});
