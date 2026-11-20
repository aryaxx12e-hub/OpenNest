import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import type { CollaborationStore, NoteId } from "@opennest/core";
import { WebSocket, WebSocketServer } from "ws";

import type { AuthDatabase } from "../auth/auth-db";
import {
  authenticateCollaborationHandshake,
  CollaborationAuthError,
  type CollaborationIdentity,
} from "./auth";
import {
  CollaborationRoom,
  MAX_COLLABORATION_UPDATE_BYTES,
  type CollaborationConnection,
} from "./room";

export const COLLABORATION_PATH = "/api/collaboration";
const SOCKET_MAX_PAYLOAD = MAX_COLLABORATION_UPDATE_BYTES + 64 * 1024;
const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface CollaborationServerOptions {
  server: Server;
  auth: AuthDatabase;
  store: CollaborationStore;
  publicUrl: string;
  now?: () => Date;
  snapshotIntervalMs?: number;
}

export interface CollaborationServer {
  close(): Promise<void>;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: message });
  const statusText =
    status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Not Found";

  socket.write(
    `HTTP/1.1 ${status} ${statusText}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body
  );
  socket.destroy();
}

export function attachCollaborationServer(
  options: CollaborationServerOptions
): CollaborationServer {
  const rooms = new Map<string, CollaborationRoom>();
  const opening = new Map<string, Promise<CollaborationRoom>>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: SOCKET_MAX_PAYLOAD,
  });

  async function openRoom(noteId: string): Promise<CollaborationRoom> {
    const existing = rooms.get(noteId);

    if (existing !== undefined) {
      return existing;
    }

    const pending = opening.get(noteId);

    if (pending !== undefined) {
      return pending;
    }

    const promise = (async () => {
      const snapshot = await options.store.loadSnapshot(noteId as NoteId);

      if (snapshot === null) {
        throw new Error("The note is not available.");
      }

      const room = new CollaborationRoom({
        workspaceId: snapshot.workspaceId,
        noteId,
        store: options.store,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.snapshotIntervalMs === undefined
          ? {}
          : { snapshotIntervalMs: options.snapshotIntervalMs }),
        onEmpty: () => {
          if (rooms.get(noteId) === room) {
            rooms.delete(noteId);
          }
        },
      });
      await room.open();
      rooms.set(noteId, room);

      return room;
    })().finally(() => opening.delete(noteId));

    opening.set(noteId, promise);

    return promise;
  }

  function joinRoom(
    socket: WebSocket,
    room: CollaborationRoom,
    identity: CollaborationIdentity
  ): void {
    const connectionId = randomUUID();
    const connection: CollaborationConnection = {
      id: connectionId,
      send(message) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(message);
        }
      },
      close(code, reason) {
        socket.close(code, reason);
      },
    };

    void (async () => {
      try {
        const joined = await room.join({
          userId: identity.userId,
          displayName: identity.displayName,
          role: identity.role,
          connection,
        });

        socket.send(joined.state);
        socket.send(
          JSON.stringify({
            type: "ready",
            role: joined.role,
            readOnly: joined.readOnly,
          })
        );
      } catch {
        socket.close(1011, "The collaboration room is unavailable.");
        return;
      }

      socket.on("message", (data, isBinary) => {
        if (isBinary) {
          const update = new Uint8Array(data as Buffer);
          void room.applyUpdate(connectionId, update).then((result) => {
            if (!result.accepted && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "error", code: result.reason }));
            }
          });
          return;
        }

        try {
          const message = JSON.parse(data.toString()) as { type?: unknown };

          if (message.type === "presence") {
            room.touchPresence(connectionId);
          }
        } catch {
          // Ignore malformed awareness messages.
        }
      });

      socket.on("close", () => {
        void room.leave(connectionId).catch(() => undefined);
      });

      socket.on("error", () => {
        socket.close();
      });
    })();
  }

  async function handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname !== COLLABORATION_PATH) {
      rejectUpgrade(socket, 404, "The collaboration endpoint does not exist.");
      return;
    }

    let identity: CollaborationIdentity;

    try {
      identity = authenticateCollaborationHandshake(request, {
        auth: options.auth,
        publicUrl: options.publicUrl,
        ...(options.now === undefined ? {} : { now: options.now }),
      });
    } catch (error) {
      const status = error instanceof CollaborationAuthError ? error.status : 401;
      rejectUpgrade(socket, status, "The collaboration handshake was rejected.");
      return;
    }

    const noteId = url.searchParams.get("noteId");

    if (noteId === null || !NOTE_ID_PATTERN.test(noteId)) {
      rejectUpgrade(socket, 404, "The note is not available.");
      return;
    }

    let room: CollaborationRoom;

    try {
      room = await openRoom(noteId);
    } catch {
      rejectUpgrade(socket, 404, "The note is not available.");
      return;
    }

    wss.handleUpgrade(request, socket, head, (websocket) => {
      joinRoom(websocket, room, identity);
    });
  }

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    void handleUpgrade(request, socket, head).catch(() => {
      if (socket.writable) {
        rejectUpgrade(socket, 404, "The note is not available.");
      }
    });
  };

  options.server.on("upgrade", onUpgrade);

  return {
    async close() {
      options.server.off("upgrade", onUpgrade);

      for (const [noteId, room] of rooms) {
        try {
          await room.destroy();
        } catch {
          // Shutdown still closes the transport and releases the room.
        }

        rooms.delete(noteId);
      }

      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
