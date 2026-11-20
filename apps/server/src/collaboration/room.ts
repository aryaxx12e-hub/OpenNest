import type {
  CollaborationSnapshotMetadata,
  CollaborationSnapshotState,
  CollaborationStore,
  IsoDate,
  NoteId,
  WorkspaceId,
} from "@opennest/core";
import {
  applyDocumentUpdate,
  createCollaborationDocument,
  createPresenceRegistry,
  encodeDocumentState,
  readDocumentText,
  type PresenceParticipant,
} from "@opennest/collaboration";
import type * as Y from "yjs";

import type { Role } from "../auth/membership";

export const MAX_COLLABORATION_UPDATE_BYTES = 256 * 1024;
export const MAX_COLLABORATION_UPDATES_PER_MINUTE = 200;
export const DEFAULT_SNAPSHOT_INTERVAL_MS = 2_000;

export interface CollaborationConnection {
  readonly id: string;
  send(message: Uint8Array | string): void;
  close(code?: number, reason?: string): void;
}

export interface CollaborationMember {
  userId: string;
  displayName: string;
  role: Role;
  connection: CollaborationConnection;
}

export interface CollaborationJoinResult {
  role: Role;
  readOnly: boolean;
  state: Uint8Array;
  participants: PresenceParticipant[];
}

export type CollaborationUpdateRejection =
  "forbidden" | "too_large" | "rate_limited" | "invalid_update" | "not_joined";

export type CollaborationUpdateResult =
  { accepted: true } | { accepted: false; reason: CollaborationUpdateRejection };

export type CollaborationRoomErrorCode =
  "not_found" | "not_open" | "already_joined" | "closed";

export class CollaborationRoomError extends Error {
  readonly code: CollaborationRoomErrorCode;

  constructor(code: CollaborationRoomErrorCode, message: string) {
    super(message);
    this.name = "CollaborationRoomError";
    this.code = code;
  }
}

export interface CollaborationRoomOptions {
  workspaceId: string;
  noteId: string;
  store: CollaborationStore;
  now?: () => Date;
  snapshotIntervalMs?: number;
  maxUpdateBytes?: number;
  maxUpdatesPerMinute?: number;
  onEmpty?: () => void;
}

interface Participant {
  member: CollaborationMember;
  joinedAt: number;
}

export class CollaborationRoom {
  private readonly workspaceId: string;
  private readonly noteId: string;
  private readonly store: CollaborationStore;
  private readonly now: () => Date;
  private readonly snapshotIntervalMs: number;
  private readonly maxUpdateBytes: number;
  private readonly maxUpdatesPerMinute: number;
  private readonly onEmpty: (() => void) | undefined;
  private readonly members = new Map<string, Participant>();
  private readonly updateWindows = new Map<string, number[]>();
  private readonly presence = createPresenceRegistry({
    ttlMs: 30_000,
    now: () => this.now().getTime(),
  });

  private document: Y.Doc | null = null;
  private opened = false;
  private closed = false;
  private dirty = false;
  private dirtyRevision = 0;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotQueue: Promise<void> = Promise.resolve();

  constructor(options: CollaborationRoomOptions) {
    this.workspaceId = options.workspaceId;
    this.noteId = options.noteId;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
    this.maxUpdateBytes = options.maxUpdateBytes ?? MAX_COLLABORATION_UPDATE_BYTES;
    this.maxUpdatesPerMinute =
      options.maxUpdatesPerMinute ?? MAX_COLLABORATION_UPDATES_PER_MINUTE;
    this.onEmpty = options.onEmpty;
  }

  async open(): Promise<void> {
    if (this.opened) {
      return;
    }

    if (this.closed) {
      throw new CollaborationRoomError("closed", "The room is closed.");
    }

    const snapshot = await this.store.loadSnapshot(this.noteId as NoteId);

    if (snapshot === null || snapshot.workspaceId !== this.workspaceId) {
      throw new CollaborationRoomError("not_found", "The note is not available.");
    }

    this.document = createCollaborationDocument(snapshot.content);
    this.opened = true;
  }

  async join(member: CollaborationMember): Promise<CollaborationJoinResult> {
    if (this.closed) {
      throw new CollaborationRoomError("closed", "The room is closed.");
    }

    if (!this.opened || this.document === null) {
      throw new CollaborationRoomError("not_open", "The room is not open.");
    }

    if (this.members.has(member.connection.id)) {
      throw new CollaborationRoomError(
        "already_joined",
        "The connection already joined the room."
      );
    }

    this.members.set(member.connection.id, {
      member,
      joinedAt: this.now().getTime(),
    });
    this.presence.add({
      connectionId: member.connection.id,
      userId: member.userId,
      displayName: member.displayName,
    });
    this.startSnapshotTimer();
    this.broadcastPresence();

    return {
      role: member.role,
      readOnly: member.role === "viewer",
      state: encodeDocumentState(this.document),
      participants: this.participants(),
    };
  }

