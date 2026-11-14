"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

import { useAppRevision } from "./app-data-provider";

export interface AsyncData<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

export function useAsyncData<T>(key: string, loader: () => Promise<T>): AsyncData<T> {
  const revision = useAppRevision();
  const load = useEffectEvent(loader);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    data: T | null;
    error: unknown;
    loading: boolean;
  }>({ data: null, error: null, loading: true });

  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, error: null, loading: true }));
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    load()
      .then((data) => {
        if (!cancelled) {
          setState({ data, error: null, loading: false });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ data: null, error, loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, key, revision]);

  return { ...state, reload };
}
