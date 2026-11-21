export const AI_CONNECT_SOURCES = "https: http://localhost:* http://127.0.0.1:*";

export function buildContentSecurityPolicy(options = {}) {
  const development = options.development ?? process.env.NODE_ENV !== "production";

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    `connect-src 'self' ${AI_CONNECT_SOURCES}${development ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
