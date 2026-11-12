"use client";

import Link from "next/link";
import { useState } from "react";

import { cn } from "@opennest/ui";
import { useTranslations } from "@opennest/localization";

const items = [
  {
    key: "home",
    labelKey: "nav.home",
    shortKey: "nav.home",
    enabled: true,
    href: "/",
  },
  {
    key: "library",
    labelKey: "nav.library",
    shortKey: "nav.libraryShort",
    enabled: false,
  },
  {
    key: "knowledge",
    labelKey: "nav.knowledge",
    shortKey: "nav.knowledgeShort",
    enabled: false,
  },
  { key: "search", labelKey: "nav.search", shortKey: "nav.search", enabled: false },
  { key: "settings", labelKey: "nav.settings", shortKey: "nav.settings", enabled: false },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:px-4 focus:py-2"
      >
        {t("common.skipToContent")}
      </a>
      <header className="border-border bg-surface/90 sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b px-4 backdrop-blur sm:px-6">
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

        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-controls="primary-navigation"
          className="border-border text-foreground hover:bg-border/40 hidden min-h-11 items-center rounded-lg border px-3 text-sm font-medium md:inline-flex"
        >
          {collapsed ? t("nav.showSidebar") : t("nav.hideSidebar")}
        </button>
      </header>

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
          {items.map((item) => (
            <li key={item.key} className="min-w-0 flex-1">
              {item.enabled ? (
                <Link
                  href={item.href}
                  aria-current="page"
                  className="text-primary flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-0.5 text-center"
                >
                  <span className="max-w-full truncate text-[11px] leading-tight">
                    {t(item.shortKey)}
                  </span>
                  <span className="max-w-full truncate text-[9px] leading-tight font-semibold">
                    {t("common.current")}
                  </span>
                </Link>
              ) : (
                <span className="text-muted flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-0.5 text-center">
                  <span className="max-w-full truncate text-[11px] leading-tight">
                    {t(item.shortKey)}
                  </span>
                  <span className="max-w-full truncate text-[9px] leading-tight opacity-80">
                    {t("common.comingSoon")}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function NavList() {
  const t = useTranslations();

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) =>
        item.enabled ? (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current="page"
              className="bg-primary/10 text-primary flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 text-sm font-semibold"
            >
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          </li>
        ) : (
          <li key={item.key}>
            <span className="text-muted flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 text-sm">
              <span className="truncate">{t(item.labelKey)}</span>
              <span className="bg-border/60 shrink-0 rounded-md px-1.5 py-0.5 text-[10px]">
                {t("common.comingSoon")}
              </span>
            </span>
          </li>
        )
      )}
    </ul>
  );
}
