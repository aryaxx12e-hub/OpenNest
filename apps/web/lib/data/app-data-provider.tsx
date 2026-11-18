"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  CryptoError,
  cancelEncryptionBeforeCommit,
  createEncryptedStorage,
  createKeyring,
  inspectBaseEncryption,
  resumeEncryption,
  rotateWorkspaceKey,
  type Keyring,
  type KeyringRecordV1,
  type KeyringStore,
  type MigrationDrafts,
  type MigrationProgress,
  type WorkspaceCryptoContext,
} from "@opennest/crypto";
import type { StorageAdapter, Workspace, WorkspaceId } from "@opennest/core";
import { createMemoryCredentialVaultStore } from "@opennest/credential-vault";
import { createMemoryExtensionStore, type ExtensionStore } from "@opennest/extensions";
import { useTranslations } from "@opennest/localization";
import { createMemoryPrivacyStore, type PrivacyStore } from "@opennest/privacy";
import { Button } from "@opennest/ui";

import { openBrowserStorage } from "./browser-storage";
import { createRevisionStore, type RevisionStore } from "./revision";
import { browserClock, createAppServices, type AppServices } from "./services";
import {
  createEncryptedDraftStore,
  type CreateEncryptedDraftStoreOptions,
} from "@/lib/autosave/encrypted-draft-store";
import { createPlainDraftStore } from "@/lib/autosave/draft-store";
import type { NoteDraft } from "@/lib/autosave/draft-journal";
import {
  EncryptionProvider,
  type EncryptionContextValue,
  type EncryptionOperation,
  type EncryptionProgress,
} from "@/lib/crypto/encryption-gate";
import { openBrowserKeyringStore } from "@/lib/crypto/keyring-store";
import {
  discardDraftRotation,
  finalizeDraftRotation,
  readDraftRotationJournal,
  stageDraftRotation,
  type DraftRotationJournal,
} from "@/lib/crypto/rotation-journal";
import { createTabCoordinator, type TabCoordinator } from "@/lib/crypto/tab-coordinator";
import { createAiRuntime, type AiRuntime } from "@/lib/ai/runtime";
import { createDexieAiStore, createMemoryAiStore, type AiStore } from "@/lib/ai/store";
import { createBrowserAiTransport } from "@/lib/ai/transport";
import { createDexieCredentialVaultStore } from "@/lib/credentials/dexie-store";
import {
  createCredentialRuntime,
  type CredentialRuntime,
  type CredentialRuntimeStore,
} from "@/lib/credentials/runtime";
import { createDexiePrivacyStore } from "@/lib/privacy/dexie-store";
import { createDexieExtensionStore } from "@/lib/extensions/dexie-store";
import { createFrameTransport } from "@/lib/extensions/frame";
import { createExtensionRuntime, type ExtensionRuntime } from "@/lib/extensions/runtime";
import type { DraftStore } from "@/lib/autosave/draft-store";
import {
  createPrivacyRuntime,
  type BrokeredAppServices,
  type PrivacyRuntime,
} from "@/lib/privacy/runtime";

const ENCRYPTED_DRAFT_PREFIX = "opennest:edraft:note:";
const EXTENSION_HOST_VERSION = "0.1.0";

interface CryptoSession {
  base: StorageAdapter;
  workspace: Workspace;
  keyringStore: KeyringStore;
  keyring: Keyring | null;
  record: KeyringRecordV1 | null;
  context: WorkspaceCryptoContext | null;
}

interface SetupSession {
  base: StorageAdapter;
  workspace: Workspace;
  keyring: Keyring;
  context: WorkspaceCryptoContext;
  drafts: MigrationDrafts<NoteDraft>;
}

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing-keyring" }
  | { status: "locked"; session: CryptoSession }
  | {
      status: "ready";
      ai: AiRuntime;
      credentials: CredentialRuntime;
      extensions: ExtensionRuntime;
      privacy: PrivacyRuntime;
      rawServices: AppServices;
      services: BrokeredAppServices;
      workspace: Workspace;
      session: CryptoSession;
      encryptionStatus: "plaintext" | "unlocked";
      drafts: DraftStore;
    };

export interface ReadyAppData {
  status: "ready";
  ai: AiRuntime;
  credentials: CredentialRuntime;
  extensions: ExtensionRuntime;
  privacy: PrivacyRuntime;
  services: BrokeredAppServices;
  workspace: Workspace;
  drafts: DraftStore;
  revisionStore: RevisionStore;
  invalidate: () => void;
  refreshWorkspace: () => Promise<void>;
}

interface AppRuntime {
  ai: AiRuntime;
  aiStore: AiStore;
  credentials: CredentialRuntime;
  extensionStore: ExtensionStore;
  extensions: ExtensionRuntime;
  privacy: PrivacyRuntime;
}

interface BuiltRuntime extends AppRuntime {
  drafts: DraftStore;
  rawServices: AppServices;
  services: BrokeredAppServices;
  workspace: Workspace;
}

const AppDataContext = createContext<ReadyAppData | null>(null);

