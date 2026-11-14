import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createVersion, renderServiceWorker, uniquePaths } from "./build-lib.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_DIR = path.join(ROOT_DIR, "apps/web");
const NEXT_STATIC_DIR = path.join(WEB_DIR, ".next/static");
const PUBLIC_DIR = path.join(WEB_DIR, "public");
const TEMPLATE_PATH = path.join(ROOT_DIR, "scripts/pwa/service-worker.js");
const OUTPUT_PATH = path.join(PUBLIC_DIR, "sw.js");
const ROUTES = ["/", "/library", "/notes", "/search", "/settings", "/offline"];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walk(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }

  return files;
}

function toPublicPath(file, directory) {
  return `/${path.relative(directory, file).split(path.sep).join("/")}`;
}

const staticFiles = await walk(NEXT_STATIC_DIR);
const publicFiles = (await walk(PUBLIC_DIR)).filter((file) => file !== OUTPUT_PATH);

const precache = uniquePaths([
  ...ROUTES,
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  ...publicFiles.map((file) => toPublicPath(file, PUBLIC_DIR)),
  ...staticFiles.map(
    (file) =>
      `/_next/static/${path.relative(NEXT_STATIC_DIR, file).split(path.sep).join("/")}`
  ),
]);

const template = await readFile(TEMPLATE_PATH, "utf8");
const buildId = (await readFile(path.join(WEB_DIR, ".next/BUILD_ID"), "utf8")).trim();
const version = createVersion([buildId, template, ...precache]);
const source = renderServiceWorker({ template, version, precache });

await mkdir(PUBLIC_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, source, "utf8");

console.log(
  `Generated service worker ${version} with ${precache.length} precached paths.`
);
