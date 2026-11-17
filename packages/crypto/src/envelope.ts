import {
  AES_GCM_ALGORITHM,
  GCM_NONCE_BYTES,
  GCM_TAG_BYTES,
  decryptAesGcm,
  encryptAesGcm,
  importAesGcmKey,
  parseWrappedKey,
  unwrapKeyBytes,
  wrapKeyBytes,
} from "./aes";
import { base64UrlDecode, base64UrlEncode } from "./base64url";
import { concatBytes, copyBytes, decodeUtf8, utf8 } from "./bytes";
import { canonicalJson } from "./canonical-json";
import { CryptoError } from "./errors";
import { randomBytes } from "./random";
import { parseStrictJson } from "./strict-json";
import type { WrappedKey } from "./aes";

const TEXT_PREFIX = "enc1:";
const BINARY_MAGIC = new Uint8Array([0x4f, 0x4e, 0x42, 0x31]);
const BINARY_VERSION = 1;
const BINARY_ALGORITHM = 1;
const ENVELOPE_VERSION = 1;
const CEK_BYTES = 32;
const TEXT_KEYS = ["alg", "ciphertext", "iv", "kid", "tag", "version", "wrappedKey"];
const WRAPPED_KEY_KEYS = ["ciphertext", "iv", "tag"];

export interface WorkspaceCryptoContext {
  workspaceId: string;
  keyId: string;
  dek: CryptoKey;
}

export interface EnvelopeContext {
  workspaceId: string;
  purpose: string;
  entityType: string;
  entityId: string;
  entityVersion?: number;
}

export interface SealTextInput {
  context: EnvelopeContext;
  dek: CryptoKey;
  keyId: string;
  plaintext: string;
}

export interface OpenTextInput {
  context: EnvelopeContext;
  dek: CryptoKey;
  keyId: string;
  envelope: string;
}

export interface SealBytesInput {
  context: EnvelopeContext;
  dek: CryptoKey;
  keyId: string;
  plaintext: Uint8Array;
}

export interface OpenBytesInput {
  context: EnvelopeContext;
  dek: CryptoKey;
  keyId: string;
  envelope: Uint8Array;
}

export interface TextEnvelope {
  version: 1;
  alg: "AES-256-GCM";
  kid: string;
  iv: string;
  wrappedKey: WrappedKey;
  ciphertext: string;
  tag: string;
}

