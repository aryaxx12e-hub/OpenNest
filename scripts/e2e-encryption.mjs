import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playwrightDir =
  process.env.PLAYWRIGHT_MODULE_PATH ??
  "/data/data/com.termux/files/usr/lib/node_modules";
const chromiumPath =
  process.env.CHROMIUM_PATH ??
  "/data/data/com.termux/files/usr/lib/chromium/chromium-launcher.sh";

const workspacePassphrase = "correct horse battery staple";
const backupKeyPrefix = "ONBK1-";

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
      const port = typeof address === "object" && address !== null ? address.port : 4330;

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
    } catch {
      // The server is still starting.
    }

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
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return errors;
}

async function assertPageStructure(page, label, options = {}) {
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

    for (const image of document.querySelectorAll("img")) {
      if (!image.hasAttribute("alt")) {
        problems.push("an image has no alt attribute");
      }
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

  const filtered = options.skipMainId
    ? issues.filter((issue) => issue !== "main#main-content is missing")
    : issues;

  assert.deepEqual(filtered, [], `${label}: ${filtered.join("; ")}`);
}

async function run() {
  const server = await startServer();
  const chromium = loadChromium();
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  const timings = {};
  const unique = `e2ee-${Date.now().toString(36)}`;
  const noteTitle = `Encrypted note ${unique}`;

  async function navigate(label) {
    await page.getByRole("link", { name: label, exact: true }).click();
  }

  try {
    let started = Date.now();
    await page.goto(`${server.base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    timings.settingsMs = Date.now() - started;
    await assertPageStructure(page, "settings before setup");

    await page.getByLabel("Passphrase", { exact: true }).fill(workspacePassphrase);
    await page
      .getByLabel("Confirm passphrase", { exact: true })
      .fill(workspacePassphrase);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("heading", { name: "Save your recovery key" }).waitFor();
    const recoveryKey = (await page.locator("code").textContent())?.trim() ?? "";
    assert.match(recoveryKey, /^ONRK1-/);
    await assertPageStructure(page, "recovery-key step");

    started = Date.now();
    await page.getByLabel("I saved this recovery key somewhere safe.").check();
    await page.getByRole("button", { name: "Turn on encryption", exact: true }).click();
    await page
      .getByText("Encryption is on.", { exact: true })
      .waitFor({ timeout: 30_000 });
    timings.setupMs = Date.now() - started;
    await assertPageStructure(page, "encrypted settings");

    await navigate("Notes");
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.waitForURL(/\/notes\/[^/]+$/);
    await page.getByRole("textbox", { name: "Note title" }).fill(noteTitle);
    await page.getByText("Unsaved changes", { exact: true }).waitFor({ timeout: 5000 });
    await page
      .getByRole("textbox", { name: "Write" })
      .fill(`# Encrypted ${unique}\n\n- locked\n- unlocked`);
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 10_000 });
    await page.getByRole("tab", { name: "Preview" }).click();
    await page.getByRole("heading", { name: `Encrypted ${unique}` }).waitFor();
    await assertPageStructure(page, "encrypted note editor");

    await navigate("Library");
    await page.locator('input[type="file"]').setInputFiles({
      name: `${unique}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`hello from encrypted ${unique}`),
    });
    await page.getByText("Upload complete.").waitFor();
    await page.getByRole("link", { name: new RegExp(`${unique}\\.txt`) }).click();
    await page.waitForURL(/\/files\/[^/]+$/);
    await page.getByText(`hello from encrypted ${unique}`).waitFor();
    await assertPageStructure(page, "encrypted file preview");

    await navigate("Search");
    await page.getByLabel("Search your library", { exact: true }).fill(noteTitle);
    await page.locator("#search-results").waitFor();
    await page
      .getByRole("link", { name: new RegExp(noteTitle) })
      .first()
      .waitFor();
    await assertPageStructure(page, "encrypted search");

    await navigate("Notes");
    await page
      .getByRole("link", { name: new RegExp(noteTitle) })
      .first()
      .click();
    await page.waitForURL(/\/notes\/[^/]+$/);
    await page.waitForFunction(
      (marker) => {
        const textarea = document.querySelector('textarea[aria-label="Write"]');

        return textarea instanceof HTMLTextAreaElement && textarea.value.includes(marker);
      },
      unique,
      { timeout: 10_000 }
    );
    const notePath = new URL(page.url()).pathname;
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Your library is locked" }).waitFor();
    assert.equal(new URL(page.url()).pathname, notePath);
    await assertPageStructure(page, "locked deep link", { skipMainId: true });

    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("definitely wrong passphrase");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.getByText("The passphrase or recovery key is incorrect.").waitFor();
    assert.equal(new URL(page.url()).pathname, notePath);
    await page.getByLabel("Passphrase", { exact: true }).fill(workspacePassphrase);
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await page.getByRole("textbox", { name: "Note title" }).waitFor({ timeout: 20_000 });
    assert.equal(
      await page.getByRole("textbox", { name: "Note title" }).inputValue(),
      noteTitle
    );
    assert.equal(new URL(page.url()).pathname, notePath);

    await navigate("Settings");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const exportDialog = page.getByRole("dialog");
    await exportDialog.waitFor();
    await exportDialog.getByRole("radio", { name: /Backup key/ }).check();
    const backupKey = await exportDialog.locator("input[readonly]").inputValue();
    assert.match(backupKey, /^ONBK1-/);
    await exportDialog.getByLabel("I saved this backup key.").check();
    await exportDialog.getByRole("button", { name: "Download backup" }).click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    assert.ok(backupPath, "the encrypted backup should be saved to a temporary file");
    const backupText = await readFile(backupPath, "utf8");
    const envelope = JSON.parse(backupText);
    assert.equal(envelope.format, "opennest-backup");
    assert.equal(envelope.formatVersion, 2);
    assert.ok(Array.isArray(envelope.chunks) && envelope.chunks.length > 0);
    assert.equal(backupText.includes(unique), false, "v2 must not leak plaintext titles");
    assert.equal(backupText.includes(noteTitle), false, "v2 must not leak note titles");
    await page.getByText("Backup downloaded. Store it somewhere safe.").waitFor();
    await exportDialog.getByRole("button", { name: "Done" }).click();

    await navigate("Privacy");
    await page.getByRole("heading", { name: "Privacy Center", exact: true }).waitFor();
    await assertPageStructure(page, "encrypted privacy center");
    await page.getByRole("button", { name: "Delete all data" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Delete everything" }).click();
    await page.getByText("All local data was deleted.", { exact: true }).waitFor({
      timeout: 30_000,
    });

    await navigate("Settings");
    await page.getByRole("heading", { name: "Turn on encryption" }).waitFor();
    await page.locator('input[type="file"]').setInputFiles(backupPath);
    const importDialog = page.getByRole("dialog");
    await importDialog.getByText("Unlock this backup").waitFor();
    await importDialog.getByRole("radio", { name: "Backup key", exact: true }).check();
    await importDialog
      .locator('input[type="text"]')
      .fill(`${backupKeyPrefix}WRONG-WRONG`);
    await importDialog.getByRole("button", { name: "Unlock backup" }).click();
    await importDialog
      .getByText("The passphrase or backup key is incorrect, or the backup is damaged.")
      .waitFor();
    await importDialog.locator('input[type="text"]').fill(backupKey);
    await importDialog.getByRole("button", { name: "Unlock backup" }).click();
    const restoreDialog = page.getByRole("dialog");
    await restoreDialog.getByText("Replace all data?").waitFor();
    await restoreDialog
      .getByText("This backup is encrypted, but your library is not.")
      .waitFor();
    await restoreDialog.getByRole("button", { name: "Replace data" }).click();
    await page
      .getByText("Backup restored.", { exact: true })
      .waitFor({ timeout: 30_000 });

    await navigate("Notes");
    await page
      .getByRole("link", { name: new RegExp(noteTitle) })
      .first()
      .waitFor();
    await navigate("Library");
    await page.getByRole("link", { name: new RegExp(`${unique}\\.txt`) }).click();
    await page.waitForURL(/\/files\/[^/]+$/);
    await page.getByText(`hello from encrypted ${unique}`).waitFor();
    await assertPageStructure(page, "restored encrypted file");

    assert.deepEqual(errors, [], "console errors");

    console.log(
      JSON.stringify(
        {
          checks: [
            "mobile setup and recovery-key confirmation",
            "encrypted note autosave",
            "encrypted file upload and preview",
            "encrypted search",
            "reload locks and preserves the deep link",
            "wrong passphrase error and unlock",
            "backup v2 export with a backup key",
            "encrypted backup leaks no note title",
            "privacy delete-all removes the keyring",
            "wrong backup key error",
            "backup v2 import restores notes and file bytes",
            "412 x 915 structure and overflow checks",
          ],
          errors,
          timings,
        },
        null,
        2
      )
    );
  } finally {
    await context.close();
    await browser.close();
    await server.stop();
  }
}

await run();
