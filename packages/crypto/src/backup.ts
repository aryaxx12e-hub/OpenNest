import {
  decryptAesGcm,
  encryptAesGcm,
  importAesGcmKey,
  parseWrappedKey,
  unwrapKeyBytes,
  wrapKeyBytes,
  type WrappedKey,
} from "./aes";
import { base64UrlDecode, base64UrlEncode } from "./base64url";
import { concatBytes, copyBytes, utf8 } from "./bytes";
import { CryptoError } from "./errors";
import {
  BACKUP_KEK_DOMAIN,
  createKdfParameters,
  deriveKekBytes,
  parseKdfParameters,
  type KdfParameters,
} from "./kdf";
import { getWebCrypto, randomBytes, randomId } from "./random";
import { decodeBackupKey, encodeBackupKey } from "./recovery-key";

export const BACKUP_FORMAT = "opennest-backup";
export const BACKUP_FORMAT_VERSION = 2;
export const BACKUP_ENCRYPTION_VERSION = 1;
export const BACKUP_ALGORITHM = "AES-256-GCM";
export const BACKUP_CHUNK_SIZE = 4 * 1024 * 1024;

const DEK_BYTES = 32;
const CEK_BYTES = 32;

export interface BackupCounts {
  folders: number;
  tags: number;
  files: number;
  notes: number;
}

export interface BackupSummaryPayload {
  counts: BackupCounts & { workspaces: 1 };
  totalPlaintextBytes: number;
}

export interface BackupEncryptionHeader {
  version: 1;
  alg: "AES-256-GCM";
  kdf: KdfParameters;
  kid: string;
  wrappedDek: WrappedKey;
}

export interface BackupChunk {
  index: number;
  iv: string;
  wrappedCek: WrappedKey;
  ciphertext: string;
  tag: string;
}

export interface BackupEnvelopeV2 {
  format: "opennest-backup";
  formatVersion: 2;
  exportedAt: string;
  encryption: BackupEncryptionHeader;
  chunkSize: number;
  chunkCount: number;
  summary: BackupSummaryPayload;
  chunks: BackupChunk[];
}

export type BackupKeySource =
  { kind: "passphrase"; passphrase: string } | { kind: "backupKey"; backupKey: string };

export interface SealBackupInput {
  payload: Uint8Array;
  exportedAt: string;
  counts: BackupCounts;
  keySource: BackupKeySource;
  chunkSize?: number;
  kid?: string;
}

export interface SealedBackup {
  envelope: BackupEnvelopeV2;
  plaintextBytes: number;
}

export interface OpenBackupInput {
  envelope: unknown;
  keySource: BackupKeySource;
}

export interface OpenedBackup {
  envelope: BackupEnvelopeV2;
  payload: Uint8Array;
}

export function createBackupKey(): string {
  return encodeBackupKey(randomBytes(DEK_BYTES));
}

