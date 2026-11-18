import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
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

const sessionSecret = "sk-session-e2e-secret";
const vaultSecret = "sk-vault-e2e-secret";
const vaultPassphrase = "correct horse battery staple";

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
    const server = createNetServer();

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

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, accept",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

async function startMockServer() {
  const requests = [];
  const replies = [];
  const server = createHttpServer((request, response) => {
    const origin = request.headers.origin;

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(origin));
      response.end();
      return;
    }

    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("not found");
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        body,
        authorization: request.headers.authorization ?? null,
      });
      const content = replies.shift() ?? "Mock response";
      const payload = {
        id: "chatcmpl-e2e",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };

      response.writeHead(200, {
        ...corsHeaders(origin),
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(payload));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 4400;

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    enqueue(reply) {
      replies.push(reply);
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
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
      const offenders = Array.from(document.querySelectorAll("body *"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();

          if (rect.right <= root.clientWidth + 1) {
            return false;
          }

          let ancestor = element.parentElement;

          while (ancestor !== null) {
            const overflow = getComputedStyle(ancestor).overflowX;

            if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") {
              return false;
            }

            ancestor = ancestor.parentElement;
          }

          return true;
        })
        .slice(0, 5)
        .map((element) => {
          const name = typeof element.className === "string" ? element.className : "";

          return `${element.tagName.toLowerCase()}.${name}`;
        });

      problems.push(
        `horizontal overflow: ${root.scrollWidth}px wider than ${root.clientWidth}px (${offenders.join("; ")})`
      );
    }

    return problems;
  });

  assert.deepEqual(issues, [], `${label}: ${issues.join("; ")}`);
}

function requestBody(model, prompt) {
  return JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  });
}

async function assertSecretNotExposed(page, secret, label) {
  const exposed = await page.evaluate((value) => {
    const inDom = (document.body?.innerText ?? "").includes(value);
    const inField = Array.from(document.querySelectorAll("input, textarea")).some(
      (element) => element.value.includes(value)
    );
    const inWebStorage = [
      ...Object.values(localStorage),
      ...Object.values(sessionStorage),
    ].some((entry) => entry.includes(value));

    return { inDom, inField, inWebStorage };
  }, secret);

  assert.deepEqual(
    exposed,
    { inDom: false, inField: false, inWebStorage: false },
    `${label}: the secret is exposed`
  );
}

