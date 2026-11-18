import { AiError, type AiErrorCode } from "@opennest/ai";

export function aiTransportError(
  code: AiErrorCode,
  message: string,
  cause?: unknown
): AiError {
  return new AiError(code, message, cause === undefined ? undefined : { cause });
}