export async function sealBackup(input: SealBackupInput): Promise<SealedBackup> {
  const payload = copyBytes(input.payload);
  const chunkSize = input.chunkSize ?? BACKUP_CHUNK_SIZE;
  assertChunkSize(chunkSize);
  assertCounts(input.counts);

  if (typeof input.exportedAt !== "string" || input.exportedAt.length === 0) {
    throw new CryptoError("invalid_envelope", "Backup export date is missing");
  }

  const kdf = createKdfParameters(BACKUP_KEK_DOMAIN);
  const kid = input.kid ?? randomId("backup");

  if (typeof kid !== "string" || kid.length === 0) {
    throw new CryptoError("invalid_envelope", "Backup key ID is missing");
  }

  const chunkCount = payload.length === 0 ? 1 : Math.ceil(payload.length / chunkSize);
  const kek = await deriveBackupKek(input.keySource, kdf);
  const dekBytes = randomBytes(DEK_BYTES);
  const aadContext = {
    alg: BACKUP_ALGORITHM,
    chunkCount,
    chunkSize,
    domain: BACKUP_KEK_DOMAIN,
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    kdf,
    kid,
  };
  const wrappedDek = await wrapKeyBytes(
    kek,
    dekBytes,
    utf8(
      canonicalStringify({
        ...aadContext,
        purpose: "backup-dek-wrap",
      })
    )
  );
  const dek = await importAesGcmKey(dekBytes);
  const chunks: BackupChunk[] = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * chunkSize;
    const chunkBytes = payload.slice(start, Math.min(start + chunkSize, payload.length));
    const cekBytes = randomBytes(CEK_BYTES);
    const cek = await importAesGcmKey(cekBytes);
    const chunkAad = {
      alg: BACKUP_ALGORITHM,
      chunkCount,
      chunkIndex: index,
      chunkSize,
      domain: BACKUP_KEK_DOMAIN,
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      kid,
      purpose: "backup-chunk",
    };
    const wrappedCek = await wrapKeyBytes(
      dek,
      cekBytes,
      utf8(canonicalStringify(chunkAad))
    );
    const parsedCek = parseWrappedKey(wrappedCek, CEK_BYTES);
    const wrappedCekHash = await hashBase64Url(
      concatBytes(parsedCek.iv, parsedCek.ciphertext, parsedCek.tag)
    );
    const iv = randomBytes(12);
    const sealed = await encryptAesGcm(
      cek,
      iv,
      utf8(canonicalStringify({ ...chunkAad, wrappedCekHash })),
      chunkBytes
    );

    chunks.push({
      index,
      iv: base64UrlEncode(iv),
      wrappedCek,
      ciphertext: base64UrlEncode(sealed.ciphertext),
      tag: base64UrlEncode(sealed.tag),
    });
  }

  return {
    envelope: {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: input.exportedAt,
      encryption: {
        version: BACKUP_ENCRYPTION_VERSION,
        alg: BACKUP_ALGORITHM,
        kdf,
        kid,
        wrappedDek,
      },
      chunkSize,
      chunkCount,
      summary: {
        counts: { workspaces: 1, ...input.counts },
        totalPlaintextBytes: payload.length,
      },
      chunks,
    },
    plaintextBytes: payload.length,
  };
}

export async function openBackup(input: OpenBackupInput): Promise<OpenedBackup> {
  const envelope = parseEnvelope(input.envelope);
  const kdf = parseKdfParameters(envelope.encryption.kdf);

  if (kdf.domain !== BACKUP_KEK_DOMAIN) {
    throw new CryptoError("invalid_kdf_parameters", "Backup KDF domain does not match");
  }

  if (envelope.chunks.length !== envelope.chunkCount) {
    throw new CryptoError("invalid_envelope", "Backup chunk count does not match");
  }

  for (const [position, chunk] of envelope.chunks.entries()) {
    if (chunk.index !== position) {
      throw new CryptoError(
        "invalid_envelope",
        "Backup chunk indexes must be complete and ordered"
      );
    }
  }

  const kek = await deriveBackupKek(input.keySource, kdf);
  const dekBytes = await unwrapKeyBytes(
    kek,
    envelope.encryption.wrappedDek,
    utf8(
      canonicalStringify({
        alg: envelope.encryption.alg,
        chunkCount: envelope.chunkCount,
        chunkSize: envelope.chunkSize,
        domain: kdf.domain,
        format: envelope.format,
        formatVersion: envelope.formatVersion,
        kdf,
        kid: envelope.encryption.kid,
        purpose: "backup-dek-wrap",
      })
    )
  );
  const dek = await importAesGcmKey(dekBytes);
  const parts: Uint8Array[] = [];

  for (const chunk of envelope.chunks) {
    const parsedCek = parseWrappedKey(chunk.wrappedCek, CEK_BYTES);
    const iv = decodeBase64Url(chunk.iv, "chunk nonce");
    const tag = decodeBase64Url(chunk.tag, "chunk tag");
    const ciphertext = decodeBase64Url(chunk.ciphertext, "chunk ciphertext");

    if (iv.length !== 12 || tag.length !== 16) {
      throw new CryptoError(
        "invalid_envelope",
        "Backup chunk nonce or tag has the wrong length"
      );
    }

    const chunkAad = {
      alg: envelope.encryption.alg,
      chunkCount: envelope.chunkCount,
      chunkIndex: chunk.index,
      chunkSize: envelope.chunkSize,
      domain: kdf.domain,
      format: envelope.format,
      formatVersion: envelope.formatVersion,
      kid: envelope.encryption.kid,
      purpose: "backup-chunk",
    };
    const wrappedCekHash = await hashBase64Url(
      concatBytes(parsedCek.iv, parsedCek.ciphertext, parsedCek.tag)
    );
    const cekBytes = await unwrapKeyBytes(
      dek,
      chunk.wrappedCek,
      utf8(canonicalStringify(chunkAad))
    );
    const cek = await importAesGcmKey(cekBytes);
    const plaintext = await decryptAesGcm(
      cek,
      iv,
      utf8(canonicalStringify({ ...chunkAad, wrappedCekHash })),
      { ciphertext, tag }
    );
    const isLast = chunk.index === envelope.chunkCount - 1;

    if (
      (!isLast && plaintext.length !== envelope.chunkSize) ||
      (isLast && plaintext.length > envelope.chunkSize)
    ) {
      throw new CryptoError("invalid_envelope", "Backup chunk size is invalid");
    }

    parts.push(plaintext);
  }

  const payload = concatBytes(...parts);

  if (payload.length !== envelope.summary.totalPlaintextBytes) {
    throw new CryptoError("invalid_envelope", "Backup size summary does not match");
  }

  return { envelope, payload };
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return utf8(canonicalStringify(value));
}

function canonicalStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CryptoError("invalid_envelope", "JSON numbers must be finite");
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      throw new CryptoError("invalid_envelope", "Binary values are not JSON");
    }

    const prototype = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      throw new CryptoError("invalid_envelope", "Only plain objects can be serialized");
    }

    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((key) => {
        const field = record[key];

        if (field === undefined) {
          throw new CryptoError("invalid_envelope", "JSON values cannot be undefined");
        }

        return `${JSON.stringify(key)}:${canonicalStringify(field)}`;
      });

    return `{${fields.join(",")}}`;
  }

  throw new CryptoError("invalid_envelope", "Value is not valid JSON");
}

function parseEnvelope(value: unknown): BackupEnvelopeV2 {
  if (typeof value !== "object" || value === null) {
    throw new CryptoError("invalid_envelope", "Backup envelope must be an object");
  }

  const record = value as Record<string, unknown>;

  if (record.format !== BACKUP_FORMAT || record.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new CryptoError("invalid_envelope", "Backup format or version is unsupported");
  }

  if (typeof record.exportedAt !== "string" || record.exportedAt.length === 0) {
    throw new CryptoError("invalid_envelope", "Backup export date is missing");
  }

  const encryption = expectRecord(record.encryption, "encryption");
  const kdfValue = expectRecord(encryption.kdf, "encryption KDF");

  if (encryption.version !== BACKUP_ENCRYPTION_VERSION) {
    throw new CryptoError("invalid_envelope", "Backup encryption version is unsupported");
  }

  if (encryption.alg !== BACKUP_ALGORITHM) {
    throw new CryptoError("invalid_envelope", "Backup algorithm is unsupported");
  }

  if (typeof encryption.kid !== "string" || encryption.kid.length === 0) {
    throw new CryptoError("invalid_envelope", "Backup key ID is missing");
  }

  const wrappedDek = expectRecord(encryption.wrappedDek, "wrapped backup key");
  assertWrappedShape(wrappedDek, "wrapped backup key");

  if (
    typeof record.chunkSize !== "number" ||
    !Number.isInteger(record.chunkSize) ||
    record.chunkSize < 1 ||
    record.chunkSize > BACKUP_CHUNK_SIZE
  ) {
    throw new CryptoError("invalid_envelope", "Backup chunk size is invalid");
  }

  if (
    typeof record.chunkCount !== "number" ||
    !Number.isInteger(record.chunkCount) ||
    record.chunkCount < 1
  ) {
    throw new CryptoError("invalid_envelope", "Backup chunk count is invalid");
  }

  if (!Array.isArray(record.chunks)) {
    throw new CryptoError("invalid_envelope", "Backup chunks are missing");
  }

  const chunks = record.chunks.map((value, position) => {
    const chunk = expectRecord(value, "backup chunk");

    if (chunk.index !== position) {
      throw new CryptoError(
        "invalid_envelope",
        "Backup chunk indexes must be complete and ordered"
      );
    }

    if (
      typeof chunk.iv !== "string" ||
      typeof chunk.ciphertext !== "string" ||
      typeof chunk.tag !== "string"
    ) {
      throw new CryptoError("invalid_envelope", "Backup chunk fields are invalid");
    }

    const wrappedCek = expectRecord(chunk.wrappedCek, "wrapped content key");
    assertWrappedShape(wrappedCek, "wrapped content key");

    return {
      index: position,
      iv: chunk.iv,
      wrappedCek: wrappedCek as unknown as WrappedKey,
      ciphertext: chunk.ciphertext,
      tag: chunk.tag,
    };
  });
  const summary = expectRecord(record.summary, "backup summary");
  const counts = expectRecord(summary.counts, "backup counts");

  if (
    counts.workspaces !== 1 ||
    !isNonNegativeInteger(counts.folders) ||
    !isNonNegativeInteger(counts.tags) ||
    !isNonNegativeInteger(counts.files) ||
    !isNonNegativeInteger(counts.notes) ||
    !isNonNegativeInteger(summary.totalPlaintextBytes)
  ) {
    throw new CryptoError("invalid_envelope", "Backup summary is invalid");
  }

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: record.exportedAt,
    encryption: {
      version: BACKUP_ENCRYPTION_VERSION,
      alg: BACKUP_ALGORITHM,
      kdf: kdfValue as unknown as KdfParameters,
      kid: encryption.kid,
      wrappedDek: wrappedDek as unknown as WrappedKey,
    },
    chunkSize: record.chunkSize,
    chunkCount: record.chunkCount,
    summary: {
      counts: {
        workspaces: 1,
        folders: counts.folders as number,
        tags: counts.tags as number,
        files: counts.files as number,
        notes: counts.notes as number,
      },
      totalPlaintextBytes: summary.totalPlaintextBytes as number,
    },
    chunks,
  };
}