async function run() {
  const mock = await startMockServer();
  const server = await startServer();
  const chromium = loadChromium();
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  const unique = `ai-${Date.now().toString(36)}`;
  const providerLabel = `Mock local ${unique}`;
  const checks = [];

  try {
    const initial = await page.goto(`${server.base}/ai`, { waitUntil: "networkidle" });
    const csp = initial?.headers()["content-security-policy"] ?? "";
    const connectSources = csp
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .find((tokens) => tokens[0] === "connect-src");

    assert.ok(connectSources, "the production CSP must include connect-src");
    assert.ok(connectSources.includes("https:"), "the CSP must allow HTTPS");
    assert.ok(
      connectSources.includes("http://localhost:*"),
      "the CSP must allow localhost"
    );
    assert.ok(
      connectSources.includes("http://127.0.0.1:*"),
      "the CSP must allow loopback 127.0.0.1"
    );
    assert.ok(!connectSources.includes("http:"), "the CSP must not allow broad HTTP");
    checks.push("production CSP allows HTTPS and loopback only");

    await page.getByRole("heading", { name: "AI console", exact: true }).waitFor();
    await page.getByText("AI is off", { exact: true }).waitFor();
    assert.equal(mock.requests.length, 0, "AI off must not reach the network");
    await assertPageStructure(page, "AI console while off");
    checks.push("AI is off and no request is made on load");

    await page.goto(`${server.base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await assertPageStructure(page, "settings before AI setup");
    assert.equal(await page.getByTestId("ai-enabled").isChecked(), false);

    await page.getByTestId("ai-enabled").click();
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-testid="ai-enabled"]');
      const link = document.querySelector('a[href="/ai"]');

      return input?.checked === true && link?.getAttribute("aria-disabled") === null;
    });

    await page.getByRole("button", { name: "Add provider" }).click();
    const providerDialog = page.getByRole("dialog");
    await providerDialog.waitFor();
    await providerDialog.getByTestId("provider-preset").selectOption("ollama");
    await providerDialog.getByTestId("provider-label").fill(providerLabel);
    await providerDialog.getByTestId("provider-endpoint").fill(`${mock.origin}/v1`);
    await providerDialog.getByTestId("provider-models").fill("mock-model");
    await providerDialog.getByLabel("Authentication").selectOption("bearer");
    await providerDialog.getByText("Local endpoint warning", { exact: true }).waitFor();

    await providerDialog.getByRole("button", { name: "Save provider" }).click();
    await providerDialog
      .getByText("Acknowledge the local endpoint warning before saving.", {
        exact: true,
      })
      .waitFor();

    await providerDialog.getByTestId("provider-local-warning").check();
    await providerDialog.getByRole("button", { name: "Save provider" }).click();
    await providerDialog.waitFor({ state: "detached" });
    await page.getByText("Provider saved.", { exact: true }).waitFor();
    const providerRow = page.locator('[data-testid^="provider-row-"]').first();
    await providerRow.waitFor();
    assert.match((await providerRow.textContent()) ?? "", new RegExp(providerLabel));
    await assertPageStructure(page, "settings with a local provider");
    checks.push("local provider requires the localhost warning acknowledgement");

    await page.getByTestId("session-provider").selectOption({ label: providerLabel });
    await page.getByTestId("session-label").fill("Session key");
    await page.getByTestId("session-secret").fill(sessionSecret);
    await page.getByRole("button", { name: "Save credential", exact: true }).click();
    await page.getByText("Credential saved.", { exact: true }).waitFor();
    await assertSecretNotExposed(page, sessionSecret, "session credential");
    checks.push("session credential is saved without exposing the secret in the DOM");

    await page.getByRole("link", { name: "Open AI console" }).click();
    await page.waitForURL(/\/ai$/);
    await page.getByRole("heading", { name: "AI console", exact: true }).waitFor();
    await page.getByTestId("ai-console-prompt").waitFor();
    assert.equal(mock.requests.length, 0, "viewing the console must not send a request");
    await assertPageStructure(page, "AI console while enabled");

    const firstPrompt = `Review this prompt ${unique}`;
    const firstReply = "Mock response one";
    mock.enqueue(firstReply);
    await page.getByTestId("ai-console-prompt").fill(firstPrompt);
    await page.getByTestId("ai-console-review").click();
    const consent = page.getByRole("dialog");
    await consent.waitFor();
    const consentText = (await consent.textContent()) ?? "";

    assert.ok(consentText.includes(mock.origin), "the consent shows the endpoint origin");
    assert.ok(consentText.includes("mock-model"), "the consent shows the model");
    assert.ok(
      consentText.includes("No workspace files"),
      "the consent states that no workspace content is attached"
    );
    assert.equal(mock.requests.length, 0, "no request may happen before approval");

    await consent.getByTestId("ai-console-approve").click();
    const response = page.getByTestId("ai-console-response");
    await response.waitFor();
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="ai-console-response"]')?.textContent ===
        expected,
      firstReply
    );
    assert.equal(mock.requests.length, 1, "approval sends exactly one request");
    assert.equal(mock.requests[0].body, requestBody("mock-model", firstPrompt));
    assert.equal(mock.requests[0].authorization, `Bearer ${sessionSecret}`);
    assert.equal((await response.textContent()) ?? "", firstReply);
    await assertPageStructure(page, "AI console with a response");
    checks.push("review makes no request and approval sends the exact request once");

    const htmlPrompt = `<img src=x onerror="window.__aiXss=1"> ${unique}`;
    const htmlReply = `<img src=x onerror="window.__aiXss=1"><b>bold</b>`;
    mock.enqueue(htmlReply);
    await page.getByTestId("ai-console-prompt").fill(htmlPrompt);
    await page.getByTestId("ai-console-review").click();
    await page.getByRole("dialog").waitFor();
    await page.getByTestId("ai-console-approve").click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="ai-console-response"]')?.textContent ===
        expected,
      htmlReply
    );
    assert.equal(mock.requests.length, 2, "the HTML response needs one request");
    assert.equal(mock.requests[1].body, requestBody("mock-model", htmlPrompt));
    assert.equal(mock.requests[1].authorization, `Bearer ${sessionSecret}`);
    assert.equal(
      await page.locator('[data-testid="ai-console-response"] b').count(),
      0,
      "model HTML must not become markup"
    );
    assert.equal(
      await page.evaluate(() => globalThis.__aiXss),
      undefined,
      "model HTML must not execute"
    );
    checks.push("HTML model output renders as text and never executes");

    await page.goto(`${server.base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await page.getByTestId("vault-setup-passphrase").waitFor();
    await page.getByTestId("vault-setup-ack").check();
    await page.getByTestId("vault-setup-passphrase").fill(vaultPassphrase);
    await page.getByTestId("vault-setup-confirm").fill(vaultPassphrase);
    await page.getByRole("button", { name: "Create vault", exact: true }).click();
    await page
      .getByText("Vault unlocked", { exact: true })
      .first()
      .waitFor({ timeout: 15000 });

    await page.getByTestId("vault-entry-provider").selectOption({ label: providerLabel });
    await page.getByTestId("vault-entry-label").fill("Vault key");
    await page.getByTestId("vault-entry-secret").fill(vaultSecret);
    await page.getByRole("button", { name: "Add vault credential" }).click();
    await page.getByText("Vault credential saved.", { exact: true }).waitFor();
    await assertSecretNotExposed(page, vaultSecret, "vault credential");
    checks.push("vault credential is saved without exposing the secret in the DOM");

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await page.getByText("Vault locked", { exact: true }).first().waitFor();
    await page.getByTestId("vault-unlock-passphrase").waitFor();
    assert.equal(await page.getByTestId("vault-setup-passphrase").count(), 0);
    await assertPageStructure(page, "settings with a locked vault");
    checks.push("the vault stays locked after reload");

    await page.goto(`${server.base}/ai`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "AI console", exact: true }).waitFor();
    await page
      .getByText("The vault is locked. Unlock it in Settings to use vault credentials.", {
        exact: true,
      })
      .first()
      .waitFor();
    assert.equal(await page.getByTestId("ai-console-credential").count(), 0);
    assert.equal(await page.getByTestId("ai-console-review").isDisabled(), true);
    checks.push("a locked vault blocks the console credential path");

    await page.goto(`${server.base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await page.getByTestId("vault-unlock-passphrase").fill(vaultPassphrase);
    await page.getByRole("button", { name: "Unlock vault", exact: true }).click();
    await page
      .getByText("Vault unlocked", { exact: true })
      .first()
      .waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: "Open AI console" }).click();
    await page.waitForURL(/\/ai$/);
    await page.getByRole("heading", { name: "AI console", exact: true }).waitFor();
    await page.getByTestId("ai-console-credential").selectOption({ label: "Vault key" });

    const vaultPrompt = `Vault prompt ${unique}`;
    const vaultReply = "Vault response";
    mock.enqueue(vaultReply);
    await page.getByTestId("ai-console-prompt").fill(vaultPrompt);
    await page.getByTestId("ai-console-review").click();
    await page.getByRole("dialog").waitFor();
    await page.getByTestId("ai-console-approve").click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="ai-console-response"]')?.textContent ===
        expected,
      vaultReply
    );
    assert.equal(mock.requests.length, 3, "the vault request needs one request");
    assert.equal(mock.requests[2].body, requestBody("mock-model", vaultPrompt));
    assert.equal(mock.requests[2].authorization, `Bearer ${vaultSecret}`);
    checks.push("the vault credential unlocks and sends after reload");

    await page.goto(`${server.base}/privacy`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Privacy Center", exact: true }).waitFor();
    await page
      .getByRole("heading", { name: "AI consent history", exact: true })
      .waitFor();
    await page.getByTestId("privacy-consent-row").first().waitFor();
    assert.ok(
      (await page.getByTestId("privacy-consent-row").count()) >= 3,
      "the consent history should list every approved request"
    );
    await assertPageStructure(page, "privacy center with AI consents");

    await page.getByRole("button", { name: "Delete all data" }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Delete everything" }).click();
    await page.getByText("All local data was deleted.", { exact: true }).waitFor();
    await page
      .getByText("No AI requests have been approved yet.", { exact: true })
      .waitFor();
    assert.equal(await page.getByTestId("privacy-consent-row").count(), 0);
    checks.push("delete-all clears AI consent history");

    await page.goto(`${server.base}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await page.getByText("No providers configured.", { exact: true }).waitFor();
    await page.getByText("No session credentials.", { exact: true }).waitFor();
    await page.getByTestId("vault-setup-passphrase").waitFor();
    assert.equal(await page.getByTestId("ai-enabled").isChecked(), false);
    assert.equal(await page.locator('[data-testid^="provider-row-"]').count(), 0);
    await assertPageStructure(page, "settings after delete-all");

    await page.goto(`${server.base}/ai`, { waitUntil: "networkidle" });
    await page.getByText("AI is off", { exact: true }).waitFor();
    assert.equal(mock.requests.length, 3, "delete-all must not send a request");
    await assertPageStructure(page, "AI console after delete-all");
    checks.push(
      "delete-all removes provider config, vault, consents, and the enabled flag"
    );

    assert.deepEqual(errors, [], "console errors");

    console.log(
      JSON.stringify(
        {
          checks,
          requests: mock.requests.length,
          errors,
        },
        null,
        2
      )
    );
  } finally {
    await context.close();
    await browser.close();
    await server.stop();
    await mock.stop();
  }
}

await run();
