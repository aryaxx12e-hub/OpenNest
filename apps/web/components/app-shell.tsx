"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type MouseEvent } from "react";

import type { NoteId } from "@opennest/core";
import { cn } from "@opennest/ui";
import {
  HomeIcon,
  LibraryIcon,
  MenuIcon,
  NoteIcon,
  PrivacyIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
  type IconProps,
} from "@opennest/ui";
import { useTranslations } from "@opennest/localization";

import type { NoteDraft } from "@/lib/autosave/draft-journal";
import { useOptionalAppData } from "@/lib/data/app-data-provider";
import { getConnectionSnapshot } from "@/lib/pwa";

import { ConnectionStatus } from "./connection-status";
import { LanguageSwitcher } from "./language-switcher";
import { ServiceWorkerUpdate } from "./service-worker-update";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  key: string;
  labelKey: string;
  shortKey: string;
  href: string;
  match: readonly string[];
  icon: ComponentType<IconProps>;
}

const items: readonly NavItem[] = [
  {
    key: "home",
    labelKey: "nav.home",
    shortKey: "nav.home",
    href: "/",
    match: ["/"],
    icon: HomeIcon,
  },
  {
    key: "library",
    labelKey: "nav.library",
    shortKey: "nav.libraryShort",
    href: "/library",
    match: ["/library", "/files"],
    icon: LibraryIcon,
  },
  {
    key: "notes",
    labelKey: "nav.notes",
    shortKey: "nav.notes",
    href: "/notes",
    match: ["/notes"],
    icon: NoteIcon,
  },
  {
    key: "search",
    labelKey: "nav.search",
    shortKey: "nav.search",
    href: "/search",
    match: ["/search"],
    icon: SearchIcon,
  },
  {
    key: "privacy",
    labelKey: "nav.privacy",
    shortKey: "nav.privacy",
    href: "/privacy",
    match: ["/privacy"],
    icon: PrivacyIcon,
  },
  {
    key: "settings",
    labelKey: "nav.settings",
    shortKey: "nav.settings",
    href: "/settings",
    match: ["/settings"],
    icon: SettingsIcon,
  },
];

function isActive(item: NavItem, pathname: string): boolean {
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
  const [railCollapsed, setRailCollapsed] = useState(false);
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
    <div className="bg-background min-h-dvh p-0 sm:p-3 lg:p-4">
      <a
        href="#main-content"
        className="focus:bg-primary focus:text-primary-foreground focus:rounded-control sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2"
      >
        {t("common.skipToContent")}
      </a>

      <div className="border-border bg-surface sm:rounded-panel sm:shadow-float mx-auto flex min-h-dvh max-w-[1600px] flex-col overflow-hidden sm:min-h-[calc(100dvh-1.5rem)] sm:border lg:min-h-[calc(100dvh-2rem)]">
        <header className="border-border flex min-h-16 items-center justify-between gap-2 border-b px-3 sm:gap-3 sm:px-6">
          <Link
            href="/"
            aria-label={t("app.name")}
            className="rounded-control focus-visible:outline-primary flex min-w-0 items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-4 sm:gap-3"
          >
            <span
              aria-hidden="true"
              className="size-9 shrink-0 rounded-[0.9rem] bg-[url('/icon.svg')] bg-cover bg-center"
            />
            <span className="flex min-w-0 flex-col leading-tight">
              <span
                aria-hidden="true"
                className="text-primary block h-[1.375rem] w-[6.97rem] shrink-0 bg-current"
                style={{
                  maskImage: "url('/brand/opennest-wordmark.png')",
                  maskPosition: "left center",
                  maskRepeat: "no-repeat",
                  maskSize: "contain",
                  WebkitMaskImage: "url('/brand/opennest-wordmark.png')",
                  WebkitMaskPosition: "left center",
                  WebkitMaskRepeat: "no-repeat",
                  WebkitMaskSize: "contain",
                }}
              />
              <span className="text-muted mt-1 hidden truncate text-xs sm:block">
                {t("app.tagline")}
              </span>
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-1">
            <ConnectionStatus />
            <LanguageSwitcher />
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setRailCollapsed((value) => !value)}
              aria-expanded={!railCollapsed}
              aria-controls="primary-navigation"
              className="border-border text-muted hover:bg-surface-muted hover:text-foreground rounded-control hidden min-h-11 min-w-11 items-center justify-center border md:inline-flex"
            >
              {railCollapsed ? (
                <MenuIcon className="size-5" />
              ) : (
                <XIcon className="size-5" />
              )}
              <span className="sr-only">
                {railCollapsed ? t("nav.showSidebar") : t("nav.hideSidebar")}
              </span>
            </button>
          </div>
        </header>

        <ServiceWorkerUpdate classifyDrafts={classifyDrafts} />

        <div className="flex flex-1">
          <nav
            id="primary-navigation"
            aria-label={t("nav.labelDesktop")}
            className={cn(
              "border-border bg-surface-muted/45 w-20 shrink-0 flex-col items-center gap-2 border-r px-2 py-4",
              railCollapsed ? "hidden" : "hidden md:flex"
            )}
          >
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.key}>
                  <NavRailLink item={item} active={isActive(item, pathname)} />
                </li>
              ))}
            </ul>
          </nav>

          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 pb-24 md:pb-0">
            {children}
          </main>
        </div>
      </div>

      <nav
        aria-label={t("nav.labelMobile")}
        className="border-border bg-surface/95 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-6">
          {items.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;

            return (
              <li key={item.key} className="min-w-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => handleOfflineNavigation(event, item.href)}
                  className={cn(
                    "flex min-h-16 w-full flex-col items-center justify-center gap-1 px-1 text-[10px] leading-tight font-medium",
                    active
                      ? "text-primary bg-primary-soft/70"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  )}
                >
                  <Icon className="size-5" />
                  <span className="max-w-full truncate">{t(item.shortKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function NavRailLink({ item, active }: { item: NavItem; active: boolean }) {
  const t = useTranslations();
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={(event) => handleOfflineNavigation(event, item.href)}
      className={cn(
        "group rounded-control relative flex size-12 items-center justify-center transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted hover:bg-surface hover:text-foreground"
      )}
    >
      <Icon className="size-5" />
      <span className="border-border bg-surface text-foreground rounded-control pointer-events-none absolute left-full z-30 ml-3 hidden border px-2.5 py-1 text-xs font-medium whitespace-nowrap shadow-sm group-hover:block group-focus-visible:block">
        {t(item.labelKey)}
      </span>
      <span className="sr-only">{t(item.labelKey)}</span>
    </Link>
  );
}
