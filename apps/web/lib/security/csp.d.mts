export const AI_CONNECT_SOURCES: string;

export interface ContentSecurityPolicyOptions {
  readonly development?: boolean;
}

export function buildContentSecurityPolicy(
  options?: ContentSecurityPolicyOptions
): string;
