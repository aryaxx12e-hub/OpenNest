export const SERVICE_WORKER_URL = "/sw.js";
export const SERVICE_WORKER_SCOPE = "/";

export interface PwaWorker {
  state: string;
  postMessage(message: unknown): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface PwaRegistration {
  waiting: PwaWorker | null;
  installing: PwaWorker | null;
  update(): Promise<unknown>;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface PwaContainer {
  readonly controller: PwaWorker | null;
  register(
    url: string,
    options: { scope?: string; updateViaCache?: "all" | "imports" | "none" }
  ): Promise<PwaRegistration>;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface PwaCallbacks {
  onUpdateReady(): void;
  onControllerChange(): void;
}

export interface PwaHandle {
  requestUpdate(): void;
  dispose(): void;
}

export function browserPwaContainer(): PwaContainer | null {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  const container = navigator.serviceWorker;

  return {
    get controller() {
      return container.controller as PwaWorker | null;
    },
    register: (url, options) =>
      container.register(url, options) as Promise<PwaRegistration>,
    addEventListener: (type, listener, options) =>
      (container as EventTarget).addEventListener(type, listener, options),
    removeEventListener: (type, listener, options) =>
      (container as EventTarget).removeEventListener(type, listener, options),
  };
}

export async function startPwa(
  container: PwaContainer,
  callbacks: PwaCallbacks
): Promise<PwaHandle> {
  let disposed = false;
  let announced = false;
  let pendingUpdate = false;
  const watchedWorkers = new Set<PwaWorker>();

  const registration = await container.register(SERVICE_WORKER_URL, {
    scope: SERVICE_WORKER_SCOPE,
    updateViaCache: "none",
  });

  const notify = () => {
    if (disposed || announced || container.controller === null) {
      return;
    }

    announced = true;
    callbacks.onUpdateReady();
  };

  const onWorkerStateChange = (event: Event) => {
    const worker = event.currentTarget as PwaWorker | null;

    if (worker?.state === "installed") {
      notify();
    }
  };

  const watchWorker = (worker: PwaWorker) => {
    if (watchedWorkers.has(worker)) {
      return;
    }

    watchedWorkers.add(worker);
    worker.addEventListener("statechange", onWorkerStateChange);
  };

  const onUpdateFound = () => {
    if (registration.installing !== null) {
      watchWorker(registration.installing);
    }
  };

  const onControllerChange = () => {
    if (!disposed && pendingUpdate) {
      callbacks.onControllerChange();
    }
  };

  registration.addEventListener("updatefound", onUpdateFound);
  container.addEventListener("controllerchange", onControllerChange);

  if (registration.installing !== null) {
    watchWorker(registration.installing);
  }

  if (registration.waiting !== null) {
    notify();
  }

  void Promise.resolve(registration.update()).catch(() => undefined);

  return {
    requestUpdate() {
      if (disposed) {
        return;
      }

      const waiting = registration.waiting;

      if (waiting === null) {
        return;
      }

      pendingUpdate = true;
      waiting.postMessage({ type: "SKIP_WAITING" });
    },
    dispose() {
      disposed = true;
      registration.removeEventListener("updatefound", onUpdateFound);
      container.removeEventListener("controllerchange", onControllerChange);

      for (const worker of watchedWorkers) {
        worker.removeEventListener("statechange", onWorkerStateChange);
      }

      watchedWorkers.clear();
    },
  };
}

export function subscribeToConnection(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);

  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function getConnectionSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function getConnectionServerSnapshot(): boolean {
  return true;
}
