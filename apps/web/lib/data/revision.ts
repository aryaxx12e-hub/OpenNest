export interface RevisionStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
  bump: () => void;
}

export function createRevisionStore(): RevisionStore {
  let revision = 0;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return revision;
    },
    bump() {
      revision += 1;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
