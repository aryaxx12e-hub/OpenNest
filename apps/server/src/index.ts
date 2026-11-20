import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createSqliteStorage } from "@opennest/storage-sqlite";

import { openAuthDatabase } from "./auth/auth-db";
import { getMembership } from "./auth/membership";
import { loadConfig, type ServerConfig } from "./config";
import { isDatabaseReady } from "./health";
import { createLifecycle } from "./lifecycle";
import { createRouter, sendJson } from "./http/router";
import { attachCollaborationServer } from "./collaboration/server";
import { createFileService } from "./files/file-service";
import { openFileStore } from "./files/file-store";
import { registerAuthRoutes } from "./routes/auth";
import { registerBootstrapRoutes } from "./routes/bootstrap";
import { registerFileRoutes } from "./routes/files";
import { registerMembershipRoutes } from "./routes/membership";
import { registerMcpTokenRoutes } from "./routes/mcp-tokens";
import { registerSyncRoutes } from "./routes/sync";
import { openMcpAuth } from "./mcp/auth";
import { registerMcpRoute } from "./mcp/server";
import { createMcpTools } from "./mcp/tools";
import { createSyncService } from "./sync/sync-service";
import { openSyncStore } from "./sync/sync-store";

export type { ServerConfig };
export { ConfigError, loadConfig } from "./config";
export { createLifecycle, type CloseableResource } from "./lifecycle";

export interface StartServerOptions {
  readiness?: () => Promise<boolean>;
}

export interface RunningServer {
  server: Server;
  config: ServerConfig;
  port: number;
  url: string;
  close(): Promise<void>;
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    server.closeIdleConnections();
  });
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function ensureDataDirectory(dataDir: string): Promise<void> {
  try {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new Error("Unable to prepare the OpenNest data directory.", {
      cause: error,
    });
  }
}

