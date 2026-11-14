"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

import { useAppRevision } from "./app-data-provider";
import { createRequestGate, type RequestGate } from "./request-gate";

export interface AsyncData<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

interface AsyncState<T> {
  key: string;
  data: T | null;
  error: unknown;
  loading: boolean;
}

export function useAsyncData<T>(key: string, loader: () => Promise<T>): AsyncData<T> {
  const revision = useAppRevision();
  const load = useEffectEvent(loader);
  const [gate] = useState<RequestGate>(createRequestGate);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AsyncState<T>>({
    key,
    data: null,
    error: null,
    loading: true,
  });

  const reload = useCallback(() => {
    gate.begin();
    setState((previous) =>
      previous.key === key
        ? { ...previous, error: null, loading: true }
        : { key, data: null, error: null, loading: true }
    );
    setAttempt((value) => value + 1);
  }, [gate, key]);

  useEffect(() => {
    let cancelled = false;
    const request = gate.begin();

    load()
      .then((data) => {
        if (!cancelled && gate.isCurrent(request)) {
          setState({ key, data, error: null, loading: false });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && gate.isCurrent(request)) {
          setState({ key, data: null, error, loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, gate, key, revision]);

  const current: AsyncState<T> =
    state.key === key ? state : { key, data: null, error: null, loading: true };

  return {
    data: current.data,
    error: current.error,
    loading: current.loading,
    reload,
  };
}
