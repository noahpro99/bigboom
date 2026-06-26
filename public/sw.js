/* BigBoom service worker — makes the app installable and offline-capable.
 *
 * Strategy (runtime caching, no build-time manifest needed):
 *   - App shell / navigations: network-first, falling back to a cached
 *     page so /offline (and /) open with no connection.
 *   - Static assets (JS/CSS/fonts/images/sounds): stale-while-revalidate
 *     so they're instant and available offline after the first visit.
 *   - Everything else (TanStack server-function calls — the ONLINE game's
 *     polling + mutations) is left untouched: it goes straight to the
 *     network and is never cached, so online play is never served stale
 *     state. Offline play needs no network at all.
 *
 * Because offline mode is fully client-side and deterministic from the
 * seed, the first online visit primes the cache and every later visit
 * works with the radio off. */
const CACHE = "bigboom-v4";

// Best-effort precache of the two entry pages + icon. addAll is allowed to
// fail (e.g. behind auth or transient errors) without aborting install.
const PRECACHE_URLS = ["/", "/lobby", "/images/icon.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Path patterns we treat as cacheable static assets.
const ASSET_RE = /^\/(assets|_build|images|sounds)\//;
const ASSET_EXT_RE = /\.(js|mjs|css|woff2?|ttf|otf|png|jpe?g|svg|gif|webp|ico|ogg|mp3|wav|webmanifest)$/i;
// Vite dev-mode virtual modules — same stale-while-revalidate treatment so
// the app shell works offline after the first online visit in dev too.
// Note: /@react-refresh has no trailing slash, so we match on boundary.
const VITE_RE = /^\/@(?:id|vite|fs|react-refresh)([/?]|$)/;

function isAsset(url) {
  return (
    ASSET_RE.test(url.pathname) ||
    ASSET_EXT_RE.test(url.pathname) ||
    VITE_RE.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch server-fn POSTs
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // third-party: passthrough

  // Page navigations — network-first with an offline shell fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(req)) ||
            (await cache.match("/lobby")) ||
            (await cache.match("/")) ||
            new Response("Offline", { status: 503, statusText: "Offline" })
          );
        }
      })()
    );
    return;
  }

  // Static assets — stale-while-revalidate.
  if (isAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
    return;
  }

  // Anything else (server functions, etc.) — default network handling.
});
