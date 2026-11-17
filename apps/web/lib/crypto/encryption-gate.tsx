"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { KeyringRecordV1, MigrationPhase } from "@opennest/crypto";

import { EncryptionOperationScreen } from "@/components/encryption-operation";
import { UnlockScreen } from "@/components/unlock-screen";

export type EncryptionStatus = "plaintext" | "locked" | "unlocked";

export type EncryptionOperationPhase =
  MigrationPhase | "drafts-stage" | "drafts-finalize" | "drafts-discard";

export interface EncryptionProgress {
  phase: EncryptionOperationPhase;
  completed: number;
  total: number;
}

export interface EncryptionOperation {
  kind: "setup" | "rotation";
  progress: EncryptionProgress;
  error: unknown | null;
  canDismiss: boolean;
}

export interface EncryptionContextValue {
  status: EncryptionStatus;
  record: KeyringRecordV1 | null;
  pendingRotation: boolean;
  operation: EncryptionOperation | null;
  notice: string | null;
  unlock: (passphrase: string) => Promise<void>;
  unlockWithRecoveryKey: (recoveryKey: string) => Promise<void>;
  lock: () => Promise<void>;
  startSetup: (passphrase: string, recoveryKey: string) => Promise<void>;
  cancelSetup: () => Promise<void>;
  rotate: (passphrase: string) => Promise<void>;
  changePassphrase: (currentPassphrase: string, nextPassphrase: string) => Promise<void>;
  dismissOperation: () => void;
  clearNotice: () => void;
  resetEncryption: () => Promise<void>;
}

const EncryptionContext = createContext<EncryptionContextValue | null>(null);

export interface EncryptionProviderProps {
  value: EncryptionContextValue;
  children: ReactNode;
}

export function EncryptionProvider({ value, children }: EncryptionProviderProps) {
  return (
    <EncryptionContext.Provider value={value}>{children}</EncryptionContext.Provider>
  );
}

export function useEncryption(): EncryptionContextValue {
  const context = useContext(EncryptionContext);

  if (context === null) {
    throw new Error("useEncryption must be used inside an AppDataProvider");
  }

  return context;
}

export function EncryptionGate({ children }: { children: ReactNode }) {
  const encryption = useEncryption();

  if (encryption.operation !== null) {
    return (
      <EncryptionOperationScreen
        operation={encryption.operation}
        onCancelSetup={encryption.cancelSetup}
        onDismiss={encryption.dismissOperation}
      />
    );
  }

  if (encryption.status === "locked") {
    return (
      <UnlockScreen
        onUnlock={encryption.unlock}
        onUnlockWithRecoveryKey={encryption.unlockWithRecoveryKey}
      />
    );
  }

  return <>{children}</>;
}
