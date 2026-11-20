import {
  MAX_SYNC_PAYLOAD_BYTES,
  pullRequestSchema,
  pushRequestSchema,
} from "@opennest/sync-protocol";

import type { AuthDatabase } from "../auth/auth-db";
import { HttpError } from "../errors";
import { readJsonBody, sendJson, type Router } from "../http/router";
import { SyncServiceError, type SyncService } from "../sync/sync-service";
import { requireCsrf, requireSession } from "./auth";

const MAX_SYNC_BODY_BYTES = MAX_SYNC_PAYLOAD_BYTES + 64 * 1024;

export interface SyncRouteDependencies {
  auth: AuthDatabase;
  sync: SyncService;
  now?: () => Date;
}

function mapSyncError(error: unknown): unknown {
  if (error instanceof SyncServiceError) {
    return new HttpError(error.status, error.code, error.message);
  }

  return error;
}

export function registerSyncRoutes(
  router: Router,
  dependencies: SyncRouteDependencies
): void {
  const now = dependencies.now ?? (() => new Date());

  router.post("/api/sync/push", async (request, response) => {
    try {
      const session = requireSession(request, dependencies.auth, now());
      requireCsrf(request, session.session);
      const body = await readJsonBody(request, { maxBytes: MAX_SYNC_BODY_BYTES });
      const parsed = pushRequestSchema.safeParse(body);

      if (!parsed.success) {
        throw new HttpError(400, "invalid_operation", "The sync request is not valid.");
      }

      const result = await dependencies.sync.push(parsed.data, {
        userId: session.user.id,
        role: session.membership.role,
      });

      sendJson(response, 200, result);
    } catch (error) {
      throw mapSyncError(error);
    }
  });

  router.post("/api/sync/pull", async (request, response) => {
    try {
      const session = requireSession(request, dependencies.auth, now());
      const body = await readJsonBody(request);
      const parsed = pullRequestSchema.safeParse(body);

      if (!parsed.success) {
        throw new HttpError(400, "invalid_operation", "The sync request is not valid.");
      }

      const result = await dependencies.sync.pull(parsed.data, {
        userId: session.user.id,
        role: session.membership.role,
      });

      sendJson(response, 200, result);
    } catch (error) {
      throw mapSyncError(error);
    }
  });
}
