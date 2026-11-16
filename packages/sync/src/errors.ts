export type SyncErrorCode =
  | "outbox_full"
  | "tombstoned_entity"
  | "invalid_sync_state"
  | "unsupported_resolution"
  | "remote_target_present";

export interface SyncErrorOptions {
  cause?: unknown;
}

export class SyncError extends Error {
  readonly code: SyncErrorCode;

  constructor(message: string, code: SyncErrorCode, options?: SyncErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}
