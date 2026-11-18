import { AiError } from "./errors";
import type { AiProviderKind } from "./types";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateEndpoint(value: string, kind: AiProviderKind): string {
  if (kind === "mcp") {
    throw new AiError(
      "unsupported_provider_kind",
      "MCP providers are not supported in this release."
    );
  }

  if (kind !== "local" && kind !== "remote" && kind !== "custom") {
    throw new AiError("unsupported_provider_kind", "The provider kind is not supported.");
  }

  if (typeof value !== "string" || value.length === 0) {
    throw invalidEndpoint();
  }

  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1];

  if (authority === undefined || authority.length === 0) {
    throw invalidEndpoint();
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw invalidEndpoint();
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.hostname.length === 0 ||
    url.hostname.includes("*")
  ) {
    throw invalidEndpoint();
  }

  if (kind === "local" && !isLoopbackHost(url.hostname)) {
    throw invalidEndpoint();
  }

  if (kind !== "local" && url.protocol !== "https:") {
    throw invalidEndpoint();
  }

  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");

  return `${url.origin}${pathname}`;
}

export function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    throw invalidEndpoint();
  }
}

export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    return isLoopbackHost(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function invalidEndpoint(): AiError {
  return new AiError("invalid_endpoint", "The AI provider endpoint is not allowed.");
}
