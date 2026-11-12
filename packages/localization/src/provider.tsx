"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { en } from "./en";
import { id as idCatalog } from "./id";

export const locales = ["en", "id"] as const;

export type Locale = (typeof locales)[number];

export type Catalog = typeof en;

const catalogs: Record<Locale, Catalog> = { en, id: idCatalog };

export const defaultLocale: Locale = "en";

const storageKey = "opennest.locale";
const changeEvent = "opennest:locale";

function isLocale(value: string | null): value is Locale {
  return value !== null && (locales as readonly string[]).includes(value);
}

function readLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return isLocale(stored) ? stored : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(changeEvent, onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(changeEvent, onChange);
  };
}

function getServerLocale(): Locale {
  return defaultLocale;
}

function lookup(catalog: Catalog, path: string): string {
  const segments = path.split(".");
  let current: unknown = catalog;

  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      throw new Error(`Unknown translation key: ${path}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }

  if (typeof current !== "string") {
    throw new Error(`Translation key does not resolve to a string: ${path}`);
  }

  return current;
}

export function translate(locale: Locale, path: string): string {
  const catalog = catalogs[locale];

  try {
    return lookup(catalog, path);
  } catch (error) {
    if (process.env.NODE_ENV === "test") {
      throw error;
    }
    return path;
  }
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (path: string) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readLocale, getServerLocale);

  const setLocale = useCallback((next: Locale) => {
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Storage can be blocked; the in-memory locale still changes for this session.
    }
    window.dispatchEvent(new Event(changeEvent));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "app.documentTitle");
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (path: string) => translate(locale, path),
    }),
    [locale, setLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (context === null) {
    throw new Error("useLocale must be used inside LocaleProvider");
  }
  return context;
}

export function useTranslations(): (path: string) => string {
  return useLocale().t;
}
