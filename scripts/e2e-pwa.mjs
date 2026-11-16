import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const swPath = path.join(rootDir, "apps/web/public/sw.js");
const playwrightDir =
  process.env.PLAYWRIGHT_MODULE_PATH ??
  "/data/data/com.termux/files/usr/lib/node_modules";
const chromiumPath =
  process.env.CHROMIUM_PATH ??
  "/data/data/com.termux/files/usr/lib/chromium/chromium-launcher.sh";

function loadChromium() {
  const require = createRequire(path.join(playwrightDir, "noop.js"));

  try {
    return require("playwright").chromium;
  } catch {
    console.error(
      "Playwright is not available. Set PLAYWRIGHT_MODULE_PATH to the node_modules directory that contains it."
    );
    process.exit(2);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 4320;

      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, child, logs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early.\n${logs()}`);
    }

    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Server did not become ready at ${url}.\n${logs()}`);
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());

    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }

    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      resolve();
    }, 3000).unref();
  });
}

async function startServer() {
  if (process.env.BASE_URL !== undefined) {
    return { base: process.env.BASE_URL.replace(/\/$/, ""), stop: async () => {} };
  }

  const port = Number(process.env.E2E_PORT ?? (await freePort()));
  let output = "";
  const child = spawn(process.execPath, ["scripts/next.mjs", "start"], {
    cwd: rootDir,
    detached: true,
    env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const base = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(base, child, () => output);
  } catch (error) {
    stopServer(child);
    throw error;
  }

  return {
    base,
    async stop() {
      await stopServer(child);
    },
  };
}

function collectErrors(page) {
  const errors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      errors.push(`${message.text()} ${location.url ?? ""}`.trim());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });

  return errors;
}

async function assertPageStructure(page, label) {
  const issues = await page.evaluate(() => {
    const problems = [];
    const headings = document.querySelectorAll("h1");

    if (headings.length !== 1) {
      problems.push(`expected one h1, found ${headings.length}`);
    }

    if (document.querySelector("main#main-content") === null) {
      problems.push("main#main-content is missing");
    }

    const ids = new Set();

    for (const element of document.querySelectorAll("[id]")) {
      if (ids.has(element.id)) {
        problems.push(`duplicate id ${element.id}`);
      }
      ids.add(element.id);
    }

    for (const control of document.querySelectorAll("a[href], button")) {
      const name = (
        control.getAttribute("aria-label") ??
        control.getAttribute("title") ??
        control.textContent ??
        ""
      ).trim();

      if (name.length === 0) {
        problems.push(`${control.tagName.toLowerCase()} has no accessible name`);
      }
    }

    const root = document.documentElement;

    if (root.scrollWidth > root.clientWidth + 1) {
      problems.push(
        `horizontal overflow: ${root.scrollWidth}px wider than ${root.clientWidth}px`
      );
    }

    return problems;
  });

  assert.deepEqual(issues, [], `${label}: ${issues.join("; ")}`);
}

