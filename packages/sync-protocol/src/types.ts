import type { z } from "zod";

import type {
  pullRequestSchema,
  pullResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
  syncAppliedOperationSchema,
  syncConflictSchema,
  syncCursorSchema,
  syncRejectionCodeSchema,
  syncOperationSchema,
} from "./schemas";

export type SyncCursor = z.output<typeof syncCursorSchema>;
export type SyncEntityType = z.output<typeof syncOperationSchema>["entityType"];
export type SyncOperationType = z.output<typeof syncOperationSchema>["operation"];
export type SyncOperation = z.output<typeof syncOperationSchema>;
export type PushRequest = z.output<typeof pushRequestSchema>;
export type PullRequest = z.output<typeof pullRequestSchema>;
export type AppliedOperation = z.output<typeof syncAppliedOperationSchema>;
export type SyncConflict = z.output<typeof syncConflictSchema>;
export type SyncRejectionCode = z.output<typeof syncRejectionCodeSchema>;
export type PushResponse = z.output<typeof pushResponseSchema>;
export type PullResponse = z.output<typeof pullResponseSchema>;
