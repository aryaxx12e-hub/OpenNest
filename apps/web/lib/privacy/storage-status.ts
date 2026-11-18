export interface StorageStatus {
  supported: boolean;
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

function browserStorage(): StorageManager | null {
  try {
    return typeof navigator === "undefined" ? null : (navigator.storage ?? null);
  } catch {
    return null;
  }
}

export async function readStorageStatus(): Promise<StorageStatus> {
  const storage = browserStorage();

  if (storage === null) {
    return {
      supported: false,
      usage: null,
      quota: null,
      persisted: null,
    };
  }

  let usage: number | null = null;
  let quota: number | null = null;

  try {
    const estimate = await storage.estimate?.();

    if (estimate !== undefined) {
      usage = typeof estimate.usage === "number" ? estimate.usage : null;
      quota = typeof estimate.quota === "number" ? estimate.quota : null;
    }
  } catch {
    usage = null;
    quota = null;
  }

  let persisted: boolean | null = null;

  try {
    persisted = (await storage.persisted?.()) ?? null;
  } catch {
    persisted = null;
  }

  return {
    supported: true,
    usage,
    quota,
    persisted,
  };
}

export async function requestPersistentStorage(): Promise<
  "granted" | "denied" | "unsupported"
> {
  const storage = browserStorage();

  if (storage?.persist === undefined) {
    return "unsupported";
  }

  return (await storage.persist()) ? "granted" : "denied";
}