export async function startServer(
  config: ServerConfig,
  options: StartServerOptions = {}
): Promise<RunningServer> {
  await ensureDataDirectory(config.dataDir);

  const workspace = createSqliteStorage({
    databaseFile: config.workspaceDatabasePath,
    blobRoot: config.blobRoot,
  });

  try {
    await workspace.init();
  } catch (error) {
    await workspace.close();
    throw new Error("Unable to open the workspace database.", { cause: error });
  }

  let auth: ReturnType<typeof openAuthDatabase>;

  try {
    auth = openAuthDatabase({ databaseFile: config.authDatabasePath });
  } catch (error) {
    await workspace.close();
    throw new Error("Unable to open the auth database.", { cause: error });
  }

  let syncStore: ReturnType<typeof openSyncStore>;

  try {
    syncStore = openSyncStore({
      databaseFile: config.workspaceDatabasePath,
    });
  } catch (error) {
    auth.close();
    await workspace.close();
    throw new Error("Unable to open the sync authority database.", {
      cause: error,
    });
  }

  const sync = createSyncService({ store: syncStore });
  let fileStore: ReturnType<typeof openFileStore>;

  try {
    fileStore = openFileStore({
      databaseFile: config.workspaceDatabasePath,
    });
  } catch (error) {
    syncStore.close();
    auth.close();
    await workspace.close();
    throw new Error("Unable to open the file version database.", {
      cause: error,
    });
  }

  let files: Awaited<ReturnType<typeof createFileService>>;

  try {
    files = await createFileService({
      store: fileStore,
      blobRoot: config.blobRoot,
    });
  } catch (error) {
    fileStore.close();
    syncStore.close();
    auth.close();
    await workspace.close();
    throw new Error("Unable to open the file service.", { cause: error });
  }

  let mcpAuth: ReturnType<typeof openMcpAuth> | null = null;
  let mcpTools: ReturnType<typeof createMcpTools> | null = null;

  if (config.mcpEnabled) {
    try {
      mcpAuth = openMcpAuth(auth);
      mcpTools = createMcpTools({ storage: workspace });
    } catch (error) {
      fileStore.close();
      syncStore.close();
      auth.close();
      await workspace.close();
      throw new Error("Unable to open the MCP token database.", {
        cause: error,
      });
    }
  }

  const router = createRouter();
  const currentWorkspaceId = async (): Promise<string | null> => {
    const workspaces = await workspace.workspaces.list();
    const only = workspaces.length === 1 ? workspaces[0] : undefined;
    return only === undefined ? null : only.id;
  };

  registerAuthRoutes(router, { auth });
  registerBootstrapRoutes(router, { auth });
  registerMembershipRoutes(router, { auth });
  registerFileRoutes(router, { auth, files });
  registerSyncRoutes(router, { auth, sync });

  if (mcpAuth !== null && mcpTools !== null) {
    registerMcpTokenRoutes(router, {
      auth,
      mcp: mcpAuth,
      workspaceId: currentWorkspaceId,
    });
    registerMcpRoute(router, {
      mcpAuth,
      tools: mcpTools,
      currentWorkspaceId,
      isMember: (userId) => getMembership(auth, userId) !== null,
    });
  }

  const readiness =
    options.readiness ??
    (async () => {
      const workspaceReady = await isDatabaseReady({
        databaseFile: config.workspaceDatabasePath,
        requiredTable: "workspaces",
      });
      const authReady = await isDatabaseReady({
        databaseFile: config.authDatabasePath,
        requiredTable: "users",
      });
      const syncReady = await isDatabaseReady({
        databaseFile: config.workspaceDatabasePath,
        requiredTable: "sync_authority_state",
      });
      const filesReady = await isDatabaseReady({
        databaseFile: config.workspaceDatabasePath,
        requiredTable: "file_versions",
      });
      const mcpReady =
        !config.mcpEnabled ||
        (await isDatabaseReady({
          databaseFile: config.authDatabasePath,
          requiredTable: "mcp_tokens",
        }));

      return workspaceReady && authReady && syncReady && filesReady && mcpReady;
    });

  router.get("/health/live", (_request, response) => {
    sendJson(response, 200, { status: "ok" });
  });

  router.get("/health/ready", async (_request, response) => {
    if (await readiness()) {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    const workspaceReady = await isDatabaseReady({
      databaseFile: config.workspaceDatabasePath,
      requiredTable: "workspaces",
    });
    const authReady = await isDatabaseReady({
      databaseFile: config.authDatabasePath,
      requiredTable: "users",
    });
    const syncReady = await isDatabaseReady({
      databaseFile: config.workspaceDatabasePath,
      requiredTable: "sync_authority_state",
    });
    const filesReady = await isDatabaseReady({
      databaseFile: config.workspaceDatabasePath,
      requiredTable: "file_versions",
    });
    const mcpReady =
      !config.mcpEnabled ||
      (await isDatabaseReady({
        databaseFile: config.authDatabasePath,
        requiredTable: "mcp_tokens",
      }));

    sendJson(response, 503, {
      status: "unavailable",
      checks: {
        workspace: workspaceReady,
        auth: authReady,
        sync: syncReady,
        files: filesReady,
        mcp: mcpReady,
      },
    });
  });

  const server = createServer((request, response) => {
    void router.handle(request, response);
  });

  const collaboration = attachCollaborationServer({
    server,
    auth,
    store: workspace.collaboration,
    publicUrl: config.publicUrl,
  });

  const lifecycle = createLifecycle({
    collaboration,
    http: { close: () => closeHttpServer(server) },
    sync: { close: () => syncStore.close() },
    files: { close: () => fileStore.close() },
    auth: { close: () => auth.close() },
    workspace,
  });

  try {
    await listen(server, config.port, config.host);
  } catch (error) {
    await lifecycle.close();
    throw new Error("Unable to start the OpenNest server.", { cause: error });
  }

  const address = server.address() as AddressInfo | null;

  if (address === null) {
    await lifecycle.close();
    throw new Error("Unable to determine the OpenNest server address.");
  }

  return {
    server,
    config,
    port: address.port,
    url: config.publicUrl,
    close: () => lifecycle.close(),
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1];

  if (!entry) {
    return false;
  }

  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = await startServer(config);
  let closing = false;

  console.log(`OpenNest server listening on ${server.url}`);

  async function shutdown(signal: string): Promise<void> {
    if (closing) {
      return;
    }

    closing = true;
    console.log(`OpenNest server received ${signal}; shutting down.`);

    try {
      await server.close();
      process.exitCode = 0;
    } catch {
      console.error("OpenNest server could not shut down cleanly.");
      process.exitCode = 1;
    }
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "OpenNest server failed.");
    process.exitCode = 1;
  });
}
