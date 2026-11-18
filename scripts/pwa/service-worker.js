const VERSION = "__PWA_VERSION__";
const PRECACHE = __PWA_PRECACHE__;

const CACHE_PREFIX = "opennest-";
const PRECACHE_CACHE = `${CACHE_PREFIX}precache-${VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${VERSION}`;
const OFFLINE_URL = "/offline";
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE_CACHE);
      await cache.addAll(PRECACHE.map((path) => new Request(path, { cache: "reload" })));
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(CACHE_PREFIX) &&
              key !== PRECACHE_CACHE &&
              key !== RUNTIME_CACHE
          )
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.headers.has("range") || request.headers.has("authorization")) {
    return;
  }

  if (
    url.pathname === "/sw.js" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/image")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/extension-sandbox.js"
  ) {
    event.respondWith(handleStatic(request));
    return;
  }

  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    event.respondWith(handleNetworkFirst(request));
  }
});

async function handleNavigation(request) {
  const cached = await caches.match(request, { ignoreSearch: true });

  try {
    const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);

    if (isCacheable(response)) {
      await remember(request, response);
    }

    return response;
  } catch {
    if (cached !== undefined) {
      return cached;
    }

    const offline = await caches.match(OFFLINE_URL);

    return offline ?? new Response(null, { status: 503 });
  }
}

async function handleStatic(request) {
  const cached = await caches.match(request);

  if (cached !== undefined) {
    return cached;
  }

  const response = await fetch(request);

  if (isCacheable(response) && response.type === "basic") {
    await remember(request, response);
  }

  return response;
}

async function handleNetworkFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });

  try {
    const response = await fetch(request);

    if (isCacheable(response)) {
      await remember(request, response);
    }

    return response;
  } catch (error) {
    if (cached !== undefined) {
      return cached;
    }

    throw error;
  }
}

async function remember(request, response) {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  } catch {}
}

function isCacheable(response) {
  if (!response.ok) {
    return false;
  }

  const cacheControl = response.headers.get("cache-control") ?? "";

  return !/(?:no-store|private)/i.test(cacheControl);
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