export interface ParsedTextEnvelope {
  body: TextEnvelope;
  iv: Uint8Array;
  wrappedKey: WrappedKey;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export interface ParsedBinaryEnvelope {
  kid: string;
  iv: Uint8Array;
  wrappedKey: WrappedKey;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export async function sealText(input: SealTextInput): Promise<string> {
  assertEnvelopeContext(input.context);
  assertKeyId(input.keyId);

  const plaintext = utf8(input.plaintext);
  const aad = buildEnvelopeAad(input.context, input.keyId, ENVELOPE_VERSION);
  const cekBytes = randomBytes(CEK_BYTES);
  const cek = await importAesGcmKey(cekBytes);
  const iv = randomBytes(GCM_NONCE_BYTES);
  const sealed = await encryptAesGcm(cek, iv, aad, plaintext);
  const wrappedKey = await wrapKeyBytes(input.dek, cekBytes, aad);
  const body: TextEnvelope = {
    version: 1,
    alg: AES_GCM_ALGORITHM,
    kid: input.keyId,
    iv: base64UrlEncode(iv),
    wrappedKey,
    ciphertext: base64UrlEncode(sealed.ciphertext),
    tag: base64UrlEncode(sealed.tag),
  };

  return `${TEXT_PREFIX}${base64UrlEncode(utf8(JSON.stringify(body)))}`;
}

export async function openText(input: OpenTextInput): Promise<string> {
  assertEnvelopeContext(input.context);
  assertKeyId(input.keyId);

  const parsed = parseTextEnvelope(input.envelope);

  if (parsed.body.kid !== input.keyId) {
    throw new CryptoError(
      "unknown_key_id",
      "Envelope key ID does not match the active key"
    );
  }

  const aad = buildEnvelopeAad(input.context, parsed.body.kid, parsed.body.version);
  const cekBytes = await unwrapCek(input.dek, parsed.wrappedKey, aad);
  const cek = await importAesGcmKey(cekBytes);
  const plaintext = await decryptPayload(
    cek,
    parsed.iv,
    aad,
    parsed.ciphertext,
    parsed.tag
  );

  return decodeUtf8(plaintext);
}

export async function sealBytes(input: SealBytesInput): Promise<Uint8Array> {
  assertEnvelopeContext(input.context);
  assertKeyId(input.keyId);

  const kid = utf8(input.keyId);

  if (kid.length > 0xffff) {
    throw new CryptoError("invalid_envelope", "Key ID is too long");
  }

  const aad = buildEnvelopeAad(input.context, input.keyId, ENVELOPE_VERSION);
  const cekBytes = randomBytes(CEK_BYTES);
  const cek = await importAesGcmKey(cekBytes);
  const iv = randomBytes(GCM_NONCE_BYTES);
  const sealed = await encryptAesGcm(cek, iv, aad, copyBytes(input.plaintext));
  const wrapped = await wrapKeyBytes(input.dek, cekBytes, aad);
  const wrappedBytes = concatBytes(
    base64UrlDecode(wrapped.iv),
    base64UrlDecode(wrapped.ciphertext),
    base64UrlDecode(wrapped.tag)
  );

  if (wrappedBytes.length > 0xffff) {
    throw new CryptoError("invalid_envelope", "Wrapped key is too long");
  }

  const header = new Uint8Array(8);
  header.set(BINARY_MAGIC, 0);
  header[4] = BINARY_VERSION;
  header[5] = BINARY_ALGORITHM;
  new DataView(header.buffer).setUint16(6, kid.length);

  const wrappedLength = new Uint8Array(2);
  new DataView(wrappedLength.buffer).setUint16(0, wrappedBytes.length);

  return concatBytes(
    header,
    kid,
    iv,
    wrappedLength,
    wrappedBytes,
    sealed.ciphertext,
    sealed.tag
  );
}

export async function openBytes(input: OpenBytesInput): Promise<Uint8Array> {
  assertEnvelopeContext(input.context);
  assertKeyId(input.keyId);

  const parsed = parseBinaryEnvelope(input.envelope);

  if (parsed.kid !== input.keyId) {
    throw new CryptoError(
      "unknown_key_id",
      "Envelope key ID does not match the active key"
    );
  }

  const aad = buildEnvelopeAad(input.context, parsed.kid, ENVELOPE_VERSION);
  const cekBytes = await unwrapCek(input.dek, parsed.wrappedKey, aad);
  const cek = await importAesGcmKey(cekBytes);

  return decryptPayload(cek, parsed.iv, aad, parsed.ciphertext, parsed.tag);
}

export function parseTextEnvelope(envelope: string): ParsedTextEnvelope {
  if (typeof envelope !== "string" || !envelope.startsWith(TEXT_PREFIX)) {
    throw new CryptoError("invalid_envelope", "Missing enc1 envelope prefix");
  }

  let bodyValue: unknown;

  try {
    const bytes = base64UrlDecode(envelope.slice(TEXT_PREFIX.length));
    bodyValue = parseStrictJson(decodeUtf8(bytes));
  } catch (error) {
    throw new CryptoError(
      "invalid_envelope",
      "Text envelope is not valid base64url JSON",
      {
        cause: error,
      }
    );
  }

  if (typeof bodyValue !== "object" || bodyValue === null) {
    throw new CryptoError("invalid_envelope", "Text envelope must be an object");
  }

  const body = bodyValue as Record<string, unknown>;
  assertExactKeys(body, TEXT_KEYS);

  if (body.version !== ENVELOPE_VERSION) {
    throw new CryptoError("invalid_envelope", "Unsupported envelope version");
  }

  if (body.alg !== AES_GCM_ALGORITHM) {
    throw new CryptoError("invalid_envelope", "Unsupported envelope algorithm");
  }

  if (typeof body.kid !== "string" || body.kid.length === 0) {
    throw new CryptoError("invalid_envelope", "Envelope key ID is missing");
  }

  const iv = decodeTextField(body.iv, "payload nonce");

  if (iv.length !== GCM_NONCE_BYTES) {
    throw new CryptoError("invalid_envelope", "Payload nonce has the wrong length");
  }

  const wrappedKey = parseTextWrappedKey(body.wrappedKey);
  const ciphertext = decodeTextField(body.ciphertext, "payload ciphertext");
  const tag = decodeTextField(body.tag, "payload tag");

  if (tag.length !== GCM_TAG_BYTES) {
    throw new CryptoError("invalid_envelope", "Payload tag has the wrong length");
  }

  return {
    body: {
      version: 1,
      alg: AES_GCM_ALGORITHM,
      kid: body.kid,
      iv: body.iv as string,
      wrappedKey: body.wrappedKey as WrappedKey,
      ciphertext: body.ciphertext as string,
      tag: body.tag as string,
    },
    iv,
    wrappedKey,
    ciphertext,
    tag,
  };
}

export function parseBinaryEnvelope(envelope: Uint8Array): ParsedBinaryEnvelope {
  if (!(envelope instanceof Uint8Array) || envelope.length < 8 + GCM_NONCE_BYTES + 2) {
    throw new CryptoError("invalid_envelope", "Binary envelope is truncated");
  }

  for (let index = 0; index < BINARY_MAGIC.length; index += 1) {
    if (envelope[index] !== BINARY_MAGIC[index]) {
      throw new CryptoError("invalid_envelope", "Missing ONB1 binary envelope magic");
    }
  }

  if (envelope[4] !== BINARY_VERSION || envelope[5] !== BINARY_ALGORITHM) {
    throw new CryptoError(
      "invalid_envelope",
      "Unsupported binary envelope version or algorithm"
    );
  }

  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const kidLength = view.getUint16(6);
  let offset = 8;

  if (kidLength === 0 || offset + kidLength > envelope.length) {
    throw new CryptoError("invalid_envelope", "Binary envelope key ID is invalid");
  }

  const kid = decodeUtf8(envelope.slice(offset, offset + kidLength));
  offset += kidLength;

  if (offset + GCM_NONCE_BYTES + 2 > envelope.length) {
    throw new CryptoError("invalid_envelope", "Binary envelope is truncated");
  }

  const iv = envelope.slice(offset, offset + GCM_NONCE_BYTES);
  offset += GCM_NONCE_BYTES;

  const wrappedLength = view.getUint16(offset);
  offset += 2;

  if (wrappedLength !== GCM_NONCE_BYTES + CEK_BYTES + GCM_TAG_BYTES) {
    throw new CryptoError("invalid_envelope", "Wrapped key has the wrong length");
  }

  if (offset + wrappedLength + GCM_TAG_BYTES > envelope.length) {
    throw new CryptoError("invalid_envelope", "Binary envelope is truncated");
  }

  const wrappedBytes = envelope.slice(offset, offset + wrappedLength);
  offset += wrappedLength;
  const wrappedKey: WrappedKey = {
    iv: base64UrlEncode(wrappedBytes.slice(0, GCM_NONCE_BYTES)),
    ciphertext: base64UrlEncode(
      wrappedBytes.slice(GCM_NONCE_BYTES, GCM_NONCE_BYTES + CEK_BYTES)
    ),
    tag: base64UrlEncode(wrappedBytes.slice(GCM_NONCE_BYTES + CEK_BYTES)),
  };
  const tag = envelope.slice(envelope.length - GCM_TAG_BYTES);
  const ciphertext = envelope.slice(offset, envelope.length - GCM_TAG_BYTES);

  return {
    kid,
    iv,
    wrappedKey,
    ciphertext,
    tag,
  };
}

export function buildEnvelopeAad(
  context: EnvelopeContext,
  keyId: string,
  version: number
): Uint8Array {
  const aad: Record<string, unknown> = {
    alg: AES_GCM_ALGORITHM,
    entityId: context.entityId,
    entityType: context.entityType,
    envelopeVersion: version,
    kid: keyId,
    purpose: context.purpose,
    workspaceId: context.workspaceId,
  };

  if (context.entityVersion !== undefined) {
    aad.entityVersion = context.entityVersion;
  }

  return utf8(canonicalJson(aad));
}

function assertEnvelopeContext(context: EnvelopeContext): void {
  for (const value of [
    context.workspaceId,
    context.purpose,
    context.entityType,
    context.entityId,
  ]) {
    if (typeof value !== "string" || value.length === 0) {
      throw new CryptoError("invalid_envelope", "Envelope context is incomplete");
    }
  }

  if (
    context.entityVersion !== undefined &&
    (!Number.isInteger(context.entityVersion) || context.entityVersion < 0)
  ) {
    throw new CryptoError("invalid_envelope", "Entity version is invalid");
  }
}

function assertKeyId(keyId: string): void {
  if (typeof keyId !== "string" || keyId.length === 0) {
    throw new CryptoError("invalid_envelope", "Key ID is missing");
  }
}

async function decryptPayload(
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array
): Promise<Uint8Array> {
  try {
    return await decryptAesGcm(key, iv, aad, { ciphertext, tag });
  } catch (error) {
    if (error instanceof CryptoError && error.code === "authentication_failed") {
      throw error;
    }

    throw new CryptoError("authentication_failed", "Payload authentication failed", {
      cause: error,
    });
  }
}

async function unwrapCek(
  dek: CryptoKey,
  wrappedKey: WrappedKey,
  aad: Uint8Array
): Promise<Uint8Array> {
  try {
    return await unwrapKeyBytes(dek, wrappedKey, aad);
  } catch (error) {
    if (error instanceof CryptoError && error.code === "authentication_failed") {
      throw error;
    }

    throw new CryptoError("invalid_envelope", "Wrapped content key is invalid", {
      cause: error,
    });
  }
}

function parseTextWrappedKey(value: unknown): WrappedKey {
  if (typeof value !== "object" || value === null) {
    throw new CryptoError("invalid_envelope", "Wrapped key must be an object");
  }

  assertExactKeys(value as Record<string, unknown>, WRAPPED_KEY_KEYS);

  try {
    parseWrappedKey(value, CEK_BYTES);
  } catch (error) {
    throw new CryptoError("invalid_envelope", "Wrapped key is invalid", { cause: error });
  }

  const record = value as Record<string, unknown>;

  return {
    iv: record.iv as string,
    ciphertext: record.ciphertext as string,
    tag: record.tag as string,
  };
}

function decodeTextField(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string") {
    throw new CryptoError("invalid_envelope", `${label} must be a string`);
  }

  try {
    return base64UrlDecode(value);
  } catch (error) {
    throw new CryptoError("invalid_envelope", `${label} is not valid base64url`, {
      cause: error,
    });
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();

  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new CryptoError("invalid_envelope", "Envelope fields do not match version 1");
  }
}
