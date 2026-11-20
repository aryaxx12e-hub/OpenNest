import path from "node:path";
import { pathToFileURL } from "node:url";

import { createAuditLog } from "../audit/audit-log";
import { loadConfig } from "../config";
import { openAuthDatabase } from "../auth/auth-db";
import { AuthError } from "../auth/errors";
import { bootstrapOwner } from "../auth/membership";

export interface TextSink {
  write(chunk: string): unknown;
}

export interface BootstrapIO {
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  stdin: NodeJS.ReadableStream;
  stdout: TextSink;
  stderr: TextSink;
}

const USAGE = "Usage: bootstrap-owner --email <email>\n";

function parseEmail(args: readonly string[]): string | null {
  let email: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument !== "--email" || email !== null) {
      return null;
    }

    const value = args[index + 1];

    if (value === undefined || value.startsWith("-")) {
      return null;
    }

    email = value;
    index += 1;
  }

  return email;
}

async function readPassword(stdin: NodeJS.ReadableStream): Promise<string> {
  let buffered = "";

  for await (const chunk of stdin) {
    buffered += String(chunk);

    const newline = buffered.indexOf("\n");

    if (newline >= 0) {
      return buffered.slice(0, newline).replace(/\r$/, "");
    }
  }

  return buffered;
}

export async function runBootstrapOwner(io: BootstrapIO): Promise<number> {
  const email = parseEmail(io.args);

  if (email === null) {
    io.stderr.write(USAGE);
    return 1;
  }

  const password = await readPassword(io.stdin);

  if (password.length === 0) {
    io.stderr.write("Bootstrap failed: the password is required.\n");
    return 1;
  }

  let database: ReturnType<typeof openAuthDatabase> | null = null;

  try {
    const config = loadConfig(io.env);
    database = openAuthDatabase({ databaseFile: config.authDatabasePath });
    const owner = await bootstrapOwner(
      database,
      { email, password },
      new Date(),
      createAuditLog(database)
    );

    io.stdout.write(`Created owner: ${owner.user.email}\n`);
    return 0;
  } catch (error) {
    if (error instanceof AuthError) {
      io.stderr.write(`Bootstrap failed: ${error.message}\n`);
    } else {
      io.stderr.write("Bootstrap failed: the owner could not be created.\n");
    }

    return 1;
  } finally {
    database?.close();
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];

  return (
    entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href
  );
}

if (isMainModule()) {
  void runBootstrapOwner({
    args: process.argv.slice(2),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }).then((code) => {
    process.exitCode = code;
  });
}
