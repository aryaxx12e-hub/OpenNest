import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 8788;

      server.close(() => resolve(port));
    });
  });
}

export async function makeTempDir(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function removeDir(directory) {
  await rm(directory, { recursive: true, force: true });
}

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

export async function seedWorkspace(dataDir, spec) {
  const result = await runProcess(
    process.execPath,
    ["scripts/tsx.mjs", "scripts/e2e-seed.ts", JSON.stringify(spec)],
    {
      env: { ...process.env, OPENNEST_DATA_DIR: dataDir },
    }
  );

  assert.equal(
    result.code,
    0,
    `Seed failed with code ${result.code}.\n${result.stderr}\n${result.stdout}`
  );

  const line = result.stdout
    .trim()
    .split("\n")
    .filter((candidate) => candidate.startsWith("{"))
    .at(-1);

  assert.ok(line, `Seed produced no JSON.\n${result.stderr}\n${result.stdout}`);

  return JSON.parse(line);
}

export async function bootstrapOwner(dataDir, email, password) {
  const result = await runProcess(
    process.execPath,
    ["scripts/tsx.mjs", "apps/server/src/cli/bootstrap-owner.ts", "--email", email],
    {
      env: { ...process.env, OPENNEST_DATA_DIR: dataDir },
      input: `${password}\n`,
    }
  );

  assert.equal(
    result.code,
    0,
    `Bootstrap failed with code ${result.code}.\n${result.stderr}\n${result.stdout}`
  );
}

export async function startServer(options) {
  const port = options.port ?? (await freePort());
  const base = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, ["scripts/tsx.mjs", "apps/server/src/index.ts"], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      OPENNEST_DATA_DIR: options.dataDir,
      OPENNEST_HOST: "127.0.0.1",
      OPENNEST_PORT: String(port),
      OPENNEST_PUBLIC_URL: base,
      OPENNEST_MCP_ENABLED: options.mcpEnabled === true ? "true" : "false",
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const logs = () => output.join("");

  try {
    await waitForServer(`${base}/health/ready`, child, logs);
  } catch (error) {
    await stopChild(child);
    throw error;
  }

  return {
    base,
    port,
    logs,
    async stop() {
      await stopChild(child);
    },
  };
}

async function waitForServer(url, child, logs) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before readiness.\n${logs()}`);
    }

    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {}

    await delay(250);
  }

  throw new Error(`Server did not become ready at ${url}.\n${logs()}`);
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 5000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  });
}

export function cookieHeader(response) {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .join("; ");
}

export function cookieValue(cookie, name) {
  const match = new RegExp(`(?:^|; )${name}=([^;]+)`).exec(cookie);

  return match?.[1] === undefined ? "" : decodeURIComponent(match[1]);
}

export function sessionHeaders(session) {
  return {
    "content-type": "application/json",
    cookie: session.cookie,
    "x-csrf-token": session.csrfToken,
  };
}

export function readHeaders(session) {
  return { cookie: session.cookie };
}

export async function expectStatus(response, expected, label) {
  const body = await response.clone().text();

  assert.equal(
    response.status,
    expected,
    `${label}: expected ${expected}, received ${response.status}.\n${body}`
  );
}

export async function login(base, email, password) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  await expectStatus(response, 200, "login");

  const body = await response.json();

  return {
    cookie: cookieHeader(response),
    csrfToken: body.csrfToken,
    user: body.user,
  };
}

export async function invite(base, owner, email, role, password) {
  const invited = await fetch(`${base}/auth/invites`, {
    method: "POST",
    headers: sessionHeaders(owner),
    body: JSON.stringify({ email, role }),
  });

  await expectStatus(invited, 201, "create invite");

  const body = await invited.json();
  const accepted = await fetch(`${base}/auth/invites/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: body.token, password }),
  });

  await expectStatus(accepted, 201, "accept invite");

  return {
    cookie: cookieHeader(accepted),
    csrfToken: cookieValue(cookieHeader(accepted), "opennest_csrf") || "",
    user: (await accepted.json()).user,
  };
}

export function unique(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitFor(predicate, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await delay(50);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}