  async applyUpdate(
    connectionId: string,
    update: Uint8Array
  ): Promise<CollaborationUpdateResult> {
    if (!this.opened || this.document === null) {
      throw new CollaborationRoomError("not_open", "The room is not open.");
    }

    const participant = this.members.get(connectionId);

    if (participant === undefined) {
      return { accepted: false, reason: "not_joined" };
    }

    if (participant.member.role === "viewer") {
      return { accepted: false, reason: "forbidden" };
    }

    if (update.byteLength > this.maxUpdateBytes) {
      return { accepted: false, reason: "too_large" };
    }

    if (!this.takeUpdateToken(connectionId)) {
      return { accepted: false, reason: "rate_limited" };
    }

    try {
      applyDocumentUpdate(this.document, update);
    } catch {
      return { accepted: false, reason: "invalid_update" };
    }

    this.markDirty();
    this.broadcastUpdate(connectionId, update);

    return { accepted: true };
  }

  touchPresence(connectionId: string): PresenceParticipant | null {
    const participant = this.presence.touch(connectionId);

    if (participant !== null) {
      this.broadcastPresence();
    }

    return participant;
  }

  participants(): PresenceParticipant[] {
    return this.presence.list();
  }

  isDirty(): boolean {
    return this.dirty;
  }

  async snapshot(): Promise<boolean> {
    if (!this.dirty || this.document === null) {
      return false;
    }

    const revision = this.dirtyRevision;
    const updatedAt = this.now().toISOString() as IsoDate;
    const state: CollaborationSnapshotState = {
      content: readDocumentText(this.document),
      updatedAt,
    };
    const metadata: CollaborationSnapshotMetadata = {
      workspaceId: this.workspaceId as WorkspaceId,
      at: updatedAt,
    };

    const write = async (): Promise<void> => {
      await this.store.writeSnapshot(this.noteId as NoteId, state, metadata);

      if (this.dirtyRevision === revision) {
        this.dirty = false;
      }
    };

    const queued = this.snapshotQueue.then(write, write);
    this.snapshotQueue = queued.then(
      () => undefined,
      () => undefined
    );
    await queued;

    return true;
  }

  async leave(connectionId: string): Promise<void> {
    if (this.members.delete(connectionId)) {
      this.updateWindows.delete(connectionId);
      this.presence.remove(connectionId);
    }

    if (this.members.size === 0) {
      this.stopSnapshotTimer();

      if (this.dirty) {
        await this.snapshot();
      }

      this.onEmpty?.();
      return;
    }

    this.broadcastPresence();
  }

  async destroy(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.stopSnapshotTimer();

    try {
      if (this.dirty) {
        await this.snapshot();
      }
    } finally {
      for (const participant of this.members.values()) {
        participant.member.connection.close(1001, "The room is closing.");
        this.presence.remove(participant.member.connection.id);
      }

      this.members.clear();
      this.updateWindows.clear();
      this.document?.destroy();
      this.document = null;
    }
  }

  private startSnapshotTimer(): void {
    if (this.snapshotTimer !== null || this.snapshotIntervalMs <= 0) {
      return;
    }

    this.snapshotTimer = setInterval(() => {
      if (!this.dirty) {
        return;
      }

      void this.snapshot().catch(() => undefined);
    }, this.snapshotIntervalMs);
    this.snapshotTimer.unref?.();
  }

  private stopSnapshotTimer(): void {
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  private takeUpdateToken(connectionId: string): boolean {
    const now = this.now().getTime();
    const cutoff = now - 60_000;
    const recent = (this.updateWindows.get(connectionId) ?? []).filter(
      (timestamp) => timestamp > cutoff
    );

    if (recent.length >= this.maxUpdatesPerMinute) {
      this.updateWindows.set(connectionId, recent);
      return false;
    }

    recent.push(now);
    this.updateWindows.set(connectionId, recent);

    return true;
  }

  private markDirty(): void {
    this.dirty = true;
    this.dirtyRevision += 1;
  }

  private broadcastUpdate(senderId: string, update: Uint8Array): void {
    for (const [connectionId, participant] of this.members) {
      if (connectionId === senderId) {
        continue;
      }

      try {
        participant.member.connection.send(update);
      } catch {
        // A failed socket is removed when its transport reports a close event.
      }
    }
  }

  private broadcastPresence(): void {
    const message = JSON.stringify({
      type: "presence",
      participants: this.participants(),
    });

    for (const participant of this.members.values()) {
      try {
        participant.member.connection.send(message);
      } catch {
        // A failed socket is removed when its transport reports a close event.
      }
    }
  }
}
