"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createCollaborationProvider,
  type CollaborationParticipant,
  type CollaborationProviderOptions,
  type CollaborationRole,
  type CollaborationSnapshot,
  type CollaborationStatus,
  type CollaborationTextSource,
} from "./provider";

export interface UseCollaborationOptions extends Omit<
  CollaborationProviderOptions,
  "onTextChange"
> {
  onTextChange?: (text: string, source: CollaborationTextSource) => void;
}

export interface UseCollaborationResult {
  status: CollaborationStatus;
  role: CollaborationRole | null;
  readOnly: boolean;
  participants: readonly CollaborationParticipant[];
  lastError: string | null;
  isLive: boolean;
  setText(text: string): boolean;
}

function initialSnapshot(options: UseCollaborationOptions): CollaborationSnapshot {
  const noteId = options.noteId.trim();
  const url = options.url?.trim() ?? "";
  const enabled = options.shared && noteId.length > 0 && url.length > 0;

  return {
    status: enabled ? "connecting" : "disabled",
    role: null,
    readOnly: false,
    participants: [],
    lastError: null,
  };
}

export function useCollaboration(
  options: UseCollaborationOptions
): UseCollaborationResult {
  const optionsRef = useRef(options);
  const onTextChangeRef = useRef(options.onTextChange);
  const providerRef = useRef<ReturnType<typeof createCollaborationProvider> | null>(null);

  useEffect(() => {
    optionsRef.current = options;
    onTextChangeRef.current = options.onTextChange;
  }, [options]);
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot>(() =>
    initialSnapshot(options)
  );
  const { noteId, shared, url } = options;

  useEffect(() => {
    const current = optionsRef.current;
    const provider = createCollaborationProvider({
      ...current,
      noteId,
      shared,
      url,
      onTextChange: (text, source) => {
        onTextChangeRef.current?.(text, source);
      },
    });
    providerRef.current = provider;
    setSnapshot(provider.getSnapshot());
    const unsubscribe = provider.subscribe(() => {
      setSnapshot(provider.getSnapshot());
    });

    provider.start();

    return () => {
      unsubscribe();
      provider.destroy();

      if (providerRef.current === provider) {
        providerRef.current = null;
      }
    };
  }, [noteId, shared, url]);

  const setText = useCallback((text: string): boolean => {
    return providerRef.current?.setText(text) ?? false;
  }, []);

  return {
    ...snapshot,
    isLive: snapshot.status === "connected",
    setText,
  };
}
