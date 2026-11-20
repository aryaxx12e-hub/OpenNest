import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

export const DEFAULT_PRESENCE_TTL_MS = 30_000;

const PRESENCE_COLORS = [
  "#2563eb",
  "#0f766e",
  "#b45309",
  "#9d174d",
  "#6d28d9",
  "#0369a1",
  "#4d7c0f",
  "#b91c1c",
] as const;

export interface PresenceParticipant {
  connectionId: string;
  userId: string;
  displayName: string;
  color: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface AddPresenceInput {
  connectionId: string;
  userId: string;
  displayName: string;
  color?: string;
}

export interface PresenceRegistryOptions {
  ttlMs?: number;
  now?: () => number;
}

export interface PresenceRegistry {
  add(input: AddPresenceInput): PresenceParticipant;
  touch(connectionId: string): PresenceParticipant | null;
  remove(connectionId: string): void;
  list(): PresenceParticipant[];
  size(): number;
}

export function createAwareness(document: Y.Doc): Awareness {
  return new Awareness(document);
}

export function presenceColor(seed: string): string {
  let hash = 0;

  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length] ?? PRESENCE_COLORS[0];
}

export function createPresenceRegistry(
  options: PresenceRegistryOptions = {}
): PresenceRegistry {
  const ttlMs = options.ttlMs ?? DEFAULT_PRESENCE_TTL_MS;
  const now = options.now ?? Date.now;
  const participants = new Map<string, PresenceParticipant>();

  function prune(): void {
    const cutoff = now() - ttlMs;

    for (const [connectionId, participant] of participants) {
      if (Date.parse(participant.lastSeenAt) <= cutoff) {
        participants.delete(connectionId);
      }
    }
  }

  return {
    add(input) {
      const timestamp = new Date(now()).toISOString();
      const existing = participants.get(input.connectionId);
      const participant: PresenceParticipant = {
        connectionId: input.connectionId,
        userId: input.userId,
        displayName: input.displayName,
        color: input.color ?? presenceColor(input.userId),
        joinedAt: existing?.joinedAt ?? timestamp,
        lastSeenAt: timestamp,
      };

      participants.set(input.connectionId, participant);

      return { ...participant };
    },
    touch(connectionId) {
      const existing = participants.get(connectionId);

      if (existing === undefined) {
        return null;
      }

      const next = {
        ...existing,
        lastSeenAt: new Date(now()).toISOString(),
      };

      participants.set(connectionId, next);

      return { ...next };
    },
    remove(connectionId) {
      participants.delete(connectionId);
    },
    list() {
      prune();

      return Array.from(participants.values(), (participant) => ({
        ...participant,
      }));
    },
    size() {
      prune();

      return participants.size;
    },
  };
}
