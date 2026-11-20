import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tscBin = require.resolve("typescript/bin/tsc");

const result = spawnSync(
  process.execPath,
  [tscBin, "--project", path.join(rootDir, "apps/server/tsconfig.json"), "--noEmit"],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
