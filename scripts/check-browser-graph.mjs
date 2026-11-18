import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entries = [
  path.join(rootDir, "packages/storage-dexie/src/index.ts"),
  path.join(rootDir, "packages/crypto/src/index.ts"),
  path.join(rootDir, "packages/credential-vault/src/index.ts"),
  path.join(rootDir, "packages/ai/src/index.ts"),
];

const FORBIDDEN_MODULES = new Set([
  "@opennest/storage-sqlite",
  "node:sqlite",
  "node:fs",
  "node:crypto",
]);

const FORBIDDEN_MANIFEST_DEPENDENCIES = new Set([
  "@opennest/storage-sqlite",
  "better-sqlite3",
  "drizzle-orm",
  "node-sqlite3",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?:[^"'`;]*?\sfrom\s*)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function isRelative(specifier) {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

function packageNameOf(specifier) {
  const parts = specifier.split("/");

  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] ?? specifier);
}

async function existsAsFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];

  for (const candidate of candidates) {
    if (await existsAsFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveWorkspacePackage(fromFile, specifier) {
  const packageName = packageNameOf(specifier);
  const packageDir = path.join(
    rootDir,
    "packages",
    packageName.replace("@opennest/", "")
  );
  const manifestPath = path.join(packageDir, "package.json");

  let manifest;

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return null;
  }

  const exportsField = manifest.exports?.["."] ?? manifest.main ?? "./src/index.ts";
  const target = typeof exportsField === "string" ? exportsField : exportsField?.import;
  const resolved = path.resolve(packageDir, target ?? "./src/index.ts");

  if (await existsAsFile(resolved)) {
    return resolved;
  }

  for (const extension of SOURCE_EXTENSIONS) {
    if (await existsAsFile(resolved + extension)) {
      return resolved + extension;
    }
  }

  const entryPoint = manifest.exports?.["."];
  const subpath = specifier.slice(packageName.length).replace(/^\//, "");

  if (entryPoint && subpath === "" && typeof entryPoint === "object") {
    return null;
  }

  void fromFile;

  return null;
}

function importsOf(source) {
  const found = new Set();

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];

    if (specifier) {
      found.add(specifier);
    }
  }

  return [...found];
}

async function readManifestDependencies(packageDir) {
  const manifestPath = path.join(rootDir, packageDir, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  return Object.keys(manifest.dependencies ?? {});
}

async function main() {
  const violations = [];
  const visited = new Set();
  const queue = [...entries];

  for (const packageDir of [
    "packages/storage-dexie",
    "packages/crypto",
    "packages/credential-vault",
    "packages/ai",
  ]) {
    for (const dependency of await readManifestDependencies(packageDir)) {
      if (
        FORBIDDEN_MANIFEST_DEPENDENCIES.has(packageNameOf(dependency)) ||
        dependency.startsWith("node:")
      ) {
        violations.push(
          `${packageDir}/package.json depends on ${dependency}, which cannot ship to the browser.`
        );
      }
    }
  }

  while (queue.length > 0) {
    const file = queue.pop();

    if (!file || visited.has(file)) {
      continue;
    }

    visited.add(file);

    if (!(await existsAsFile(file))) {
      violations.push(`${path.relative(rootDir, file)} is imported but does not exist.`);
      continue;
    }

    const source = await readFile(file, "utf8");

    for (const specifier of importsOf(source)) {
      const packageName = packageNameOf(specifier);

      if (FORBIDDEN_MODULES.has(specifier) || FORBIDDEN_MODULES.has(packageName)) {
        violations.push(
          `${path.relative(rootDir, file)} imports ${specifier}, which is not allowed in the browser graph.`
        );
        continue;
      }

      if (specifier.startsWith("node:")) {
        violations.push(
          `${path.relative(rootDir, file)} imports ${specifier}; no node:* module may reach the browser.`
        );
        continue;
      }

      if (isRelative(specifier)) {
        const resolved = await resolveRelative(file, specifier);

        if (resolved === null) {
          violations.push(
            `${path.relative(rootDir, file)} imports ${specifier}, which could not be resolved.`
          );
          continue;
        }

        queue.push(resolved);
        continue;
      }

      if (packageName.startsWith("@opennest/")) {
        const resolved = await resolveWorkspacePackage(file, specifier);

        if (resolved === null) {
          violations.push(
            `${path.relative(rootDir, file)} imports ${specifier}, whose workspace entry point could not be resolved.`
          );
          continue;
        }

        queue.push(resolved);
      }
    }
  }

  if (violations.length > 0) {
    console.error("Browser dependency graph check failed:");

    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }

    process.exit(1);
  }

  console.log(
    `Browser dependency graph is clean (${visited.size} files reachable from browser entry points).`
  );
}

await main();