export interface AppDataProviderProps {
  children: ReactNode;
  openStorage?: () => Promise<StorageAdapter>;
  openAiStore?: () => Promise<AiStore>;
  openCredentialStore?: () => Promise<CredentialRuntimeStore>;
  openPrivacyStore?: () => Promise<PrivacyStore>;
  openExtensionStore?: () => Promise<ExtensionStore>;
  openKeyringStore?: () => Promise<KeyringStore>;
  tabCoordinator?: TabCoordinator;
}

function openDefaultPrivacyStore(): Promise<PrivacyStore> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(createMemoryPrivacyStore());
  }

  return Promise.resolve(createDexiePrivacyStore());
}

function openDefaultAiStore(): Promise<AiStore> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(createMemoryAiStore());
  }

  return Promise.resolve(createDexieAiStore());
}

function openDefaultExtensionStore(): Promise<ExtensionStore> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(createMemoryExtensionStore());
  }

  return Promise.resolve(createDexieExtensionStore());
}

function openDefaultCredentialStore(): Promise<CredentialRuntimeStore> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(createMemoryCredentialVaultStore());
  }

  return Promise.resolve(createDexieCredentialVaultStore());
}

async function disposeRuntime(runtime: AppRuntime): Promise<void> {
  let failure: unknown = null;

  try {
    await runtime.ai.dispose();
  } catch (error) {
    failure = error;
  }

  try {
    await runtime.aiStore.close();
  } catch (error) {
    failure ??= error;
  }

  try {
    await runtime.credentials.dispose();
  } catch (error) {
    failure ??= error;
  }

  try {
    await runtime.extensions.dispose();
  } catch (error) {
    failure ??= error;
  }

  try {
    await runtime.extensionStore.close();
  } catch (error) {
    failure ??= error;
  }

  try {
    await runtime.privacy.dispose();
  } catch (error) {
    failure ??= error;
  }

  if (failure !== null) {
    throw failure;
  }
}

async function buildRuntime(input: {
  base: StorageAdapter;
  workspace: Workspace;
  context: WorkspaceCryptoContext | null;
  defaultWorkspaceName: string;
  openAiStore?: () => Promise<AiStore>;
  openCredentialStore?: () => Promise<CredentialRuntimeStore>;
  openPrivacyStore?: () => Promise<PrivacyStore>;
  openExtensionStore?: () => Promise<ExtensionStore>;
}): Promise<BuiltRuntime> {
  const storage =
    input.context === null
      ? input.base
      : createEncryptedStorage({ base: input.base, context: input.context });
  const result = await createAppServices(storage, {
    defaultWorkspaceName: input.defaultWorkspaceName,
  });

  if (input.context !== null && result.workspace.id !== input.context.workspaceId) {
    throw new CryptoError(
      "keyring_corrupt",
      "The workspace ID does not match the encryption keyring"
    );
  }

  const drafts =
    input.context === null
      ? createPlainDraftStore(window.localStorage)
      : createEncryptedDraftStore({
          storage: window.localStorage,
          context: input.context,
        } satisfies CreateEncryptedDraftStoreOptions);
  const privacy = await createPrivacyRuntime({
    storage,
    services: result.services,
    workspace: result.workspace,
    drafts,
    ...(input.context === null
      ? {}
      : { auxiliaryDrafts: createPlainDraftStore(window.localStorage) }),
    openPrivacyStore: input.openPrivacyStore ?? openDefaultPrivacyStore,
  });

  let ai: AiRuntime | null = null;
  let aiStore: AiStore | null = null;
  let credentials: CredentialRuntime | null = null;
  let extensions: ExtensionRuntime | null = null;
  let extensionStore: ExtensionStore | null = null;

  try {
    const credentialRuntime = await createCredentialRuntime({
      store: await (input.openCredentialStore ?? openDefaultCredentialStore)(),
    });
    credentials = credentialRuntime;
    aiStore = await (input.openAiStore ?? openDefaultAiStore)();
    await aiStore.init();
    ai = createAiRuntime({
      privacy,
      settings: aiStore,
      transport: createBrowserAiTransport({
        resolveCredential: (handle) => credentialRuntime.resolve(handle),
      }),
    });
    extensionStore = await (input.openExtensionStore ?? openDefaultExtensionStore)();
    await extensionStore.init();
    extensions = createExtensionRuntime({
      privacy: { grants: privacy.grants, audit: privacy.audit },
      services: result.services,
      store: extensionStore,
      workspace: result.workspace,
      hostVersion: EXTENSION_HOST_VERSION,
      now: () => Date.now(),
      generateId: () => crypto.randomUUID(),
      transportFactory: (handlers) =>
        createFrameTransport({
          container: document.body,
          origin: window.location.origin,
          onMessage: handlers.onMessage,
          onFault: handlers.onFault,
        }),
    });
  } catch (error) {
    if (ai !== null) {
      await ai.dispose().catch(() => undefined);
    }

    if (aiStore !== null) {
      await aiStore.close().catch(() => undefined);
    }

    if (credentials !== null) {
      await credentials.dispose().catch(() => undefined);
    }

    if (extensions !== null) {
      await extensions.dispose().catch(() => undefined);
    }

    if (extensionStore !== null) {
      await extensionStore.close().catch(() => undefined);
    }

    await privacy.dispose().catch(() => undefined);
    throw error;
  }

  if (
    ai === null ||
    aiStore === null ||
    credentials === null ||
    extensions === null ||
    extensionStore === null
  ) {
    throw new Error("The app runtime could not be created.");
  }

  const readyAi = ai;
  const readyAiStore = aiStore;
  const readyCredentials = credentials;
  const readyExtensions = extensions;
  const readyExtensionStore = extensionStore;
  privacy.setAuxiliaryCleanup(async () => {
    await readyAi.setEnabled(false);
    await readyAiStore.reset();
    await readyCredentials.clearAllData();
    await readyExtensions.stopAll();
    await readyExtensionStore.reset();
  });

  return {
    ai: readyAi,
    aiStore: readyAiStore,
    credentials: readyCredentials,
    extensionStore: readyExtensionStore,
    extensions: readyExtensions,
    drafts,
    privacy,
    rawServices: result.services,
    services: privacy.services,
    workspace: result.workspace,
  };
}

