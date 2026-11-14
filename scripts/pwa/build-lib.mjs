import { createHash } from "node:crypto";

function requirePlaceholder(template, placeholder) {
  if (!template.includes(placeholder)) {
    throw new Error(`Service worker template is missing ${placeholder}`);
  }
}

export function uniquePaths(paths) {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

export function createVersion(parts) {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

export function renderServiceWorker({ template, version, precache }) {
  requirePlaceholder(template, "__PWA_VERSION__");
  requirePlaceholder(template, "__PWA_PRECACHE__");

  const source = template
    .replaceAll("__PWA_VERSION__", version)
    .replaceAll("__PWA_PRECACHE__", JSON.stringify(uniquePaths(precache)));

  if (source.includes("__PWA_")) {
    throw new Error("Service worker template contains an unresolved placeholder");
  }

  return source;
}
