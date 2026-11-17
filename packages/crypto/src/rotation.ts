import { type BlobKey, type StorageAdapter, type WorkspaceId } from "@opennest/core";

import { openBytes, openText } from "./envelope";
import type { WorkspaceCryptoContext } from "./envelope";
import { CryptoError } from "./errors";
import type { Keyring, KeyringRecordV1 } from "./keyring";
import {
  inspectBaseEncryption,
  readSnapshot,
  sealSnapshot,
  verifySealedSnapshot,
} from "./migration";

export interface RotateWorkspaceKeyOptions {
  base: StorageAdapter;
  keyring: Keyring;
  passphrase: string;
  context: WorkspaceCryptoContext;
  beforeCommit?: (context: WorkspaceCryptoContext) => Promise<void>;
}

export interface RotateWorkspaceKeyResult {
  record: KeyringRecordV1;
  context: WorkspaceCryptoContext;
}

export async function rotateWorkspaceKey(
  options: RotateWorkspaceKeyOptions
): Promise<RotateWorkspaceKeyResult> {
  try {
    return await rotate(options);
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }

    throw new CryptoError("rotation_failed", "Workspace key rotation failed", {
      cause: error,
    });
  }
}

async function rotate(
  options: RotateWorkspaceKeyOptions
): Promise<RotateWorkspaceKeyResult> {
  const workspaceId = options.keyring.workspaceId as WorkspaceId;
  let record = await options.keyring.get();

  if (record === null) {
    throw new CryptoError("keyring_missing", "The workspace keyring does not exist");
  }

  if (
    record.activeKid !== options.context.keyId &&
    record.pending?.kid !== options.context.keyId
  ) {
    throw new CryptoError(
      "rotation_state",
      "The provided key does not match the workspace keyring"
    );
  }

  const inspection = await inspectBaseEncryption(options.base, workspaceId);

  if (inspection.state === "plaintext" || inspection.state === "mixed") {
    throw new CryptoError(
      "rotation_state",
      "Workspace content must be fully encrypted before rotation"
    );
  }

  if (inspection.keyIds.length > 1) {
    throw new CryptoError(
      "rotation_state",
      "Workspace content uses more than one encryption key"
    );
  }

  if (record.pending === null) {
    record = await options.keyring.stageRotation(options.passphrase);
  }

  const pending = record.pending;

  if (pending === null) {
    throw new CryptoError("rotation_state", "The pending rotation key is missing");
  }

  const pendingContext = await options.keyring.unlockPending(options.passphrase);

  if (pendingContext.keyId !== pending.kid) {
    throw new CryptoError(
      "rotation_state",
      "The pending rotation key does not match the keyring"
    );
  }

  let needsRestore = false;

  if (inspection.state === "encrypted") {
    const keyId = inspection.keyIds[0];

    if (keyId === pending.kid) {
      needsRestore = false;
    } else if (keyId === options.context.keyId && keyId === record.activeKid) {
      needsRestore = true;
    } else {
      throw new CryptoError(
        "rotation_state",
        "Workspace content is not encrypted with the active key"
      );
    }
  }

  if (needsRestore) {
    const plaintext = await readSnapshot(options.base, workspaceId, {
      openNote: (note) =>
        openText({
          context: noteContext(options.context, note.id),
          dek: options.context.dek,
          keyId: options.context.keyId,
          envelope: note.content,
        }),
      openBlob: (key, data) =>
        openBytes({
          context: blobContext(options.context, key),
          dek: options.context.dek,
          keyId: options.context.keyId,
          envelope: data,
        }),
    });
    const sealed = await sealSnapshot(plaintext, pendingContext);

    await verifySealedSnapshot(sealed, plaintext, pendingContext);

    try {
      await options.base.restore(sealed);
    } catch (error) {
      throw new CryptoError("rotation_failed", "The rotated restore failed", {
        cause: error,
      });
    }
  }

  if (options.beforeCommit !== undefined) {
    try {
      await options.beforeCommit(pendingContext);
    } catch (error) {
      if (error instanceof CryptoError) {
        throw error;
      }

      throw new CryptoError("rotation_failed", "Workspace rotation preparation failed", {
        cause: error,
      });
    }
  }

  const committed = await options.keyring.commitRotation();

  return { record: committed, context: pendingContext };
}

function noteContext(context: WorkspaceCryptoContext, noteId: string) {
  return {
    workspaceId: context.workspaceId,
    purpose: "note-content",
    entityType: "note",
    entityId: noteId,
  };
}

function blobContext(context: WorkspaceCryptoContext, blobKey: BlobKey) {
  return {
    workspaceId: context.workspaceId,
    purpose: "file-bytes",
    entityType: "blob",
    entityId: blobKey,
  };
}