function migrationDrafts(context: WorkspaceCryptoContext): MigrationDrafts<NoteDraft> {
  return {
    plaintext: createPlainDraftStore(window.localStorage),
    encrypted: createEncryptedDraftStore({
      storage: window.localStorage,
      context,
    }),
  };
}

function operationProgress(
  phase: EncryptionProgress["phase"],
  completed = 0,
  total = 1
): EncryptionProgress {
  return { phase, completed, total };
}

function progressFromMigration(progress: MigrationProgress): EncryptionProgress {
  return {
    phase: progress.phase,
    completed: progress.completed,
    total: progress.total,
  };
}

type UnlockSecret =
  { kind: "passphrase"; value: string } | { kind: "recovery"; value: string };

async function resolveUnlock(
  session: CryptoSession,
  keyring: Keyring,
  secret: UnlockSecret
): Promise<WorkspaceCryptoContext> {
  let record = await keyring.get();

  if (record === null) {
    throw new CryptoError("keyring_missing", "The keyring does not exist");
  }

  const inspection = await inspectBaseEncryption(
    session.base,
    session.workspace.id as WorkspaceId
  );

  if (inspection.state === "mixed" || inspection.keyIds.length > 1) {
    throw new CryptoError(
      "keyring_corrupt",
      "The workspace contains content encrypted with incompatible keys"
    );
  }

  const encryptedKid =
    inspection.state === "encrypted" ? (inspection.keyIds[0] ?? null) : null;
  const journal = readDraftRotationJournal(window.localStorage, session.workspace.id);
  let context: WorkspaceCryptoContext;

  if (
    record.pending !== null &&
    encryptedKid !== null &&
    encryptedKid === record.pending.kid
  ) {
    const pendingContext =
      secret.kind === "passphrase"
        ? await keyring.unlockPending(secret.value)
        : await keyring.unlockPendingWithRecoveryKey(secret.value);
    const activeContext =
      secret.kind === "passphrase"
        ? await keyring.unlock(secret.value)
        : await keyring.unlockWithRecoveryKey(secret.value);
    let nextJournal = journal;

    if (
      nextJournal !== null &&
      (nextJournal.fromKid !== activeContext.keyId ||
        nextJournal.toKid !== pendingContext.keyId)
    ) {
      throw new CryptoError(
        "rotation_state",
        "The draft rotation journal does not match this workspace"
      );
    }

    if (nextJournal === null || !nextJournal.ready) {
      nextJournal = (
        await stageDraftRotation({
          storage: window.localStorage,
          from: activeContext,
          to: pendingContext,
        })
      ).journal;
    }

    await finalizeDraftRotation({
      storage: window.localStorage,
      journal: nextJournal,
      context: pendingContext,
    });
    await keyring.commitRotation();
    record = await keyring.get();
    context = pendingContext;
  } else {
    context =
      secret.kind === "passphrase"
        ? await keyring.unlock(secret.value)
        : await keyring.unlockWithRecoveryKey(secret.value);

    if (encryptedKid !== null && encryptedKid !== context.keyId) {
      throw new CryptoError(
        "keyring_corrupt",
        "The workspace is encrypted with a different key"
      );
    }

    if (journal !== null) {
      if (journal.toKid === context.keyId) {
        await finalizeDraftRotation({
          storage: window.localStorage,
          journal,
          context,
        });
      } else if (journal.fromKid === context.keyId) {
        await discardDraftRotation(window.localStorage, session.workspace.id);
      } else {
        throw new CryptoError(
          "rotation_state",
          "The draft rotation journal does not match this workspace"
        );
      }
    }
  }

  if (record !== null && record.state !== "active") {
    const contextForMigration = context;
    await resumeEncryption({
      base: session.base,
      keyring,
      drafts: migrationDrafts(contextForMigration),
      context: contextForMigration,
    });
  }

  return context;
}

function hasEncryptedDrafts(): boolean {
  try {
    const storage = window.localStorage;

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (key !== null && key.startsWith(ENCRYPTED_DRAFT_PREFIX)) {
        return true;
      }
    }
  } catch {
    return true;
  }

  return false;
}

