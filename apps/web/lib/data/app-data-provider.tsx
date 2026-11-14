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
import { Button } from "@opennest/ui";

import { openBrowserStorage } from "./browser-storage";
import { createRevisionStore, type RevisionStore } from "./revision";
import { createAppServices, type AppServices } from "./services";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      storage: StorageAdapter;
      services: AppServices;
      workspace: Workspace;
    };

interface ReadyAppData {
  status: "ready";
  storage: StorageAdapter;
  services: AppServices;
  workspace: Workspace;
  revisionStore: RevisionStore;
  invalidate: () => void;
  refreshWorkspace: () => Promise<void>;
}

const AppDataContext = createContext<ReadyAppData | null>(null);

export interface AppDataProviderProps {
  children: ReactNode;
  openStorage?: () => Promise<StorageAdapter>;
}

export function AppDataProvider({ children, openStorage }: AppDataProviderProps) {
  const t = useTranslations();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [revisionStore] = useState(createRevisionStore);
  const [defaultWorkspaceName] = useState(() => t("workspace.defaultName"));
  const request = useRef(0);

  useEffect(() => {
    const current = request.current + 1;
    request.current = current;

    (openStorage ?? openBrowserStorage)()
      .then(async (storage) => {
        const result = await createAppServices(storage, {
          defaultWorkspaceName,
        });

        if (request.current === current) {
          setState({
            status: "ready",
            storage,
            services: result.services,
            workspace: result.workspace,
          });
        }
      })
      .catch(() => {
        if (request.current === current) {
          setState({ status: "error" });
        }
      });
  }, [attempt, defaultWorkspaceName, openStorage]);

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

    const workspace = await state.services.workspace.ensure(defaultWorkspaceName);

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
      storage: state.storage,
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

export function useAppRevision(): number {
  const { revisionStore } = useAppData();

  return useSyncExternalStore(
    revisionStore.subscribe,
    revisionStore.getSnapshot,
    revisionStore.getSnapshot
  );
}
