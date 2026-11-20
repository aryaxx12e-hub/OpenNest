import path from "node:path";

export interface ServerConfig {
  dataDir: string;
  host: string;
  port: number;
  publicUrl: string;
  workspaceDatabasePath: string;
  authDatabasePath: string;
  blobRoot: string;
  mcpEnabled: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);

function requiredDirectory(value: string | undefined): string {
  const trimmed = value?.trim();

  if (!trimmed || trimmed.includes("\0")) {
    throw new ConfigError("OPENNEST_DATA_DIR is required.");
  }

  return path.resolve(trimmed);
}

function parseHost(value: string | undefined): string {
  const raw = value?.trim();

  if (raw === undefined) {
    return DEFAULT_HOST;
  }

  if (
    raw.length === 0 ||
    raw.includes("\0") ||
    raw.includes("://") ||
    raw.includes("/") ||
    raw.includes("\\") ||
    raw.includes("?") ||
    raw.includes("#") ||
    raw.includes("@") ||
    /\s/.test(raw)
  ) {
    throw new ConfigError("OPENNEST_HOST must be a host name or IP address.");
  }

  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1);
  }

  return raw;
}

function parseBooleanFlag(name: string, value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new ConfigError(`${name} must be "true" or "false".`);
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const raw = value.trim();

  if (!/^\d+$/.test(raw)) {
    throw new ConfigError("OPENNEST_PORT must be an integer between 1 and 65535.");
  }

  const port = Number(raw);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("OPENNEST_PORT must be an integer between 1 and 65535.");
  }

  return port;
}

function defaultPublicUrl(host: string, port: number): string {
  if (WILDCARD_HOSTS.has(host)) {
    throw new ConfigError(
      "OPENNEST_PUBLIC_URL is required when OPENNEST_HOST is a wildcard address."
    );
  }

  const urlHost = host.includes(":") ? `[${host}]` : host;

  return `http://${urlHost}:${port}`;
}

function parsePublicUrl(value: string | undefined, host: string, port: number): string {
  const raw = value?.trim();

  if (raw === undefined) {
    return defaultPublicUrl(host, port);
  }

  if (raw.length === 0) {
    throw new ConfigError("OPENNEST_PUBLIC_URL must be an HTTP or HTTPS URL.");
  }

  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError("OPENNEST_PUBLIC_URL must be an HTTP or HTTPS URL.");
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new ConfigError(
      "OPENNEST_PUBLIC_URL must be an origin URL without credentials, path, query, or fragment."
    );
  }

  return parsed.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const dataDir = requiredDirectory(env.OPENNEST_DATA_DIR);
  const host = parseHost(env.OPENNEST_HOST);
  const port = parsePort(env.OPENNEST_PORT);
  const publicUrl = parsePublicUrl(env.OPENNEST_PUBLIC_URL, host, port);
  const mcpEnabled = parseBooleanFlag("OPENNEST_MCP_ENABLED", env.OPENNEST_MCP_ENABLED);

  return {
    dataDir,
    host,
    port,
    publicUrl,
    workspaceDatabasePath: path.join(dataDir, "workspace.sqlite"),
    authDatabasePath: path.join(dataDir, "auth.sqlite"),
    blobRoot: path.join(dataDir, "blobs"),
    mcpEnabled,
  };
}