export function AppDataProvider({
  children,
  openStorage,
  openAiStore,
  openCredentialStore,
  openPrivacyStore,
  openExtensionStore,
  openKeyringStore,
  tabCoordinator,
}: AppDataProviderProps) {
  const t = useTranslations();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [operation, setOperation] = useState<EncryptionOperation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionStore] = useState(createRevisionStore);
  const [defaultWorkspaceName] = useState(() => t("workspace.defaultName"));
  const request = useRef(0);
  const stateRef = useRef<LoadState>(state);
  const runtimeRef = useRef<AppRuntime | null>(null);
  const mountedRef = useRef(false);
  const lifecycleRef = useRef<Promise<void>>(Promise.resolve());
  const coordinatorRef = useRef<TabCoordinator | null>(null);
  const setupRef = useRef<SetupSession | null>(null);
  const cancelSetupRequestedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const runExclusive = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = lifecycleRef.current.then(operation, operation);
    lifecycleRef.current = result.then(
      () => undefined,
      () => undefined
    );

    return result;
  }, []);

  useEffect(() => {
    const current = request.current + 1;
    request.current = current;
    let cancelled = false;
    let ownedKeyringStore: KeyringStore | null = null;
    const ownsKeyringStore = openKeyringStore === undefined;

    const previousRuntime = runtimeRef.current;
    runtimeRef.current = null;

    if (previousRuntime !== null) {
      void disposeRuntime(previousRuntime).catch(() => undefined);
    }

    (openStorage ?? openBrowserStorage)()
      .then(async (base) => {
        const workspace = await base.workspaces.ensureWorkspace({
          name: defaultWorkspaceName,
          at: browserClock(),
        });
        const store = await (openKeyringStore ?? openBrowserKeyringStore)();
        ownedKeyringStore = store;

        if (cancelled || request.current !== current) {
          if (ownsKeyringStore) {
            await store.close?.();
          }
          return;
        }

        const keyring = createKeyring({
          store,
          workspaceId: workspace.id,
        });
        const record = await keyring.get();

        if (cancelled || request.current !== current) {
          return;
        }

        const session: CryptoSession = {
          base,
          workspace,
          keyringStore: store,
          keyring: record === null ? null : keyring,
          record,
          context: null,
        };

        if (record !== null) {
          setState({ status: "locked", session });
          return;
        }

        const inspection = await inspectBaseEncryption(base, workspace.id);

        if (inspection.state === "encrypted" || inspection.state === "mixed") {
          setState({ status: "missing-keyring" });
          return;
        }

        const built = await buildRuntime({
          base,
          workspace,
          context: null,
          defaultWorkspaceName,
          ...(openAiStore === undefined ? {} : { openAiStore }),
          ...(openCredentialStore === undefined ? {} : { openCredentialStore }),
          ...(openPrivacyStore === undefined ? {} : { openPrivacyStore }),
          ...(openExtensionStore === undefined ? {} : { openExtensionStore }),
        });

        if (cancelled || request.current !== current) {
          await disposeRuntime(built);
          return;
        }

        runtimeRef.current = {
          ai: built.ai,
          aiStore: built.aiStore,
          credentials: built.credentials,
          extensionStore: built.extensionStore,
          extensions: built.extensions,
          privacy: built.privacy,
        };
        setState({
          status: "ready",
          ai: built.ai,
          credentials: built.credentials,
          extensions: built.extensions,
          privacy: built.privacy,
          rawServices: built.rawServices,
          services: built.services,
          workspace: built.workspace,
          session: {
            ...session,
            workspace: built.workspace,
          },
          encryptionStatus: "plaintext",
          drafts: built.drafts,
        });
      })
      .catch(() => {
        if (!cancelled && request.current === current) {
          setState({ status: "error" });
        }
      });

    return () => {
      cancelled = true;
      const activeRuntime = runtimeRef.current;
      runtimeRef.current = null;

      if (activeRuntime !== null) {
        void disposeRuntime(activeRuntime).catch(() => undefined);
      }

      if (ownsKeyringStore && ownedKeyringStore !== null) {
        void ownedKeyringStore.close?.();
      }
    };
  }, [
    attempt,
    defaultWorkspaceName,
    openAiStore,
    openCredentialStore,
    openExtensionStore,
    openKeyringStore,
    openPrivacyStore,
    openStorage,
  ]);

  const installUnlocked = useCallback(
    async (session: CryptoSession, context: WorkspaceCryptoContext) => {
      const built = await buildRuntime({
        base: session.base,
        workspace: session.workspace,
        context,
        defaultWorkspaceName,
        ...(openAiStore === undefined ? {} : { openAiStore }),
        ...(openCredentialStore === undefined ? {} : { openCredentialStore }),
        ...(openPrivacyStore === undefined ? {} : { openPrivacyStore }),
        ...(openExtensionStore === undefined ? {} : { openExtensionStore }),
      });

      if (!mountedRef.current) {
        await disposeRuntime(built);
        return;
      }

      const previousRuntime = runtimeRef.current;
      runtimeRef.current = {
        ai: built.ai,
        aiStore: built.aiStore,
        credentials: built.credentials,
        extensionStore: built.extensionStore,
        extensions: built.extensions,
        privacy: built.privacy,
      };

      if (previousRuntime !== null) {
        await disposeRuntime(previousRuntime);
      }

      setState({
        status: "ready",
        ai: built.ai,
        credentials: built.credentials,
        extensions: built.extensions,
        privacy: built.privacy,
        rawServices: built.rawServices,
        services: built.services,
        workspace: built.workspace,
        session: {
          ...session,
          workspace: built.workspace,
          context,
        },
        encryptionStatus: "unlocked",
        drafts: built.drafts,
      });
    },
    [
      defaultWorkspaceName,
      openAiStore,
      openCredentialStore,
      openExtensionStore,
      openPrivacyStore,
    ]
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      await runExclusive(async () => {
        const current = stateRef.current;

        if (current.status !== "locked" || current.session.keyring === null) {
          throw new CryptoError("keyring_missing", "The workspace is not locked");
        }

        const context = await resolveUnlock(current.session, current.session.keyring, {
          kind: "passphrase",
          value: passphrase,
        });
        const record = await current.session.keyring.get();

        await installUnlocked(
          {
            ...current.session,
            record,
          },
          context
        );
      });
    },
    [installUnlocked, runExclusive]
  );

  const unlockWithRecoveryKey = useCallback(
    async (recoveryKey: string) => {
      await runExclusive(async () => {
        const current = stateRef.current;

        if (current.status !== "locked" || current.session.keyring === null) {
          throw new CryptoError("keyring_missing", "The workspace is not locked");
        }

        const context = await resolveUnlock(current.session, current.session.keyring, {
          kind: "recovery",
          value: recoveryKey,
        });
        const record = await current.session.keyring.get();

        await installUnlocked(
          {
            ...current.session,
            record,
          },
          context
        );
      });
    },
    [installUnlocked, runExclusive]
  );

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  const startSetup = useCallback(
    async (passphrase: string, recoveryKey: string) => {
      await runExclusive(async () => {
        const current = stateRef.current;

        if (
          current.status !== "ready" ||
          current.encryptionStatus !== "plaintext" ||
          current.session.keyring !== null
        ) {
          throw new CryptoError(
            "migration_state",
            "Encryption is already configured for this workspace"
          );
        }

        if (setupRef.current !== null) {
          throw new CryptoError("migration_state", "Encryption setup is already running");
        }

        cancelSetupRequestedRef.current = false;

        const keyring = createKeyring({
          store: current.session.keyringStore,
          workspaceId: current.session.workspace.id,
        });
        const setup = await keyring.setup({
          passphrase,
          recoveryKey,
          state: "preparing",
        });
        const drafts = migrationDrafts(setup.context);
        const setupSession: SetupSession = {
          base: current.session.base,
          workspace: current.session.workspace,
          keyring,
          context: setup.context,
          drafts,
        };
        setupRef.current = setupSession;
        setNotice(null);
        setOperation({
          kind: "setup",
          progress: operationProgress("start"),
          error: null,
          canDismiss: false,
        });

        try {
          const record = await resumeEncryption({
            base: current.session.base,
            keyring,
            drafts,
            context: setup.context,
            onProgress: (progress) => {
              if (cancelSetupRequestedRef.current) {
                throw new CryptoError(
                  "migration_cancelled",
                  "Encryption setup was cancelled"
                );
              }

              setOperation((previous) =>
                previous !== null && previous.kind === "setup"
                  ? { ...previous, progress: progressFromMigration(progress) }
                  : previous
              );
            },
          });

          await installUnlocked(
            {
              ...current.session,
              keyring,
              record,
              context: null,
            },
            setup.context
          );
          setupRef.current = null;
          cancelSetupRequestedRef.current = false;
          setOperation(null);
          setNotice("encryption.setup.success");
        } catch (error) {
          if (cancelSetupRequestedRef.current) {
            try {
              await cancelEncryptionBeforeCommit({
                base: setupSession.base,
                keyring: setupSession.keyring,
                context: setupSession.context,
                drafts: setupSession.drafts,
              });
              setupRef.current = null;
              cancelSetupRequestedRef.current = false;
              setOperation(null);
              setNotice("encryption.setup.cancelled");
              return;
            } catch (cancelError) {
              const committed =
                cancelError instanceof CryptoError &&
                (cancelError.code === "migration_state" ||
                  cancelError.code === "base_encrypted");

              if (committed) {
                try {
                  const record = await resumeEncryption({
                    base: setupSession.base,
                    keyring: setupSession.keyring,
                    drafts: setupSession.drafts,
                    context: setupSession.context,
                    onProgress: (progress) => {
                      setOperation((previous) =>
                        previous !== null && previous.kind === "setup"
                          ? {
                              ...previous,
                              progress: progressFromMigration(progress),
                            }
                          : previous
                      );
                    },
                  });

                  await installUnlocked(
                    {
                      ...current.session,
                      keyring,
                      record,
                      context: null,
                    },
                    setupSession.context
                  );
                  setupRef.current = null;
                  cancelSetupRequestedRef.current = false;
                  setOperation(null);
                  setNotice("encryption.setup.success");
                  return;
                } catch (finishError) {
                  error = finishError;
                }
              } else {
                error = cancelError;
              }
            }
          }

          setOperation((previous) =>
            previous !== null && previous.kind === "setup"
              ? { ...previous, error }
              : previous
          );
          throw error;
        }
      });
    },
    [installUnlocked, runExclusive]
  );

  const cancelSetup = useCallback(async () => {
    cancelSetupRequestedRef.current = true;

    await runExclusive(async () => {
      const setup = setupRef.current;

      if (setup === null) {
        setOperation(null);
        return;
      }

      try {
        await cancelEncryptionBeforeCommit({
          base: setup.base,
          keyring: setup.keyring,
          context: setup.context,
          drafts: setup.drafts,
        });
        setupRef.current = null;
        cancelSetupRequestedRef.current = false;
        setOperation(null);
        setNotice("encryption.setup.cancelled");
      } catch (error) {
        const committed =
          error instanceof CryptoError &&
          (error.code === "migration_state" || error.code === "base_encrypted");

        if (!committed) {
          setOperation((previous) =>
            previous !== null ? { ...previous, error } : previous
          );
          throw error;
        }

        try {
          const record = await resumeEncryption({
            base: setup.base,
            keyring: setup.keyring,
            drafts: setup.drafts,
            context: setup.context,
            onProgress: (progress) => {
              setOperation((previous) =>
                previous !== null && previous.kind === "setup"
                  ? { ...previous, progress: progressFromMigration(progress) }
                  : previous
              );
            },
          });
          const current = stateRef.current;

          if (current.status !== "ready") {
            throw new CryptoError(
              "migration_state",
              "Encryption setup could not be completed"
            );
          }

          await installUnlocked(
            {
              ...current.session,
              keyring: setup.keyring,
              record,
              context: null,
            },
            setup.context
          );
          setupRef.current = null;
          cancelSetupRequestedRef.current = false;
          setOperation(null);
          setNotice("encryption.setup.success");
        } catch (finishError) {
          setOperation((previous) =>
            previous !== null ? { ...previous, error: finishError } : previous
          );
          throw finishError;
        }
      }
    });
  }, [installUnlocked, runExclusive]);

  const rotate = useCallback(
    async (passphrase: string) => {
      await runExclusive(async () => {
        const current = stateRef.current;

        if (
          current.status !== "ready" ||
          current.encryptionStatus !== "unlocked" ||
          current.session.keyring === null ||
          current.session.context === null
        ) {
          throw new CryptoError(
            "rotation_state",
            "The workspace must be unlocked before rotation"
          );
        }

        const keyring = current.session.keyring;
        const context = current.session.context;
        setNotice(null);
        setOperation({
          kind: "rotation",
          progress: operationProgress("start"),
          error: null,
          canDismiss: false,
        });
        let pendingContext: WorkspaceCryptoContext | null = null;
        let journal: DraftRotationJournal | null = null;

        try {
          let record = await keyring.get();

          if (record === null) {
            throw new CryptoError("keyring_missing", "The keyring does not exist");
          }

          if (record.pending === null) {
            record = await keyring.stageRotation(passphrase);
          }

          if (record.pending === null) {
            throw new CryptoError("rotation_state", "The pending key is missing");
          }

          const pendingKid = record.pending.kid;
          pendingContext = await keyring.unlockPending(passphrase);
          journal = readDraftRotationJournal(
            window.localStorage,
            current.session.workspace.id
          );

          if (
            journal !== null &&
            (journal.fromKid !== context.keyId || journal.toKid !== pendingKid)
          ) {
            throw new CryptoError(
              "rotation_state",
              "Another draft rotation is already in progress"
            );
          }

          setOperation((previous) =>
            previous !== null && previous.kind === "rotation"
              ? { ...previous, progress: operationProgress("drafts-stage") }
              : previous
          );
          const staged = await stageDraftRotation({
            storage: window.localStorage,
            from: context,
            to: pendingContext,
          });
          journal = staged.journal;

          setOperation((previous) =>
            previous !== null && previous.kind === "rotation"
              ? { ...previous, progress: operationProgress("snapshot") }
              : previous
          );
          const rotated = await rotateWorkspaceKey({
            base: current.session.base,
            keyring,
            passphrase,
            context,
          });

          setOperation((previous) =>
            previous !== null && previous.kind === "rotation"
              ? { ...previous, progress: operationProgress("drafts-finalize") }
              : previous
          );

          let finalizeError: unknown = null;

          try {
            await finalizeDraftRotation({
              storage: window.localStorage,
              journal: staged.journal,
              context: rotated.context,
            });
          } catch (error) {
            finalizeError = error;
          }

          await installUnlocked(
            {
              ...current.session,
              keyring,
              record: rotated.record,
              context: null,
            },
            rotated.context
          );

          if (finalizeError !== null) {
            setOperation((previous) =>
              previous !== null && previous.kind === "rotation"
                ? { ...previous, error: finalizeError, canDismiss: true }
                : previous
            );
            setNotice("encryption.settings.rotationDraftError");
            return;
          }

          setOperation(null);
          setNotice("encryption.settings.rotationSuccess");
        } catch (error) {
          let recovered = false;

          try {
            const record = await keyring.get();
            const inspection = await inspectBaseEncryption(
              current.session.base,
              current.session.workspace.id
            );
            const activeContext = await keyring.unlock(passphrase).catch(() => null);
            journal ??= readDraftRotationJournal(
              window.localStorage,
              current.session.workspace.id
            );

            if (
              record?.pending !== null &&
              record?.pending !== undefined &&
              pendingContext !== null &&
              inspection.state === "encrypted" &&
              inspection.keyIds.length === 1 &&
              inspection.keyIds[0] === record.pending.kid
            ) {
              if (journal !== null && !journal.ready && activeContext !== null) {
                journal = (
                  await stageDraftRotation({
                    storage: window.localStorage,
                    from: activeContext,
                    to: pendingContext,
                  })
                ).journal;
              }

              if (journal !== null && journal.toKid === pendingContext.keyId) {
                try {
                  await finalizeDraftRotation({
                    storage: window.localStorage,
                    journal,
                    context: pendingContext,
                  });
                } catch {
                  recovered = false;
                }
              }

              await installUnlocked(
                {
                  ...current.session,
                  keyring,
                  record,
                  context: null,
                },
                pendingContext
              );
              recovered = true;
            } else if (
              activeContext !== null &&
              inspection.state === "encrypted" &&
              inspection.keyIds.length === 1 &&
              inspection.keyIds[0] === activeContext.keyId
            ) {
              if (journal !== null) {
                if (journal.toKid === activeContext.keyId) {
                  try {
                    await finalizeDraftRotation({
                      storage: window.localStorage,
                      journal,
                      context: activeContext,
                    });
                  } catch {
                    recovered = false;
                  }
                } else if (
                  journal.fromKid === activeContext.keyId &&
                  record?.pending === null
                ) {
                  await discardDraftRotation(
                    window.localStorage,
                    current.session.workspace.id
                  );
                }
              }

              await installUnlocked(
                {
                  ...current.session,
                  keyring,
                  record: record ?? current.session.record,
                  context: null,
                },
                activeContext
              );
              recovered = true;
            }
          } catch {
            recovered = false;
          }

          setOperation((previous) =>
            previous !== null && previous.kind === "rotation"
              ? {
                  ...previous,
                  error,
                  canDismiss: recovered,
                  progress: operationProgress("active"),
                }
              : previous
          );
          throw error;
        }
      });
    },
    [installUnlocked, runExclusive]
  );

  const changePassphrase = useCallback(
    async (currentPassphrase: string, nextPassphrase: string) => {
      await runExclusive(async () => {
        const current = stateRef.current;

        if (
          current.status !== "ready" ||
          current.encryptionStatus !== "unlocked" ||
          current.session.keyring === null
        ) {
          throw new CryptoError(
            "keyring_missing",
            "The workspace must be unlocked before changing the passphrase"
          );
        }

        const result = await current.session.keyring.changePassphrase(
          currentPassphrase,
          nextPassphrase
        );

        setState((previous) =>
          previous.status === "ready"
            ? {
                ...previous,
                session: {
                  ...previous.session,
                  record: result.record,
                  context: result.context,
                },
              }
            : previous
        );
        setNotice("encryption.settings.passphraseSuccess");
      });
    },
    [runExclusive]
  );

  const dismissOperation = useCallback(() => {
    if (setupRef.current !== null) {
      return;
    }

    setOperation(null);
  }, []);

  const lockSession = useCallback(
    async (broadcast: boolean) => {
      await runExclusive(async () => {
        const current = stateRef.current;
        let session: CryptoSession | null = null;

        if (current.status === "ready" && current.session.keyring !== null) {
          session = current.session;
        } else if (current.status === "locked") {
          session = current.session;
        }

        if (session === null || session.keyring === null) {
          return;
        }

        let record = session.record;

        try {
          record = (await session.keyring.get()) ?? record;
        } catch {
          record = session.record;
        }

        const activeRuntime = runtimeRef.current;
        runtimeRef.current = null;

        if (activeRuntime !== null) {
          await disposeRuntime(activeRuntime);
        }

        if (!mountedRef.current) {
          return;
        }

        setState({
          status: "locked",
          session: {
            ...session,
            record,
            context: null,
          },
        });

        if (broadcast) {
          coordinatorRef.current?.notifyLock();
        }
      });
    },
    [runExclusive]
  );

  const lock = useCallback(() => lockSession(true), [lockSession]);

  const resetEncryption = useCallback(async () => {
    await runExclusive(async () => {
      const current = stateRef.current;

      if (current.status !== "ready" && current.status !== "locked") {
        return;
      }

      const session = current.session;

      if (session.keyring === null) {
        return;
      }

      const inspection = await inspectBaseEncryption(session.base, session.workspace.id);

      if (inspection.state === "encrypted" || inspection.state === "mixed") {
        throw new CryptoError(
          "base_encrypted",
          "Encrypted workspace data must be removed before deleting the keyring"
        );
      }

      if (hasEncryptedDrafts()) {
        throw new CryptoError(
          "base_encrypted",
          "Encrypted drafts must be removed before deleting the keyring"
        );
      }

      await session.keyring.delete();

      const activeRuntime = runtimeRef.current;
      runtimeRef.current = null;

      if (activeRuntime !== null) {
        await disposeRuntime(activeRuntime);
      }

      const built = await buildRuntime({
        base: session.base,
        workspace: session.workspace,
        context: null,
        defaultWorkspaceName,
        ...(openAiStore === undefined ? {} : { openAiStore }),
        ...(openCredentialStore === undefined ? {} : { openCredentialStore }),
        ...(openPrivacyStore === undefined ? {} : { openPrivacyStore }),
        ...(openExtensionStore === undefined ? {} : { openExtensionStore }),
      });

      if (!mountedRef.current) {
        await disposeRuntime(built);
        return;
      }

      runtimeRef.current = {
        ai: built.ai,
        aiStore: built.aiStore,
        credentials: built.credentials,
        extensionStore: built.extensionStore,
        extensions: built.extensions,
        privacy: built.privacy,
      };
      setState({
        status: "ready",
        ai: built.ai,
        credentials: built.credentials,
        extensions: built.extensions,
        privacy: built.privacy,
        rawServices: built.rawServices,
        services: built.services,
        workspace: built.workspace,
        session: {
          ...session,
          workspace: built.workspace,
          keyring: null,
          record: null,
          context: null,
        },
        encryptionStatus: "plaintext",
        drafts: built.drafts,
      });
      coordinatorRef.current?.notifyReset();
    });
  }, [
    defaultWorkspaceName,
    openAiStore,
    openCredentialStore,
    openExtensionStore,
    openPrivacyStore,
    runExclusive,
  ]);

  const onRemoteLock = useEffectEvent(() => {
    const current = stateRef.current;

    if (current.status === "ready" && current.session.keyring === null) {
      setAttempt((value) => value + 1);
      return;
    }

    if (current.status === "locked") {
      return;
    }

    void lockSession(false);
  });

  const onRemoteReset = useEffectEvent(() => {
    if (stateRef.current.status === "loading") {
      return;
    }

    setAttempt((value) => value + 1);
  });

  useEffect(() => {
    const coordinator = tabCoordinator ?? createTabCoordinator();
    coordinatorRef.current = coordinator;
    const ownsCoordinator = tabCoordinator === undefined;
    const unsubscribe = coordinator.subscribe((event) => {
      if (event.type === "lock") {
        onRemoteLock();
      } else {
        onRemoteReset();
      }
    });

    return () => {
      unsubscribe();
      coordinatorRef.current = null;

      if (ownsCoordinator) {
        coordinator.close();
      }
    };
  }, [tabCoordinator]);

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
      previous.status === "ready"
        ? {
            ...previous,
            workspace,
            session: { ...previous.session, workspace },
          }
        : previous
    );
    revisionStore.bump();
  }, [defaultWorkspaceName, revisionStore, state]);

  const value = useMemo<ReadyAppData | null>(() => {
    if (state.status !== "ready") {
      return null;
    }

    return {
      status: "ready",
      ai: state.ai,
      credentials: state.credentials,
      extensions: state.extensions,
      privacy: state.privacy,
      services: state.services,
      workspace: state.workspace,
      drafts: state.drafts,
      revisionStore,
      invalidate,
      refreshWorkspace,
    };
  }, [invalidate, refreshWorkspace, revisionStore, state]);

  const encryption = useMemo<EncryptionContextValue>(() => {
    if (
      state.status === "loading" ||
      state.status === "error" ||
      state.status === "missing-keyring"
    ) {
      return {
        status: "locked",
        record: null,
        pendingRotation: false,
        operation,
        notice,
        unlock,
        unlockWithRecoveryKey,
        lock,
        startSetup,
        cancelSetup,
        rotate,
        changePassphrase,
        dismissOperation,
        clearNotice,
        resetEncryption,
      };
    }

    return {
      status: state.status === "locked" ? "locked" : state.encryptionStatus,
      record: state.session.record,
      pendingRotation:
        state.session.record?.pending !== null &&
        state.session.record?.pending !== undefined,
      operation,
      notice,
      unlock,
      unlockWithRecoveryKey,
      lock,
      startSetup,
      cancelSetup,
      rotate,
      changePassphrase,
      dismissOperation,
      clearNotice,
      resetEncryption,
    };
  }, [
    cancelSetup,
    changePassphrase,
    clearNotice,
    dismissOperation,
    lock,
    notice,
    operation,
    resetEncryption,
    rotate,
    startSetup,
    state,
    unlock,
    unlockWithRecoveryKey,
  ]);

  if (state.status === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <p role="status" className="text-muted text-sm">
          {t("data.loading")}
        </p>
      </main>
    );
  }

  if (state.status === "error") {
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

  if (state.status === "missing-keyring") {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div role="alert" className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">
            {t("encryption.missingKeyring.title")}
          </h1>
          <p className="text-muted text-sm leading-6">
            {t("encryption.missingKeyring.body")}
          </p>
          <Button onClick={retry}>{t("encryption.missingKeyring.retry")}</Button>
        </div>
      </main>
    );
  }

  return (
    <EncryptionProvider value={encryption}>
      {state.status === "ready" && value !== null ? (
        <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
      ) : (
        children
      )}
    </EncryptionProvider>
  );
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
