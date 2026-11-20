import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  process.execPath,
  ["scripts/tsx.mjs", "scripts/e2e-ai-qa-runner.ts"],
  {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
  }
);

child.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.once("exit", (code) => {
  process.exit(code ?? 1);
});
