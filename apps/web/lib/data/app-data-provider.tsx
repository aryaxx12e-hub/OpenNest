"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { StorageAdapter, Workspace } from "@opennest/core";
import { useTranslations } from "@opennest/localization";
import { createMemoryPrivacyStore, type PrivacyStore } from "@opennest/privacy";
import { Button } from "@opennest/ui";

import { openBrowserStorage } from "./browser-storage";
import { createRevisionStore, type RevisionStore } from "./revision";
import { createAppServices, type AppServices } from "./services";
import { createDexiePrivacyStore } from "@/lib/privacy/dexie-store";
import {
  createPrivacyRuntime,
  type BrokeredAppServices,
  type PrivacyRuntime,
} from "@/lib/privacy/runtime";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      privacy: PrivacyRuntime;
      rawServices: AppServices;
      services: BrokeredAppServices;
      workspace: Workspace;
    };

interface ReadyAppData {
  status: "ready";
  privacy: PrivacyRuntime;
  services: BrokeredAppServices;
  workspace: Workspace;
  revisionStore: RevisionStore;
  invalidate: () => void;
  refreshWorkspace: () => Promise<void>;
}

const AppDataContext = createContext<ReadyAppData | null>(null);

export interface AppDataProviderProps {
  children: ReactNode;
  openStorage?: () => Promise<StorageAdapter>;
  openPrivacyStore?: () => Promise<PrivacyStore>;
}

function openDefaultPrivacyStore(): Promise<PrivacyStore> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(createMemoryPrivacyStore());
  }

  return Promise.resolve(createDexiePrivacyStore());
}

export function AppDataProvider({
  children,
  openStorage,
  openPrivacyStore,
}: AppDataProviderProps) {
  const t = useTranslations();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [revisionStore] = useState(createRevisionStore);
  const [defaultWorkspaceName] = useState(() => t("workspace.defaultName"));
  const request = useRef(0);

  useEffect(() => {
    const current = request.current + 1;
    request.current = current;
    let cancelled = false;
    let runtime: PrivacyRuntime | null = null;

    (openStorage ?? openBrowserStorage)()
      .then(async (storage) => {
        const result = await createAppServices(storage, {
          defaultWorkspaceName,
        });

        if (cancelled || request.current !== current) {
          return;
        }

        const privacy = await createPrivacyRuntime({
          storage,
          services: result.services,
          workspace: result.workspace,
          drafts: window.localStorage,
          openPrivacyStore: openPrivacyStore ?? openDefaultPrivacyStore,
        });

        if (cancelled || request.current !== current) {
          await privacy.dispose();
          return;
        }

        runtime = privacy;
        setState({
          status: "ready",
          privacy,
          rawServices: result.services,
          services: privacy.services,
          workspace: result.workspace,
        });
      })
      .catch(() => {
        if (!cancelled && request.current === current) {
          setState({ status: "error" });
        }
      });

    return () => {
      cancelled = true;
      const owned = runtime;
      runtime = null;

      if (owned !== null) {
        void owned.dispose();
      }
    };
  }, [attempt, defaultWorkspaceName, openPrivacyStore, openStorage]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  const invalidate = useCallback(() => {
    revisionStore.bump();
  }, [revisionStore]);

  const refreshWorkspace = useCallback(async () => {
    if (state.status !== "ready") {
      return;
    }

    const workspace = await state.rawServices.workspace.ensure(defaultWorkspaceName);

    setState((previous) =>
      previous.status === "ready" ? { ...previous, workspace } : previous
    );
    revisionStore.bump();
  }, [defaultWorkspaceName, revisionStore, state]);

  const value = useMemo<ReadyAppData | null>(() => {
    if (state.status !== "ready") {
      return null;
    }

    return {
      status: "ready",
      privacy: state.privacy,
      services: state.services,
      workspace: state.workspace,
      revisionStore,
      invalidate,
      refreshWorkspace,
    };
  }, [invalidate, refreshWorkspace, revisionStore, state]);

  if (state.status === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <p role="status" className="text-muted text-sm">
          {t("data.loading")}
        </p>
      </main>
    );
  }

  if (state.status === "error" || value === null) {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div role="alert" className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">{t("data.errorTitle")}</h1>
          <p className="text-muted text-sm leading-6">{t("data.errorBody")}</p>
          <Button onClick={retry}>{t("common.retry")}</Button>
        </div>
      </main>
    );
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): ReadyAppData {
  const context = useContext(AppDataContext);

  if (context === null) {
    throw new Error("useAppData must be used inside a ready AppDataProvider");
  }

  return context;
}

export function useOptionalAppData(): ReadyAppData | null {
  return useContext(AppDataContext);
}

export function useAppRevision(): number {
  const { revisionStore } = useAppData();

  return useSyncExternalStore(
    revisionStore.subscribe,
    revisionStore.getSnapshot,
    revisionStore.getSnapshot
  );
}

const noopSubscribe = () => () => undefined;
const getZeroRevision = () => 0;

export function useOptionalAppRevision(): number {
  const context = useContext(AppDataContext);

  return useSyncExternalStore(
    context?.revisionStore.subscribe ?? noopSubscribe,
    context?.revisionStore.getSnapshot ?? getZeroRevision,
    context?.revisionStore.getSnapshot ?? getZeroRevision
  );
}