async function run() {
  const server = await startServer();
  const chromium = loadChromium();
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
  });
  const page = await context.newPage();
  const errors = collectErrors(page);
  const originalSw = await readFile(swPath, "utf8");
  let swModified = false;
  const unique = `pwa-${Date.now().toString(36)}`;

  try {
    const manifestResponse = await fetch(`${server.base}/manifest.webmanifest`);
    assert.equal(manifestResponse.status, 200);

    const manifest = await manifestResponse.json();
    assert.equal(manifest.name, "OpenNest");
    assert.equal(manifest.short_name, "OpenNest");
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.scope, "/");
    assert.equal(manifest.display, "standalone");

    for (const icon of manifest.icons ?? []) {
      const response = await fetch(`${server.base}${icon.src}`);

      assert.equal(response.status, 200, icon.src);
      assert.match(response.headers.get("content-type") ?? "", /^image\/png/);
    }

    const swResponse = await fetch(`${server.base}/sw.js`);
    assert.equal(swResponse.status, 200);
    assert.equal(
      swResponse.headers.get("cache-control"),
      "no-cache, no-store, must-revalidate"
    );
    assert.equal(swResponse.headers.get("service-worker-allowed"), "/");

    const swSource = await swResponse.text();
    const precacheMatch = swSource.match(/const PRECACHE = (\[[^;]+\]);/);

    assert.ok(precacheMatch, "the service worker should contain a precache list");

    const precache = JSON.parse(precacheMatch[1]);

    assert.ok(precache.includes("/"));
    assert.ok(precache.includes("/offline"));

    for (const asset of precache) {
      const response = await fetch(`${server.base}${asset}`);

      assert.equal(response.status, 200, `precache ${asset}`);
    }

    await page.goto(server.base, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Your library", exact: true }).waitFor();
    await assertPageStructure(page, "pwa dashboard");

    const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");

    assert.equal(manifestHref, "/manifest.webmanifest");

    await page.evaluate(async () => {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("Service worker did not become ready")),
            20000
          );
        }),
      ]);
    });

    const controlled = await page
      .waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 10000,
      })
      .then(() => true)
      .catch(() => false);

    if (!controlled) {
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
        undefined,
        {
          timeout: 10000,
        }
      );
    }

    assert.equal(
      await page.getByText("A new version is ready.", { exact: true }).count(),
      0
    );

    const noteTitle = `Offline note ${unique}`;

    await page.getByRole("button", { name: "New note" }).first().click();
    await page.waitForURL(/\/notes\/[^/]+$/);
    await page.getByRole("textbox", { name: "Note title" }).fill(noteTitle);
    await page
      .getByRole("textbox", { name: "Write" })
      .fill(`# ${noteTitle}\n\nSaved for offline.`);
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 5000 });

    await page.goto(`${server.base}/notes`, { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: new RegExp(noteTitle) })
      .first()
      .waitFor();

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Notes", exact: true }).waitFor();
    await page.getByText("Offline", { exact: true }).waitFor();
    await page
      .getByRole("link", { name: new RegExp(noteTitle) })
      .first()
      .waitFor();
    await assertPageStructure(page, "offline notes");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Notes", exact: true }).waitFor();
    await page
      .getByRole("link", { name: new RegExp(noteTitle) })
      .first()
      .waitFor();

    await page.goto(`${server.base}/library`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "My Library", exact: true }).waitFor();
    await page.getByText("Offline", { exact: true }).waitFor();
    await assertPageStructure(page, "offline library");

    await page.goto(`${server.base}/missing-${unique}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "You're offline." }).waitFor();
    await assertPageStructure(page, "offline fallback");

    await page.getByRole("link", { name: "Open library" }).click();
    await page.getByRole("heading", { name: "My Library", exact: true }).waitFor();
    await assertPageStructure(page, "offline fallback action");

    await page
      .getByRole("navigation", { name: "Quick navigation" })
      .getByRole("link", { name: "Notes", exact: true })
      .click();
    await page.getByRole("heading", { name: "Notes", exact: true }).waitFor();
    await assertPageStructure(page, "offline navigation");

    const freshContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
    });

    try {
      await freshContext.setOffline(true);
      const freshPage = await freshContext.newPage();
      let firstOpenFailed = false;

      try {
        await freshPage.goto(server.base, {
          waitUntil: "domcontentloaded",
          timeout: 8000,
        });
      } catch {
        firstOpenFailed = true;
      }

      assert.equal(
        firstOpenFailed,
        true,
        "a first visit with no cache cannot load OpenNest offline"
      );
    } finally {
      await freshContext.close();
    }

    await context.setOffline(false);
    await page.goto(`${server.base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();

    await writeFile(swPath, `${originalSw}\n// ${unique}\n`, "utf8");
    swModified = true;

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();

      await registration?.update();
    });

    await page
      .getByText("A new version is ready.", { exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor({
      timeout: 20000,
    });
    await page.waitForFunction(
      () => navigator.serviceWorker.controller !== null,
      undefined,
      {
        timeout: 10000,
      }
    );

    assert.equal(
      await page.getByText("A new version is ready.", { exact: true }).count(),
      0
    );

    await page.goto(`${server.base}/notes`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Notes", exact: true }).waitFor();

    const updateNoteTitle = `Update save note ${unique}`;
    const updateNoteContent = `Saved before update ${unique}`;
    const unsavedContent = `Unsaved before update ${unique}`;

    await page.getByRole("button", { name: "New note" }).first().click();
    await page.waitForURL(/\/notes\/[^/]+$/);
    await page.getByRole("textbox", { name: "Note title" }).fill(updateNoteTitle);
    await page
      .getByRole("textbox", { name: "Write" })
      .fill(`# ${updateNoteTitle}\n\n${updateNoteContent}`);
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 5000 });

    await writeFile(swPath, `${originalSw}\n// ${unique}\n// dirty ${unique}\n`, "utf8");

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();

      await registration?.update();
    });

    await page
      .getByText("A new version is ready.", { exact: true })
      .waitFor({ timeout: 30000 });

    await page.getByRole("textbox", { name: "Write" }).fill(unsavedContent);
    await page.getByText("Unsaved changes", { exact: true }).waitFor({ timeout: 5000 });

    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByRole("textbox", { name: "Note title" }).waitFor({
      timeout: 20000,
    });
    await page.waitForFunction(
      (marker) => {
        const textarea = document.querySelector('textarea[aria-label="Write"]');

        return textarea instanceof HTMLTextAreaElement && textarea.value === marker;
      },
      unsavedContent,
      { timeout: 10000 }
    );

    await page
      .getByText("A new version is ready.", { exact: true })
      .waitFor({ state: "detached", timeout: 20000 });

    const unexpectedErrors = errors.filter(
      (message) =>
        !/ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|net::ERR_/i.test(message)
    );

    assert.deepEqual(unexpectedErrors, [], "console errors");

    console.log(
      JSON.stringify(
        {
          checks: [
            "manifest install metadata",
            "manifest PNG icons",
            "service worker no-cache headers",
            "service worker precache list",
            "manifest link",
            "service worker controls the app",
            "first install has no update prompt",
            "note persisted through offline reload",
            "offline notes reload",
            "offline cached library navigation",
            "offline fallback page",
            "offline fallback action",
            "offline navigation links",
            "first-open offline limitation",
            "user-confirmed service worker update",
            "dirty note saved before update",
          ],
          errors: unexpectedErrors,
          offlineNetworkErrors: errors.length - unexpectedErrors.length,
        },
        null,
        2
      )
    );
  } finally {
    if (swModified) {
      await writeFile(swPath, originalSw, "utf8");
    }

    await context.close();
    await browser.close();
    await server.stop();
  }
}

await run();