async function deriveBackupKek(
  keySource: BackupKeySource,
  kdf: KdfParameters
): Promise<CryptoKey> {
  const salt = base64UrlDecode(kdf.salt);
  let secret: string | Uint8Array;

  if (keySource.kind === "passphrase") {
    if (typeof keySource.passphrase !== "string" || keySource.passphrase.length === 0) {
      throw new CryptoError("invalid_passphrase", "Backup passphrase is empty");
    }

    secret = keySource.passphrase;
  } else if (keySource.kind === "backupKey") {
    secret = decodeBackupKey(keySource.backupKey);
  } else {
    throw new CryptoError("invalid_passphrase", "Backup key source is invalid");
  }

  const bytes = await deriveKekBytes(secret, salt, kdf.iterations, BACKUP_KEK_DOMAIN);

  return importAesGcmKey(bytes);
}

async function hashBase64Url(value: Uint8Array): Promise<string> {
  const digest = await getWebCrypto().subtle.digest("SHA-256", copyBytes(value));

  return base64UrlEncode(new Uint8Array(digest));
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CryptoError("invalid_envelope", `${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function assertWrappedShape(value: Record<string, unknown>, label: string): void {
  if (
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string" ||
    typeof value.tag !== "string"
  ) {
    throw new CryptoError("invalid_envelope", `${label} fields are invalid`);
  }
}

function decodeBase64Url(value: string, label: string): Uint8Array {
  try {
    return base64UrlDecode(value);
  } catch (error) {
    throw new CryptoError("invalid_envelope", `${label} is not valid base64url`, {
      cause: error,
    });
  }
}

function assertChunkSize(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > BACKUP_CHUNK_SIZE) {
    throw new CryptoError("invalid_envelope", "Backup chunk size is invalid");
  }
}

function assertCounts(counts: BackupCounts): void {
  if (
    !isNonNegativeInteger(counts.folders) ||
    !isNonNegativeInteger(counts.tags) ||
    !isNonNegativeInteger(counts.files) ||
    !isNonNegativeInteger(counts.notes)
  ) {
    throw new CryptoError("invalid_envelope", "Backup counts are invalid");
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
