import {
  APP_CACHE_PREFIX,
  ASR_MODELS,
  getAsrModel,
  MOONSHINE_CACHE,
  RUNTIME_CACHE,
  TRANSFORMERS_CACHE,
  TRANSLATION_MODEL_ID,
  TRANSLATION_MODEL_REVISION,
} from '../models';
import type { AsrModelInfo, ModelFile } from '../models';
import type { AsrModelId, DownloadProgress, ModelStatus } from '../types';
import { ortWasmSuffix } from '../platform/ort';

const MOONSHINE_MODEL_PREFIX = 'https://download.moonshine.ai/model/';

const ENCODER_ONNX = /^encoder.*\.onnx$/i;
const DECODER_ONNX = /^decoder.*\.onnx$/i;

function cacheStorageAvailable(): boolean {
  return typeof caches !== 'undefined';
}

async function openCache(name: string): Promise<Cache | null> {
  if (!cacheStorageAvailable()) return null;
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

/** Read-only access that does not create an empty bucket on first inspection. */
async function openExistingCache(name: string): Promise<Cache | null> {
  if (!cacheStorageAvailable()) return null;
  try {
    if (!(await caches.has(name))) return null;
    return await caches.open(name);
  } catch {
    return null;
  }
}

function asrFileUrl(model: AsrModelInfo, file: ModelFile): string {
  return `${model.baseUrl}/${file.name}`;
}

/**
 * Resolve a public asset against the deployed base path. `location.href` is the
 * page URL here, so a relative Vite base such as `./` also works.
 */
function publicUrl(path: string): string {
  const base = new URL(import.meta.env.BASE_URL, location.href);
  return new URL(path, base).href;
}

function fileNameFromUrl(url: string): string {
  const path = url.split(/[?#]/, 1)[0];
  const name = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

async function cachedResponseBytes(response: Response): Promise<number> {
  // Prefer the stored metadata; Blob.size is the fallback and does not copy the
  // bytes into an ArrayBuffer.
  const declared = response.headers.get('content-length');
  if (declared) {
    const size = Number(declared);
    if (Number.isFinite(size) && size >= 0) return size;
  }
  const blob = await response.blob();
  return blob.size;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('The model download was aborted.', 'AbortError');
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readResponseBody(
  response: Response,
  onChunk: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  if (!response.body) return 0;
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        onChunk(value.byteLength);
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return received;
}

/** Every manifest file is present in the Moonshine cache bucket. */
export async function getAsrModelStatus(id: AsrModelId): Promise<ModelStatus> {
  const model = getAsrModel(id);
  const cache = await openExistingCache(MOONSHINE_CACHE);
  if (!cache) return { cached: false, bytes: 0 };

  let bytes = 0;
  let complete = true;
  for (const file of model.files) {
    const hit = await cache.match(asrFileUrl(model, file));
    if (hit) {
      bytes += file.size;
    } else {
      complete = false;
    }
  }
  return { cached: complete, bytes };
}

/**
 * Populate the bucket that the Moonshine SDK reads from. Existing files are
 * reused so an interrupted download can resume without fetching them again.
 */
export async function downloadAsrModel(
  id: AsrModelId,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const model = getAsrModel(id);
  throwIfAborted(signal);
  if (!cacheStorageAvailable()) {
    throw new Error('Cache Storage is not available. Model downloads need a secure browser context.');
  }
  const cache = await openCache(MOONSHINE_CACHE);
  if (!cache) {
    throw new Error('Could not open the model cache. Storage may be unavailable or blocked.');
  }

  const total = model.sizeBytes;
  const missing: Array<{ file: ModelFile; url: string }> = [];
  let completedBytes = 0;
  let lastReportAt = 0;

  // Chunk-level progress can fire thousands of times for a large model; keep
  // UI updates to roughly ten per second and always report file boundaries.
  const report = (progress: DownloadProgress, force = false): void => {
    const now = Date.now();
    if (!force && now - lastReportAt < 100) return;
    lastReportAt = now;
    onProgress(progress);
  };

  for (const file of model.files) {
    const url = asrFileUrl(model, file);
    if (await cache.match(url)) {
      completedBytes += file.size;
    } else {
      missing.push({ file, url });
    }
  }

  report({ loaded: completedBytes, total }, true);
  throwIfAborted(signal);

  for (const { file, url } of missing) {
    throwIfAborted(signal);
    report({ loaded: completedBytes, total, file: file.name }, true);

    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error(
        `Network error while downloading ${file.name}: ${errorMessage(error)}. Check your connection and try again.`,
      );
    }

    if (!response.ok) {
      throw new Error(`Failed to download ${file.name} (HTTP ${response.status}).`);
    }
    if (response.type === 'opaque') {
      throw new Error(`Failed to download ${file.name}: the server did not allow cross-origin access.`);
    }

    let fileLoaded = 0;
    let written = 0;
    let putPromise: Promise<void> | null = null;

    try {
      // Start writing the clone while the original body is streamed for
      // progress. Reading both branches concurrently avoids buffering the
      // whole model file in memory.
      putPromise = cache.put(url, response.clone());
      written = await readResponseBody(
        response,
        (bytes) => {
          fileLoaded += bytes;
          report({ loaded: completedBytes + fileLoaded, total, file: file.name });
        },
        signal,
      );
      await putPromise;
    } catch (error) {
      await putPromise?.catch(() => undefined);
      await cache.delete(url).catch(() => undefined);
      if (isAbortError(error)) throw error;
      if (isQuotaError(error)) {
        throw new Error(
          `Not enough storage space to save ${file.name}. Free device space and try again.`,
        );
      }
      if (error instanceof TypeError) {
        throw new Error(
          `Network error while downloading ${file.name}: ${errorMessage(error)}. Check your connection and try again.`,
        );
      }
      throw new Error(`Failed to save ${file.name}: ${errorMessage(error)}`);
    }

    if (written !== file.size) {
      await cache.delete(url).catch(() => undefined);
      throw new Error(
        `Size mismatch while downloading ${file.name}: expected ${file.size} bytes, received ${written}.`,
      );
    }

    completedBytes += written;
    report({ loaded: completedBytes, total, file: file.name }, true);
  }
}

/** Remove only the files belonging to one ASR model. */
export async function deleteAsrModel(id: AsrModelId): Promise<void> {
  const model = getAsrModel(id);
  const cache = await openExistingCache(MOONSHINE_CACHE);
  if (!cache) return;
  await Promise.all(model.files.map((file) => cache.delete(asrFileUrl(model, file))));
}

/** Drop CDN models from older Moonshine releases. */
export async function pruneAsrCache(): Promise<void> {
  const cache = await openExistingCache(MOONSHINE_CACHE);
  if (!cache) return;

  const keep = new Set<string>();
  for (const model of ASR_MODELS) {
    for (const file of model.files) {
      keep.add(asrFileUrl(model, file));
    }
  }

  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => request.url.startsWith(MOONSHINE_MODEL_PREFIX) && !keep.has(request.url))
      .map((request) => cache.delete(request)),
  );
}

/**
 * The SDK needs `config.json`, the tokenizer pair, and one encoder plus one
 * decoder ONNX file. Partial or interrupted downloads are not considered ready.
 */
export async function getTranslationModelStatus(): Promise<ModelStatus> {
  const cache = await openExistingCache(TRANSFORMERS_CACHE);
  if (!cache) return { cached: false, bytes: 0 };

  const requests = (await cache.keys()).filter(
    (request) =>
      request.url.includes(TRANSLATION_MODEL_ID) &&
      request.url.includes(TRANSLATION_MODEL_REVISION),
  );

  let bytes = 0;
  let hasConfig = false;
  let hasTokenizer = false;
  let hasTokenizerConfig = false;
  let hasEncoder = false;
  let hasDecoder = false;

  for (const request of requests) {
    const response = await cache.match(request);
    if (!response) continue;
    bytes += await cachedResponseBytes(response);

    const name = fileNameFromUrl(request.url);
    if (name === 'config.json') {
      hasConfig = true;
    } else if (name === 'tokenizer.json') {
      hasTokenizer = true;
    } else if (name === 'tokenizer_config.json') {
      hasTokenizerConfig = true;
    } else if (ENCODER_ONNX.test(name)) {
      hasEncoder = true;
    } else if (DECODER_ONNX.test(name)) {
      hasDecoder = true;
    }
  }

  return {
    cached: hasConfig && hasTokenizer && hasTokenizerConfig && hasEncoder && hasDecoder,
    bytes,
  };
}

/** Remove only this model's entries from the Transformers.js cache. */
export async function deleteTranslationModel(): Promise<void> {
  const cache = await openExistingCache(TRANSFORMERS_CACHE);
  if (!cache) return;
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => request.url.includes(TRANSLATION_MODEL_ID))
      .map((request) => cache.delete(request)),
  );
}

