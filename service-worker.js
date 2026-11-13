// Bump this version whenever any shipped app or engine file changes.
const VERSION = "autocut-v1.2.0-rc.1";
const ROOT = new URL("./", self.location.href);
const CACHE = `${VERSION}-${ROOT.pathname}`;
// Core bytes are unchanged; do not discard the 31 MiB engine on shell updates.
const ENGINE_CACHE = `autocut-engine-0.12.10-${ROOT.pathname}`;
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./editor.js",
  "./media-engine.js",
  "./project-store.js",
  "./story.css",
  "./story.js",
  "./story-model.js",
  "./story-media.js",
  "./story-preview.js",
  "./story-export.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./vendor/ffmpeg/index.js",
  "./vendor/ffmpeg/classes.js",
  "./vendor/ffmpeg/const.js",
  "./vendor/ffmpeg/errors.js",
  "./vendor/ffmpeg/utils.js",
  "./vendor/ffmpeg/types.js",
  "./vendor/ffmpeg/worker.js",
  "./vendor/core/ffmpeg-core.js",
  "./THIRD_PARTY_NOTICES.md",
];
const ALLOWED = new Set(
  [...SHELL, "./vendor/core/ffmpeg-core.wasm"].map(
    (path) => new URL(path, ROOT).href,
  ),
);
self.addEventListener("install", (event) => {
  // Cache just the shell here. The 31 MB engine is cached on its first real use.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(SHELL.map((path) => new URL(path, ROOT).href)),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const wasm = new URL("./vendor/core/ffmpeg-core.wasm", ROOT).href;
      const engineCache = await caches.open(ENGINE_CACHE);
      if (!(await engineCache.match(wasm))) {
        for (const key of keys.filter(
          (key) =>
            key.startsWith("autocut-v1.1.0-increment-a.") &&
            key.endsWith(`-${ROOT.pathname}`),
        )) {
          const previous = await (await caches.open(key)).match(wasm);
          if (previous) {
            try {
              await engineCache.put(wasm, previous);
            } catch {
              /* Storage may be full; online use remains available. */
            }
            break;
          }
        }
      }
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith("autocut-") &&
              key.endsWith(`-${ROOT.pathname}`) &&
              key !== CACHE &&
              key !== ENGINE_CACHE,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== ROOT.origin)
    return;
  const pathname = new URL(request.url).pathname;
  const navigation =
    request.mode === "navigate" &&
    (pathname === ROOT.pathname ||
      pathname === new URL("./index.html", ROOT).pathname);
  if (!navigation && !ALLOWED.has(request.url)) return;
  let cacheCopy = null;
  const responsePromise = (async () => {
    try {
      const cache = await caches.open(
        request.url.endsWith("/ffmpeg-core.wasm") ? ENGINE_CACHE : CACHE,
      );
      const cached = await cache.match(
        navigation ? new URL("./index.html", ROOT).href : request,
      );
      if (cached) return cached;
    } catch {
      /* Storage denial must not break online editing. */
    }
    try {
      const response = await fetch(request);
      if (response.ok && ALLOWED.has(request.url)) cacheCopy = response.clone();
      return response;
    } catch {
      return Response.error();
    }
  })();
  event.respondWith(responsePromise);
  event.waitUntil(
    responsePromise.then(async () => {
      if (!cacheCopy) return;
      try {
        const cache = await caches.open(
          request.url.endsWith("/ffmpeg-core.wasm") ? ENGINE_CACHE : CACHE,
        );
        await cache.put(request, cacheCopy);
        if (request.url.endsWith("/ffmpeg-core.wasm")) {
          const clients = await self.clients.matchAll();
          clients.forEach((client) =>
            client.postMessage({ type: "ENGINE_CACHED" }),
          );
        }
      } catch {
        // Storage pressure must never prevent an online editing session.
      }
    }),
  );
});
