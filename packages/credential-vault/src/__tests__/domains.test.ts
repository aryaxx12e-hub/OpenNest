import {
  BACKUP_KEK_DOMAIN,
  base64UrlDecode,
  deriveKekBytes,
  importAesGcmKey,
  unwrapKeyBytes,
  WORKSPACE_KEK_DOMAIN,
  type KdfParameters,
} from "@opennest/crypto";
import { describe, expect, it } from "vitest";

import { vaultDekAad } from "../aad";
import { createMemoryCredentialVaultStore } from "../memory-store";
import { CREDENTIAL_VAULT_KEK_DOMAIN } from "../types";
import { createCredentialVault } from "../vault";

const NOW = 1_700_000_000_000;
const PASSPHRASE = "correct horse battery";

async function deriveKek(passphrase: string, kdf: KdfParameters, domain: string) {
  return importAesGcmKey(
    await deriveKekBytes(passphrase, base64UrlDecode(kdf.salt), kdf.iterations, domain)
  );
}

describe("credential vault key domains", () => {
  it("isolates the vault DEK from workspace and backup KEKs", async () => {
    const vault = createCredentialVault({
      store: createMemoryCredentialVaultStore(),
      now: () => NOW,
    });
    await vault.setup(PASSPHRASE);
    const record = await vault.get();

    if (record === null) {
      throw new Error("Expected a vault record");
    }

    const workspaceKek = await deriveKek(PASSPHRASE, record.kdf, WORKSPACE_KEK_DOMAIN);
    const backupKek = await deriveKek(PASSPHRASE, record.kdf, BACKUP_KEK_DOMAIN);
    const vaultKek = await deriveKek(PASSPHRASE, record.kdf, CREDENTIAL_VAULT_KEK_DOMAIN);
    const aad = vaultDekAad(record.vaultId, record.activeKid);

    await expect(
      unwrapKeyBytes(workspaceKek, record.wrappedDek, aad)
    ).rejects.toMatchObject({
      code: "authentication_failed",
    });
    await expect(unwrapKeyBytes(backupKek, record.wrappedDek, aad)).rejects.toMatchObject(
      {
        code: "authentication_failed",
      }
    );
    await expect(unwrapKeyBytes(vaultKek, record.wrappedDek, aad)).resolves.toBeTruthy();
  });
});
