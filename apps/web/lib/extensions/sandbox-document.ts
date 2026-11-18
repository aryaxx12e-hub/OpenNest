const SCRIPT_PATH = "/extension-sandbox.js";

function normalizeOrigin(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Extension sandbox origin is invalid.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Extension sandbox origin must use HTTP or HTTPS.");
  }

  if (url.origin !== value) {
    throw new Error("Extension sandbox origin must be a bare origin.");
  }

  return url.origin;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildExtensionSandboxDocument(origin: string): string {
  const normalized = normalizeOrigin(origin);
  const csp = [
    "default-src 'none'",
    `script-src ${normalized}`,
    "worker-src blob:",
    "connect-src 'none'",
    "img-src 'none'",
    "style-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "manifest-src 'none'",
  ].join("; ");
  const scriptUrl = escapeAttribute(`${normalized}${SCRIPT_PATH}`);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>OpenNest extension sandbox</title>
</head>
<body>
<script src="${scriptUrl}"></script>
</body>
</html>`;
}
