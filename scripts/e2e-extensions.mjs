import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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

const extensionId = "com.opennest.e2e";
const extensionName = "E2E extension";

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

    return problems;
  });

  assert.deepEqual(issues, [], `${label}: ${issues.join("; ")}`);
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function extensionPackage({ version, capabilities, code }) {
  const manifest = {
    id: extensionId,
    name: extensionName,
    version,
    publisher: "OpenNest E2E",
    description: "A local extension used by the browser journey.",
    tier: 1,
    entry: "index.js",
    capabilities,
    dataScopes: ["notes"],
    networkOrigins: [],
    minHostVersion: "0.1.0",
  };
  const payload = {
    format: "opennest-extension",
    formatVersion: 1,
    manifest,
    files: { "index.js": code },
  };
  const integrity = `sha256:${createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex")}`;

  return JSON.stringify({ ...payload, integrity }, null, 2);
}

const V1_CODE = `
opennest.register(async () => {
  opennest.ready();
  const probe = (() => {
    const names = ["document", "localStorage", "indexedDB", "fetch", "Worker", "importScripts"];
    const result = {};
    for (const name of names) {
      try {
        result[name] = typeof self[name];
      } catch {
        result[name] = "blocked";
      }
    }
    return result;
  })();
  const previous = await opennest.call("storage.get", { key: "runs" });
  const runs = (Number(previous) || 0) + 1;
  await opennest.call("storage.set", { key: "runs", value: String(runs) });
  const summary = await opennest.call("workspace.summary");
  opennest.render({
    type: "stack",
    children: [
      { type: "heading", text: "Extension summary" },
      { type: "text", text: "Runs: " + runs },
      { type: "text", text: "Notes: " + summary.notes },
      { type: "text", text: "Probe: " + JSON.stringify(probe) },
    ],
  });
});
`;

const V2_CODE = `
opennest.register(async () => {
  opennest.ready();
  const page = await opennest.call("workspace.listNotes");
  const note = page.items[0];
  if (!note) {
    opennest.render({ type: "text", text: "No notes found" });
    return;
  }
  const full = await opennest.call("workspace.readNote", { noteId: note.id });
  const metadata = {};
  for (const key of Object.keys(full)) {
    if (key !== "content") {
      metadata[key] = full[key];
    }
  }
  opennest.render({
    type: "stack",
    children: [
      { type: "heading", text: "Content extension" },
      { type: "text", text: "Title: " + full.title },
      { type: "text", text: "Body: " + full.content },
      { type: "text", text: "Metadata: " + JSON.stringify(metadata) },
    ],
  });
});
`;

async function openRunner(page, base) {
  await page.goto(`${base}/extensions?extensionId=${encodeURIComponent(extensionId)}`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: extensionName, exact: true }).waitFor();
}

async function installPackage(page, base, body, name) {
  await page.goto(`${base}/extensions`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Extensions", exact: true }).waitFor();
  await page.locator("#extension-package").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(body),
  });
  await page.getByRole("dialog").waitFor();
}

