import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const tsxPackage = require("tsx/package.json");
const tsxBin = path.resolve(
  path.dirname(require.resolve("tsx/package.json")),
  tsxPackage.bin
);

const child = spawn(process.execPath, [tsxBin, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
let forwarding = false;

for (const signal of signals) {
  process.on(signal, () => {
    if (forwarding) {
      return;
    }

    forwarding = true;
    child.kill(signal);
  });
}

child.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal !== null) {
    for (const name of signals) {
      process.removeAllListeners(name);
    }

    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
