(() => {
  "use strict";

  const MAX_MESSAGE_BYTES = 64 * 1024;
  const encoder = new TextEncoder();
  const BLOCKED_GLOBALS = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "WebTransport",
    "RTCPeerConnection",
    "Worker",
    "SharedWorker",
    "BroadcastChannel",
    "importScripts",
    "indexedDB",
    "caches",
  ];

  let port = null;
  let hostOrigin = null;
  let worker = null;
  let workerUrl = null;
  let heartbeatTimer = null;

  function postToHost(message) {
    if (port !== null) {
      port.postMessage(message);
    }
  }

  function report(code, message) {
    postToHost({ type: "worker:error", code, message });
  }

  function messageBytes(value) {
    try {
      const json = JSON.stringify(value);

      return json === undefined ? null : encoder.encode(json).byteLength;
    } catch {
      return null;
    }
  }

  function stopHeartbeat() {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function terminateWorker() {
    stopHeartbeat();
    if (worker !== null) {
      worker.terminate();
      worker = null;
    }

    if (workerUrl !== null) {
      URL.revokeObjectURL(workerUrl);
      workerUrl = null;
    }
  }

  function buildPrelude() {
    return [
      '"use strict";',
      "(() => {",
      `const blocked = ${JSON.stringify(BLOCKED_GLOBALS)};`,
      "for (const name of blocked) {",
      "  try {",
      "    Object.defineProperty(self, name, {",
      "      value: undefined,",
      "      configurable: false,",
      "      writable: false,",
      "    });",
      "  } catch {",
      "    try { self[name] = undefined; } catch {}",
      "  }",
      "}",
      "const pending = new Map();",
      "let nextId = 1;",
      "let actionHandler = null;",
      "let readySent = false;",
      "const report = (error) => {",
      "  const message = error instanceof Error ? error.message : 'Extension failed';",
      "  self.postMessage({",
      "    type: 'worker:error',",
      "    code: 'worker_error',",
      "    message: String(message).slice(0, 2000),",
      "  });",
      "};",
      "const call = (method, params = {}) =>",
      "  new Promise((resolve, reject) => {",
      "    if (typeof method !== 'string' || method.length === 0) {",
      "      reject(new TypeError('Invalid method'));",
      "      return;",
      "    }",
      "    if (params === null || typeof params !== 'object' || Array.isArray(params)) {",
      "      reject(new TypeError('Invalid params'));",
      "      return;",
      "    }",
      "    const id = String(nextId++);",
      "    pending.set(id, { resolve, reject });",
      "    self.postMessage({ type: 'worker:request', id, method, params });",
      "  });",
      "const ready = () => {",
      "  if (readySent) return;",
      "  readySent = true;",
      "  self.postMessage({ type: 'worker:ready' });",
      "};",
      "const render = (tree) => {",
      "  self.postMessage({ type: 'worker:ui', tree });",
      "};",
      "const onAction = (handler) => {",
      "  if (typeof handler !== 'function') {",
      "    throw new TypeError('Invalid action handler');",
      "  }",
      "  actionHandler = handler;",
      "};",
      "const register = (fn) => {",
      "  if (typeof fn !== 'function') {",
      "    throw new TypeError('Invalid entry point');",
      "  }",
      "  Promise.resolve().then(fn).catch(report);",
      "};",
      "self.onmessage = (event) => {",
      "  const message = event.data;",
      "  if (message === null || typeof message !== 'object') return;",
      "  if (message.type === 'worker:response') {",
      "    const entry = pending.get(message.id);",
      "    if (!entry) return;",
      "    pending.delete(message.id);",
      "    if (message.ok === true) {",
      "      entry.resolve(message.result);",
      "      return;",
      "    }",
      "    const error = new Error(",
      "      message.error && message.error.message",
      "        ? message.error.message",
      "        : 'Request failed'",
      "    );",
      "    error.code =",
      "      message.error && message.error.code ? message.error.code : 'protocol_error';",
      "    entry.reject(error);",
      "    return;",
      "  }",
      "  if (message.type === 'host:action' && actionHandler !== null) {",
      "    try {",
      "      actionHandler(message.actionId);",
      "    } catch (error) {",
      "      report(error);",
      "    }",
      "  }",
      "};",
      "Object.defineProperty(self, 'opennest', {",
      "  value: Object.freeze({ register, call, render, onAction, ready }),",
      "  configurable: false,",
      "  writable: false,",
      "});",
      "})();",
      "",
    ].join("\n");
  }

  function forwardToHost(message) {
    const bytes = messageBytes(message);

    if (bytes === null || bytes > MAX_MESSAGE_BYTES) {
      report("message_too_large", "Extension message exceeded the size limit.");
      terminateWorker();
      return;
    }

    postToHost(message);
  }

  function startWorker(code) {
    terminateWorker();

    const blob = new Blob([buildPrelude(), code], {
      type: "text/javascript",
    });
    const nextUrl = URL.createObjectURL(blob);

    workerUrl = nextUrl;
    worker = new Worker(nextUrl);
    worker.onmessage = (event) => {
      forwardToHost(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      report("worker_error", "Extension worker failed.");
      terminateWorker();
    };
    worker.onmessageerror = () => {
      report("worker_error", "Extension worker sent an unreadable message.");
    };
    heartbeatTimer = setInterval(() => {
      postToHost({ type: "worker:heartbeat" });
    }, 1000);
  }

  function handlePortMessage(event) {
    const message = event.data;

    if (message === null || typeof message !== "object") {
      report("protocol_error", "Invalid host message.");
      return;
    }

    if (message.type === "host:start") {
      if (typeof message.code !== "string" || message.code.length === 0) {
        report("protocol_error", "Invalid extension code.");
        return;
      }

      startWorker(message.code);
      return;
    }

    if (message.type === "host:terminate") {
      terminateWorker();

      if (port !== null) {
        port.close();
        port = null;
      }

      return;
    }

    if (message.type === "host:action" && worker !== null) {
      worker.postMessage({ type: "host:action", actionId: message.actionId });
      return;
    }

    if (message.type === "worker:response" && worker !== null) {
      worker.postMessage(message);
      return;
    }

    report("protocol_error", "Unknown host message.");
  }

  parent.postMessage({ type: "shell:ready" }, "*");

  window.addEventListener("message", (event) => {
    if (event.source !== parent) {
      return;
    }

    if (hostOrigin !== null && event.origin !== hostOrigin) {
      return;
    }

    if (port !== null) {
      return;
    }

    const message = event.data;

    if (
      message === null ||
      typeof message !== "object" ||
      message.type !== "opennest:init" ||
      typeof message.hostOrigin !== "string" ||
      event.origin !== message.hostOrigin
    ) {
      return;
    }

    const nextPort = event.ports[0];

    if (nextPort === undefined) {
      return;
    }

    hostOrigin = message.hostOrigin;
    port = nextPort;
    port.onmessage = handlePortMessage;
    port.start();
  });

  window.addEventListener("pagehide", () => {
    terminateWorker();

    if (port !== null) {
      port.close();
      port = null;
    }
  });
})();