async function confirmInstall(page, { update = false } = {}) {
  const dialog = page.getByRole("dialog");

  await dialog
    .getByText("This extension cannot access the network", { exact: true })
    .waitFor();
  await dialog
    .getByText(
      "This package is not signed. Install it only if you trust the person who made it.",
      {
        exact: true,
      }
    )
    .waitFor();
  await dialog.locator('input[type="checkbox"]').check();
  await dialog
    .getByRole("button", { name: update ? "Update" : "Install", exact: true })
    .click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("Extension installed.", { exact: true }).waitFor();
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
  const unique = `ext-${Date.now().toString(36)}`;
  const noteTitle = `E2E extension note ${unique}`;
  const noteBody = `SECRET-BODY-${unique}`;
  const v1 = extensionPackage({
    version: "1.0.0",
    capabilities: ["workspace.read.metadata"],
    code: V1_CODE,
  });
  const v2 = extensionPackage({
    version: "2.0.0",
    capabilities: ["workspace.read.metadata", "workspace.read.content"],
    code: V2_CODE,
  });
  const checks = [];

  try {
    await page.goto(server.base, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Your library", exact: true }).waitFor();
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.waitForURL(/\/notes\?noteId=[^/]+$/);
    await page.getByRole("textbox", { name: "Note title" }).fill(noteTitle);
    await page.getByRole("textbox", { name: "Write" }).fill(noteBody);
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 5000 });
    checks.push("a note with a unique body exists");

    await page.goto(`${server.base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await page.getByRole("link", { name: "Manage extensions" }).click();
    await page.waitForURL(/\/extensions$/);
    await page.getByRole("heading", { name: "Extensions", exact: true }).waitFor();
    checks.push("settings links to the extensions page");

    await installPackage(page, server.base, v1, `${unique}-v1.json`);
    const firstDialog = page.getByRole("dialog");
    assert.match((await firstDialog.textContent()) ?? "", /Read workspace metadata/);
    assert.match(
      (await firstDialog.textContent()) ?? "",
      /This extension cannot access the network/
    );
    assert.match((await firstDialog.textContent()) ?? "", /This package is not signed/);
    assert.equal(
      await firstDialog
        .getByRole("button", { name: "Install", exact: true })
        .isDisabled(),
      true,
      "install must require consent"
    );
    await firstDialog.locator('input[type="checkbox"]').check();
    await firstDialog.getByRole("button", { name: "Install", exact: true }).click();
    await firstDialog.waitFor({ state: "detached" });
    await page.getByText("Extension installed.", { exact: true }).waitFor();
    checks.push("the metadata-only package requires consent before install");

    await page.getByRole("link", { name: "Open", exact: true }).click();
    await page.waitForURL(
      (url) =>
        url.pathname === "/extensions" &&
        url.searchParams.get("extensionId") === extensionId
    );
    await page.getByRole("heading", { name: extensionName, exact: true }).waitFor();
    await page.getByText("Running", { exact: true }).waitFor();
    await page.getByText("Runs: 1", { exact: true }).waitFor();
    await page.getByText("Extension summary", { exact: true }).waitFor();

    const probeText = (await page.getByText(/^Probe: /).textContent()) ?? "";
    const probe = JSON.parse(probeText.replace(/^Probe: /, ""));

    assert.deepEqual(probe, {
      document: "undefined",
      localStorage: "undefined",
      indexedDB: "undefined",
      fetch: "undefined",
      Worker: "undefined",
      importScripts: "undefined",
    });
    checks.push("the worker cannot reach browser, storage, network, or worker globals");

    const iframe = page.locator('iframe[aria-hidden="true"]').first();
    await iframe.waitFor();
    assert.equal(await iframe.getAttribute("sandbox"), "allow-scripts");
    const srcdoc = (await iframe.getAttribute("srcdoc")) ?? "";

    assert.match(srcdoc, /connect-src 'none'/);
    assert.doesNotMatch(srcdoc, /allow-same-origin/);
    checks.push("the extension frame is sandboxed without same-origin access");

    await page.getByRole("button", { name: "Stop extension" }).click();
    await page.getByText("Stopped", { exact: true }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("Runs: 2", { exact: true }).waitFor();
    checks.push("extension storage survives a stop and a new run");

    await page.goto(`${server.base}/extensions`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Extensions", exact: true }).waitFor();
    await page.locator("#extension-package").setInputFiles({
      name: `${unique}-v2.json`,
      mimeType: "application/json",
      buffer: Buffer.from(v2),
    });
    const updateDialog = page.getByRole("dialog");
    await updateDialog.waitFor();
    await updateDialog.getByText("Update extension", { exact: true }).waitFor();
    await updateDialog
      .getByText("New permissions in this update:", { exact: true })
      .waitFor();
    await updateDialog.getByText("Read note text", { exact: true }).waitFor();
    assert.equal(
      (await updateDialog.textContent())?.includes("Read workspace metadata") ?? false,
      false,
      "the update consent lists only new permissions"
    );
    await updateDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await updateDialog.waitFor({ state: "detached" });
    checks.push("the update preview lists only the new content permission");

    await page.locator("#extension-package").setInputFiles({
      name: `${unique}-v2.json`,
      mimeType: "application/json",
      buffer: Buffer.from(v2),
    });
    await page.getByRole("dialog").waitFor();
    await confirmInstall(page, { update: true });

    await openRunner(page, server.base);
    await page.getByText("Running", { exact: true }).waitFor();
    await page.getByText("Content extension", { exact: true }).waitFor();
    await page.getByText(new RegExp(`Body: ${noteBody}`)).waitFor();
    const metadataText = (await page.getByText(/^Metadata: /).textContent()) ?? "";

    assert.equal(metadataText.includes('"content"'), false);
    checks.push("the content grant reads the note body without exposing it in metadata");

    await page.goto(`${server.base}/extensions`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Extensions", exact: true }).waitFor();
    const enabled = page.getByRole("checkbox", { name: "Enabled", exact: true });
    await enabled.waitFor();
    await enabled.click();
    await page.getByText("Disabled", { exact: true }).waitFor();
    await openRunner(page, server.base);
    await page
      .getByText("This extension is disabled. Enable it before running.", {
        exact: true,
      })
      .waitFor();

    await page.goto(`${server.base}/extensions`, { waitUntil: "networkidle" });
    await page.getByRole("checkbox", { name: "Enabled", exact: true }).click();
    await page.getByText("Enabled", { exact: true }).waitFor();
    checks.push("a disabled extension cannot start");

    await page.getByRole("button", { name: "Turn on safe mode" }).click();
    await page.getByText("Safe mode is on.", { exact: true }).first().waitFor();
    await openRunner(page, server.base);
    await page
      .getByText("Safe mode is on. Turn it off before running extensions.", {
        exact: true,
      })
      .waitFor();

    await page.goto(`${server.base}/extensions`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Turn off safe mode" }).click();
    await page.getByText("Safe mode is off.", { exact: true }).first().waitFor();
    checks.push("safe mode blocks extension sessions");

    await page.getByRole("button", { name: "Uninstall", exact: true }).click();
    const uninstallDialog = page.getByRole("dialog");
    await uninstallDialog
      .getByText("Uninstall this extension?", { exact: true })
      .waitFor();
    await uninstallDialog
      .getByRole("button", { name: "Uninstall extension", exact: true })
      .click();
    await page.getByText("No extensions installed", { exact: true }).waitFor();
    checks.push("uninstall removes the extension and its card");

    await installPackage(page, server.base, v1, `${unique}-v1-again.json`);
    await confirmInstall(page);
    await openRunner(page, server.base);
    await page.getByText("Runs: 1", { exact: true }).waitFor();
    checks.push("reinstall starts with empty extension storage");

    await page.goto(`${server.base}/privacy`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Privacy Center", exact: true }).waitFor();
    await page.getByText("Installed extensions", { exact: true }).waitFor();
    await page.getByText("Extension installed", { exact: true }).first().waitFor();
    await page.getByText("Extension uninstalled", { exact: true }).first().waitFor();
    await page.getByText("Extension started", { exact: true }).first().waitFor();
    await assertPageStructure(page, "extension install flow pages");
    checks.push("privacy inventory and audit expose extension activity");

    assert.deepEqual(errors, [], "console errors");

    console.log(JSON.stringify({ checks, errors }, null, 2));
  } catch (error) {
    console.error("E2E page text:");
    console.error(
      await page
        .locator("main")
        .innerText()
        .catch(() => "unavailable")
    );
    console.error("E2E errors:", errors);
    throw error;
  } finally {
    await context.close();
    await browser.close();
    await server.stop();
  }
}

await run();
