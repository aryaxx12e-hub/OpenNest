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
      const port = typeof address === "object" && address !== null ? address.port : 4310;

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
  const timings = {};
  const unique = `e2e-${Date.now().toString(36)}`;

  try {
    const started = Date.now();
    await page.goto(server.base, { waitUntil: "networkidle" });
    timings.dashboardMs = Date.now() - started;
    await page.getByRole("heading", { name: "Your library", exact: true }).waitFor();
    await assertPageStructure(page, "dashboard");

    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => {
      const active = document.activeElement;

      return {
        href: active?.getAttribute("href"),
        text: active?.textContent?.trim(),
      };
    });
    assert.equal(firstFocus.href, "#main-content");
    assert.equal(firstFocus.text, "Skip to content");

    await page.getByRole("button", { name: "New note" }).first().click();
    await page.waitForURL(/\/notes\?noteId=[^/]+$/);
    const title = page.getByRole("textbox", { name: "Note title" });
    await title.fill(`E2E note ${unique}`);
    await page.getByText("Unsaved changes", { exact: true }).waitFor({ timeout: 5000 });
    await page
      .getByRole("textbox", { name: "Write" })
      .fill(`# E2E ${unique}\n\n- one\n- **two**`);
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 5000 });

    await title.fill("");
    await title.blur();
    assert.equal(await title.getAttribute("aria-invalid"), "true");
    const describedBy = await title.getAttribute("aria-describedby");
    assert.ok(describedBy, "the title input should describe its validation error");
    const describedText = await page.locator(`[id="${describedBy}"]`).textContent();
    assert.match(describedText ?? "", /note title/i);
    await title.fill(`E2E note ${unique}`);
    assert.equal(await title.getAttribute("aria-invalid"), "false");
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 5000 });

    const navigationMarker = `# E2E ${unique}\n\nNavigation save ${unique}`;
    await page.getByRole("textbox", { name: "Write" }).fill(navigationMarker);
    await page.getByRole("link", { name: "All notes", exact: true }).click();
    await page.getByRole("heading", { name: "Notes", exact: true }).waitFor();
    await page
      .getByRole("link", { name: new RegExp(`E2E note ${unique}`) })
      .first()
      .click();
    await page.waitForURL(/\/notes\?noteId=[^/]+$/);
    await page.waitForFunction(
      (marker) => {
        const textarea = document.querySelector('textarea[aria-label="Write"]');

        return textarea instanceof HTMLTextAreaElement && textarea.value.includes(marker);
      },
      navigationMarker,
      { timeout: 5000 }
    );

    const editTab = page.getByRole("tab", { name: "Write" });
    const previewTab = page.getByRole("tab", { name: "Preview" });
    await editTab.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await previewTab.getAttribute("aria-selected"), "true");
    assert.match(
      (await page.evaluate(() => document.activeElement?.textContent ?? "")) ?? "",
      /Preview/
    );
    await page.getByRole("heading", { name: `E2E ${unique}` }).waitFor();
    await assertPageStructure(page, "note editor");

    await page.getByRole("button", { name: "Tags" }).first().click();
    await page.getByLabel("New tag name").fill(`tag-${unique}`);
    await page.getByRole("button", { name: "Create tag" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText(`tag-${unique}`, { exact: true }).waitFor();
    await page.getByRole("dialog").waitFor({ state: "detached" });

    await page.goto(`${server.base}/notes`, { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: new RegExp(`E2E note ${unique}`) })
      .first()
      .waitFor();
    await assertPageStructure(page, "notes");

    await page.goto(
      `${server.base}/search?q=${encodeURIComponent(`E2E note ${unique}`)}`,
      { waitUntil: "networkidle" }
    );
    const resultStatus = page.locator("#search-results");
    await resultStatus.waitFor();
    assert.match((await resultStatus.textContent()) ?? "", /1 results?/);
    await page.getByRole("group", { name: "Tags" }).waitFor();
    await page
      .getByRole("link", { name: new RegExp(`E2E note ${unique}`) })
      .first()
      .waitFor();
    await assertPageStructure(page, "search");

    await page.goto(`${server.base}/library`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New folder" }).first().click();
    const createDialog = page.getByRole("dialog");
    await createDialog.waitFor();
    const focusInside = await page.evaluate(() => {
      const dialog = document.querySelector("dialog");

      return dialog !== null && dialog.contains(document.activeElement);
    });
    assert.equal(focusInside, true);
    await page.keyboard.press("Escape");
    await createDialog.waitFor({ state: "detached" });

    await page.getByRole("button", { name: "New folder" }).first().click();
    await page.getByLabel("Folder name").fill(`Folder ${unique}`);
    await page.getByRole("button", { name: "Create folder" }).click();
    await page.getByRole("link", { name: new RegExp(`Folder ${unique}`) }).waitFor();
    await page.getByRole("link", { name: new RegExp(`Folder ${unique}`) }).click();
    await page.waitForURL(/\/library\?folderId=[^/]+$/);
    await page.getByRole("heading", { name: `Folder ${unique}`, exact: true }).waitFor();
    await assertPageStructure(page, "library folder");

    await page.locator('input[type="file"]').setInputFiles({
      name: `${unique}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`hello from ${unique}`),
    });
    await page.getByText("Upload complete.").waitFor();
    await page.getByRole("link", { name: new RegExp(`${unique}\\.txt`) }).click();
    await page.waitForURL(/\/files\?fileId=[^/]+$/);
    await page.getByText(`hello from ${unique}`).waitFor();
    await assertPageStructure(page, "file preview");

    await page.goto(`${server.base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await assertPageStructure(page, "settings");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("radio", { name: /Plaintext \(v1\)/ }).check();
    await page.getByRole("button", { name: "Export backup" }).click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    assert.ok(backupPath, "the exported backup should be saved to a temporary file");
    const backupText = await readFile(backupPath, "utf8");
    assert.match(backupText, /"format": "opennest-backup"/);
    assert.match(backupText, new RegExp(unique));
    await page.getByText("Backup exported.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.goto(`${server.base}/notes`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New note" }).first().click();
    await page.waitForURL(/\/notes\?noteId=[^/]+$/);
    await page
      .getByRole("textbox", { name: "Note title" })
      .fill(`After export ${unique}`);
    await page.getByText("Unsaved changes", { exact: true }).waitFor({ timeout: 5000 });
    await page.getByText("Saved", { exact: true }).waitFor({ timeout: 5000 });

    await page.goto(`${server.base}/settings`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles(backupPath);
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Replace data" }).click();
    await page.getByText("Backup restored.").waitFor();

    await page.goto(`${server.base}/notes`, { waitUntil: "networkidle" });
    await page
      .getByRole("link", { name: new RegExp(`E2E note ${unique}`) })
      .first()
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: new RegExp(`After export ${unique}`) })
        .count(),
      0
    );
    await assertPageStructure(page, "restored notes");

    await page.goto(`${server.base}/privacy`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Privacy Center", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Data inventory", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Audit log", exact: true }).waitFor();
    await assertPageStructure(page, "privacy center");

    const privacyDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("radio", { name: /Plaintext \(v1\)/ }).check();
    await page.getByRole("button", { name: "Export backup" }).click();
    await privacyDownloadPromise;
    await page.getByText("Backup exported.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByText("Built-in", { exact: true }).first().waitFor();

    await page.getByRole("button", { name: "Delete all data" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Delete all data" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Delete everything" }).click();
    await page.getByText("All local data was deleted.").waitFor();
    await page.getByText("No audit entries yet.").waitFor();
    await page.getByText("Built-in", { exact: true }).first().waitFor();

    await page.goto(server.base, { waitUntil: "networkidle" });
    await page.getByText("Start your library", { exact: true }).waitFor();
    await assertPageStructure(page, "empty workspace after privacy delete");

    const desktop = await context.newPage();
    await desktop.setViewportSize({ width: 1280, height: 900 });
    const desktopErrors = collectErrors(desktop);
    const desktopStart = Date.now();
    await desktop.goto(`${server.base}/library`, { waitUntil: "networkidle" });
    timings.desktopLibraryMs = Date.now() - desktopStart;
    await desktop.getByRole("heading", { name: "My Library", exact: true }).waitFor();
    await assertPageStructure(desktop, "desktop library");
    assert.deepEqual(desktopErrors, [], "desktop console errors");

    assert.deepEqual(errors, [], "console errors");

    console.log(
      JSON.stringify(
        {
          checks: [
            "dashboard structure",
            "skip link",
            "note autosave",
            "autosave on navigation",
            "title validation description",
            "tab keyboard navigation",
            "tag creation",
            "notes list",
            "search status and tag group",
            "dialog focus and Escape",
            "folder creation",
            "file upload and preview",
            "settings backup export",
            "settings backup restore",
            "privacy center structure",
            "privacy export",
            "privacy delete all",
            "empty workspace after deletion",
            "desktop layout",
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
