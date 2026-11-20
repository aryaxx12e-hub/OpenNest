export interface CloseableResource {
  close(): void | Promise<void>;
}

export interface LifecycleResources {
  http: CloseableResource;
  collaboration?: CloseableResource;
  sync?: CloseableResource;
  files?: CloseableResource;
  auth: CloseableResource;
  workspace: CloseableResource;
}

export interface Lifecycle {
  close(): Promise<void>;
}

export function createLifecycle(resources: LifecycleResources): Lifecycle {
  let closing: Promise<void> | null = null;

  return {
    close() {
      closing ??= (async () => {
        let firstError: unknown;

        for (const resource of [
          resources.collaboration,
          resources.http,
          resources.sync,
          resources.files,
          resources.auth,
          resources.workspace,
        ]) {
          if (resource === undefined) {
            continue;
          }

          try {
            await resource.close();
          } catch (error) {
            firstError ??= error;
          }
        }

        if (firstError !== undefined) {
          throw firstError;
        }
      })();

      return closing;
    },
  };
}
