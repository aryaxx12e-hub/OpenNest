import { PrivacyError } from "./errors";
import { normalizeOrigin } from "./scope";
import type {
  ConsentExpectation,
  ConsentRecord,
  ConsentRegistry,
  ConsentStore,
  DataClass,
} from "./types";

export const MAX_CONSENT_TTL_MS = 5 * 60 * 1000;

const DATA_CLASSES = new Set<string>(["D0", "D1", "D2", "D3", "D4", "D5"]);
const HASH = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function createConsentRegistry(input: {
  store: ConsentStore;
  now: () => number;
  generateId: () => string;
}): ConsentRegistry {
  const { store, now, generateId } = input;

  return {
    async create(request) {
      const at = validTimestamp(now(), "creation time");
      const consent: ConsentRecord = {
        id: validGeneratedId(generateId()),
        sessionId: validSessionId(request.sessionId),
        principalId: validPrincipalId(request.principalId),
        providerId: validProviderId(request.providerId),
        model: validModel(request.model),
        endpointOrigin: validOrigin(request.endpointOrigin),
        payloadHash: validPayloadHash(request.payloadHash),
        payloadBytes: validPayloadBytes(request.payloadBytes),
        dataClasses: validDataClasses(request.dataClasses),
        purpose: validPurpose(request.purpose),
        createdAt: at,
        expiresAt: validExpiry(request.expiresAt, at),
        usedAt: null,
        revokedAt: null,
      };

      await store.put(consent);

      return consent;
    },

    get(id) {
      return store.get(id);
    },

    list() {
      return store.list();
    },

    async consume(id, expected) {
      const record = await store.get(id);

      if (record === null) {
        throw invalid("The consent does not exist.");
      }

      const at = validTimestamp(expected.at, "consent time");
      const expectation = normalizeExpectation(expected);

      if (record.revokedAt !== null) {
        throw new PrivacyError("consent_revoked", "The consent has been revoked.");
      }

      if (record.usedAt !== null) {
        throw new PrivacyError("consent_used", "The consent has already been used.");
      }

      if (at >= record.expiresAt) {
        throw new PrivacyError("consent_expired", "The consent has expired.");
      }

      if (
        record.sessionId !== expectation.sessionId ||
        record.providerId !== expectation.providerId ||
        record.model !== expectation.model ||
        record.endpointOrigin !== expectation.endpointOrigin ||
        record.payloadHash !== expectation.payloadHash ||
        !sameDataClasses(record.dataClasses, expectation.dataClasses)
      ) {
        throw new PrivacyError(
          "consent_mismatch",
          "The consent does not match this request."
        );
      }

      const used: ConsentRecord = { ...record, usedAt: at };
      await store.put(used);

      return used;
    },

    async revoke(id, at) {
      const record = await store.get(id);

      if (record === null) {
        throw invalid("The consent does not exist.");
      }

      const revokedAt = validTimestamp(at, "revocation time");

      if (record.revokedAt !== null) {
        return record;
      }

      const revoked: ConsentRecord = { ...record, revokedAt };
      await store.put(revoked);

      return revoked;
    },

    clear() {
      return store.clear();
    },
  };
}

function normalizeExpectation(expected: ConsentExpectation): {
  sessionId: string;
  providerId: string;
  model: string;
  endpointOrigin: string;
  payloadHash: string;
  dataClasses: readonly DataClass[];
} {
  return {
    sessionId: validSessionId(expected.sessionId),
    providerId: validProviderId(expected.providerId),
    model: validModel(expected.model),
    endpointOrigin: validOrigin(expected.endpointOrigin),
    payloadHash: validPayloadHash(expected.payloadHash),
    dataClasses: validDataClasses(expected.dataClasses),
  };
}

function validGeneratedId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || CONTROL_CHARACTERS.test(value)) {
    throw invalid("The consent ID is invalid.");
  }

  return value;
}

function validSessionId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    CONTROL_CHARACTERS.test(value) ||
    /\s/.test(value)
  ) {
    throw invalid("The consent session is invalid.");
  }

  return value;
}

function validPrincipalId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    value.trim() !== value ||
    value.includes("*") ||
    value.includes("..") ||
    /[\u0000-\u001f\u007f\s/\\#?]/.test(value)
  ) {
    throw invalid("The consent principal is invalid.");
  }

  return value;
}

function validProviderId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 300 ||
    value.trim() !== value ||
    value.includes("*") ||
    value.includes("..") ||
    /[\u0000-\u001f\u007f\s/\\#?]/.test(value)
  ) {
    throw invalid("The consent provider is invalid.");
  }

  return value;
}

function validModel(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    value.trim() !== value ||
    value.includes("*") ||
    CONTROL_CHARACTERS.test(value) ||
    /\s/.test(value)
  ) {
    throw invalid("The consent model is invalid.");
  }

  return value;
}

function validOrigin(value: unknown): string {
  if (typeof value !== "string") {
    throw invalid("The consent origin is invalid.");
  }

  try {
    return normalizeOrigin(value);
  } catch {
    throw invalid("The consent origin is invalid.");
  }
}

function validPayloadHash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw invalid("The consent payload hash must be a lowercase SHA-256 digest.");
  }

  return value;
}

function validPayloadBytes(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalid("The consent payload size is invalid.");
  }

  return value;
}

function validDataClasses(value: readonly DataClass[]): readonly DataClass[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid("A consent needs at least one data class.");
  }

  for (const dataClass of value) {
    if (typeof dataClass !== "string" || !DATA_CLASSES.has(dataClass)) {
      throw invalid("The consent data classes are invalid.");
    }
  }

  const unique = [...new Set(value)].sort();

  if (unique.length !== value.length) {
    throw invalid("The consent data classes contain duplicates.");
  }

  return unique;
}

function validPurpose(value: unknown): string {
  if (typeof value !== "string") {
    throw invalid("The consent purpose is invalid.");
  }

  const purpose = value.trim();

  if (purpose.length === 0 || purpose.length > 200) {
    throw invalid("A consent needs a short purpose.");
  }

  return purpose;
}

function validExpiry(value: unknown, at: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= at) {
    throw invalid("The consent expiry must be in the future.");
  }

  if (value - at > MAX_CONSENT_TTL_MS) {
    throw invalid("The consent expiry is too far in the future.");
  }

  return value;
}

function validTimestamp(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalid(`The ${label} is invalid.`);
  }

  return value;
}

function sameDataClasses(
  left: readonly DataClass[],
  right: readonly DataClass[]
): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function invalid(message: string): PrivacyError {
  return new PrivacyError("invalid_consent", message);
}
