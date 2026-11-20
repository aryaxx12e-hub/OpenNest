export type AuthErrorCode =
  | "auth_storage"
  | "validation"
  | "forbidden"
  | "not_found"
  | "last_owner"
  | "already_bootstrapped"
  | "user_exists"
  | "invite_invalid"
  | "invite_expired"
  | "invite_used";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthError";
    this.code = code;
  }
}
