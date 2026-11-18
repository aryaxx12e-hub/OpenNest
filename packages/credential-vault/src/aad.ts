import { AES_GCM_ALGORITHM, canonicalJson, utf8 } from "@opennest/crypto";

export interface EntryAadInput {
  readonly vaultId: string;
  readonly activeKid: string;
  readonly entryId: string;
  readonly providerId: string;
  readonly accountLabel: string;
  readonly entryVersion: 1;
}

export function vaultDekAad(vaultId: string, activeKid: string): Uint8Array {
  return aad({
    activeKid,
    purpose: "vault-dek",
    vaultId,
  });
}

export function entryKeyAad(input: EntryAadInput): Uint8Array {
  return entryAad(input, "entry-key");
}

export function entrySecretAad(input: EntryAadInput): Uint8Array {
  return entryAad(input, "entry-secret");
}

function entryAad(input: EntryAadInput, purpose: string): Uint8Array {
  return aad({
    accountLabel: input.accountLabel,
    activeKid: input.activeKid,
    entryId: input.entryId,
    entryVersion: input.entryVersion,
    providerId: input.providerId,
    purpose,
    vaultId: input.vaultId,
  });
}

function aad(input: Record<string, string | number>): Uint8Array {
  return utf8(
    canonicalJson({
      alg: AES_GCM_ALGORITHM,
      envelopeVersion: 1,
      ...input,
    })
  );
}
