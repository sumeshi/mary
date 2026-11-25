import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
} from 'workbox-precaching';
import type { PrecacheEntry } from 'workbox-precaching';
import { RUNTIME_CACHE } from '../models';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

const INDEX_URL = new URL('index.html', self.registration.scope).href;
const ORT_PREFIX = new URL('ort/', self.registration.scope).pathname;

function isScriptRequest(request: Request): boolean {
  const destination = request.destination;
  return destination === 'script' || destination === 'worker' || destination === 'sharedworker';
}

/**
 * Rebuild the response with isolation headers. The body, status, and original
 * headers are preserved; opaque and failed responses cannot be rebuilt.
 */
function withIsolationHeaders(response: Response): Response {
  if (
    response.status === 0 ||
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304 ||
    response.type === 'error' ||
    response.type === 'opaque' ||
    response.type === 'opaqueredirect'
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function openRuntimeCache(): Promise<Cache | null> {
  try {
    return await caches.open(RUNTIME_CACHE);
  } catch {
    return null;
  }
}

async function handleNavigation(request: Request): Promise<Response> {
  const cached = await matchPrecache(INDEX_URL);
  if (cached) return withIsolationHeaders(cached);
  return withIsolationHeaders(await fetch(request));
}

async function handleScript(request: Request): Promise<Response> {
  const precached = await matchPrecache(request);
  if (precached) return withIsolationHeaders(precached);

  const cache = await openRuntimeCache();
  if (cache) {
    const cached = await cache.match(request);
    if (cached) return withIsolationHeaders(cached);
  }

  return withIsolationHeaders(await fetch(request));
}

async function handleOrt(event: FetchEvent, request: Request): Promise<Response> {
  // A range request must not be served from (or written to) a full-file cache.
  const cacheable = !request.headers.has('range');
  const cache = await openRuntimeCache();

  if (cacheable) {
    const precached = await matchPrecache(request);
    if (precached) return withIsolationHeaders(precached);

    if (cache) {
      const cached = await cache.match(request);
      if (cached) return withIsolationHeaders(cached);
    }
  }

  const response = await fetch(request);
  if (cacheable && cache && response.ok && response.status === 200) {
    const copy = response.clone();
    event.waitUntil(cache.put(request, copy).catch(() => undefined));
  }
  return withIsolationHeaders(response);
}

/**
 * Registered before Workbox's precache route so the isolation headers can be
 * added to documents, scripts, and workers. Moonshine and Hugging Face model
 * requests are cross-origin and deliberately left to their SDK caches.
 */
function handleFetch(event: FetchEvent): void {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin) return;

  const navigation = request.mode === 'navigate' || request.destination === 'document';
  const ort = url.pathname.startsWith(ORT_PREFIX);
  const script = isScriptRequest(request);
  if (!navigation && !ort && !script) return;

  let response: Promise<Response>;
  if (navigation) {
    response = handleNavigation(request);
  } else if (ort) {
    response = handleOrt(event, request);
  } else {
    response = handleScript(request);
  }

  event.respondWith(response);
  // Workbox's precache route would otherwise respond to the same event again.
  event.stopImmediatePropagation();
}

self.addEventListener('fetch', handleFetch);

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
void self.skipWaiting();
clientsClaim();
