import { spawnSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = path.join(ROOT_DIR, "apps", "web");
const OUT_DIR = path.join(WEB_DIR, "out");
const REQUIRED_FILES = [
  "index.html",
  "library.html",
  "files.html",
  "notes.html",
  "extensions.html",
];

const result = spawnSync(
  process.execPath,
  [path.join(ROOT_DIR, "scripts", "next.mjs"), "build", "--webpack"],
  {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: { ...process.env, OPENNEST_STATIC_EXPORT: "1" },
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

await rm(path.join(OUT_DIR, "sw.js"), { force: true });
await rm(path.join(OUT_DIR, "sw.js.map"), { force: true });

for (const file of REQUIRED_FILES) {
  try {
    await access(path.join(OUT_DIR, file));
  } catch {
    console.error(`Static export is missing ${file}`);
    process.exit(1);
  }
}

console.log(`Static export ready in ${OUT_DIR}`);