/** Drop translation files from older pinned revisions. */
export async function pruneTranslationCache(): Promise<void> {
  const cache = await openExistingCache(TRANSFORMERS_CACHE);
  if (!cache) return;
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter(
        (request) =>
          request.url.includes(TRANSLATION_MODEL_ID) &&
          !request.url.includes(TRANSLATION_MODEL_REVISION),
      )
      .map((request) => cache.delete(request)),
  );
}

async function isPrecached(url: string): Promise<boolean> {
  if (!cacheStorageAvailable()) return false;
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith(APP_CACHE_PREFIX));
    for (const name of names) {
      const cache = await caches.open(name);
      if (await cache.match(url, { ignoreSearch: true, ignoreVary: true })) return true;
    }
  } catch {
    // Treat an unreadable precache as missing.
  }
  return false;
}

async function isCachedIn(cacheName: string, url: string): Promise<boolean> {
  const cache = await openExistingCache(cacheName);
  if (!cache) return false;
  return (await cache.match(url, { ignoreVary: true })) !== undefined;
}

/**
 * Offline translation needs the ONNX Runtime wasm (runtime cached on first
 * use) and its loader module (precached by Vite). Transformers.js may also
 * have cached the pair itself, so accept either copy.
 */
export async function isTranslationRuntimeCached(): Promise<boolean> {
  const suffix = ortWasmSuffix();
  const wasmUrl = publicUrl(`ort/ort-wasm-simd-threaded${suffix}.wasm`);
  const loaderUrl = publicUrl(`ort/ort-wasm-simd-threaded${suffix}.mjs`);

  const wasmReady =
    (await isCachedIn(RUNTIME_CACHE, wasmUrl)) || (await isCachedIn(TRANSFORMERS_CACHE, wasmUrl));
  if (!wasmReady) return false;

  return (
    (await isCachedIn(RUNTIME_CACHE, loaderUrl)) ||
    (await isCachedIn(TRANSFORMERS_CACHE, loaderUrl)) ||
    isPrecached(loaderUrl)
  );
}

/** The Workbox precache contains the app shell, including index.html. */
export async function isAppCached(): Promise<boolean> {
  if (!cacheStorageAvailable()) return false;
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith(APP_CACHE_PREFIX));
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      for (const request of requests) {
        const path = new URL(request.url).pathname;
        if (path.endsWith('/index.html') || path.endsWith('/')) return true;
      }
    }
  } catch {
    // Storage access can fail in restricted browsing modes.
  }
  return false;
}

/** Ask the browser to keep model caches when storage is reclaimed. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    const storage = navigator.storage;
    if (!storage || typeof storage.persist !== 'function') return false;
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
