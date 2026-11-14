"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type MouseEvent } from "react";

import type { NoteId } from "@opennest/core";
import { cn } from "@opennest/ui";
import { useTranslations } from "@opennest/localization";

import type { NoteDraft } from "@/lib/autosave/draft-journal";
import { useOptionalAppData } from "@/lib/data/app-data-provider";
import { getConnectionSnapshot } from "@/lib/pwa";

import { ConnectionStatus } from "./connection-status";
import { LanguageSwitcher } from "./language-switcher";
import { ServiceWorkerUpdate } from "./service-worker-update";
import { ThemeToggle } from "./theme-toggle";

const items = [
  {
    key: "home",
    labelKey: "nav.home",
    shortKey: "nav.home",
    href: "/",
    match: ["/"],
  },
  {
    key: "library",
    labelKey: "nav.library",
    shortKey: "nav.libraryShort",
    href: "/library",
    match: ["/library", "/files"],
  },
  {
    key: "notes",
    labelKey: "nav.notes",
    shortKey: "nav.notes",
    href: "/notes",
    match: ["/notes"],
  },
  {
    key: "search",
    labelKey: "nav.search",
    shortKey: "nav.search",
    href: "/search",
    match: ["/search"],
  },
  {
    key: "settings",
    labelKey: "nav.settings",
    shortKey: "nav.settings",
    href: "/settings",
    match: ["/settings"],
  },
] as const;

function isActive(item: (typeof items)[number], pathname: string): boolean {
  return item.match.some(
    (prefix) =>
      pathname === prefix || (prefix !== "/" && pathname.startsWith(`${prefix}/`))
  );
}

function handleOfflineNavigation(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!getConnectionSnapshot()) {
    event.preventDefault();
    window.location.assign(href);
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = useState(false);
  const appData = useOptionalAppData();

  const classifyDrafts =
    appData === null
      ? undefined
      : async (drafts: NoteDraft[]) =>
          Promise.all(
            drafts.map(async (draft) => {
              try {
                const note = await appData.services.note.get(draft.noteId as NoteId);

                return {
                  draft,
                  exists: note !== null && note.workspaceId === draft.workspaceId,
                  verified: true,
                };
              } catch {
                return { draft, exists: false, verified: false };
              }
            })
          );

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:px-4 focus:py-2"
      >
        {t("common.skipToContent")}
      </a>
      <header className="border-border bg-surface/90 sticky top-0 z-20 flex min-h-14 items-center justify-between gap-1.5 border-b px-2.5 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-xl text-sm font-bold"
          >
            O
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">{t("app.name")}</span>
            <span className="text-muted hidden truncate text-xs sm:block">
              {t("app.tagline")}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ConnectionStatus />
          <LanguageSwitcher />
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-controls="primary-navigation"
            className="border-border text-foreground hover:bg-border/40 hidden min-h-11 items-center rounded-lg border px-3 text-sm font-medium md:inline-flex"
          >
            {collapsed ? t("nav.showSidebar") : t("nav.hideSidebar")}
          </button>
        </div>
      </header>

      <ServiceWorkerUpdate classifyDrafts={classifyDrafts} />

      <div className="flex flex-1">
        <nav
          id="primary-navigation"
          aria-label={t("nav.labelDesktop")}
          className={cn(
            "border-border bg-surface hidden w-64 shrink-0 border-r p-3 md:block",
            collapsed && "md:hidden"
          )}
        >
          <NavList />
        </nav>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 pb-24 md:pb-0">
          {children}
        </main>
      </div>

      <nav
        aria-label={t("nav.labelMobile")}
        className="border-border bg-surface/95 fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="flex items-stretch">
          {items.map((item) => {
            const active = isActive(item, pathname);

            return (
              <li key={item.key} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => handleOfflineNavigation(event, item.href)}
                  className={cn(
                    "flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-0.5 text-center",
                    active ? "text-primary" : "text-foreground hover:bg-border/30"
                  )}
                >
                  <span className="max-w-full truncate text-xs leading-tight font-medium">
                    {t(item.shortKey)}
                  </span>
                  {active ? (
                    <span className="max-w-full truncate text-[10px] leading-tight font-semibold">
                      {t("common.current")}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function NavList() {
  const t = useTranslations();
  const pathname = usePathname() ?? "/";

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(item, pathname);

        return (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={(event) => handleOfflineNavigation(event, item.href)}
              className={cn(
                "flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 text-sm font-medium",
                active
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-foreground hover:bg-border/30"
              )}
            >
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
