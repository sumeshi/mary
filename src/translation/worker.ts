/**
 * English-to-Japanese translation worker.
 *
 * Uses the multilingual M2M100 model. Translation calls must specify
 * `src_lang: 'en'` and `tgt_lang: 'ja'` because the model supports many languages.
 */

import {
  env,
  pipeline,
  type ProgressInfo,
  type TranslationPipeline,
} from '@huggingface/transformers';
import { TRANSLATION_MODEL_ID, TRANSLATION_MODEL_REVISION } from '../models';
import { ortWasmPaths } from '../platform/ort';

type WorkerState = 'loading' | 'ready' | 'error';

type InMessage =
  | { type: 'load' }
  | { type: 'translate'; id: string; text: string }
  | { type: 'dispose' };

type OutMessage =
  | { type: 'state'; state: WorkerState }
  | { type: 'progress'; loaded: number; total?: number; file?: string }
  | { type: 'result'; id: string; text: string }
  | { type: 'error'; id?: string | null; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

// Translation runs on a single ONNX Runtime thread so speech recognition keeps CPU priority.
// Pin every model file to the same revision. Passing `revision` alone left
// some tokenizer files on `main`, which broke offline loading.
env.remotePathTemplate = `{model}/resolve/${TRANSLATION_MODEL_REVISION}/`;
env.allowLocalModels = false;
env.useBrowserCache = true;
// Hugging Face returns 404 without CORS headers when the request carries a
// *.workers.dev Referer. Omit the referrer for model downloads so the app
// works from workers.dev as well as pages.dev and custom domains.
env.fetch = (input, init) =>
  fetch(input, { ...init, referrerPolicy: 'no-referrer' });
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.backends.onnx.wasm!.wasmPaths = ortWasmPaths(import.meta.env.BASE_URL);

let translator: TranslationPipeline | null = null;
let loadPromise: Promise<TranslationPipeline> | null = null;
let disposed = false;
let chain: Promise<void> = Promise.resolve();
const fileProgress = new Map<string, { loaded: number; total?: number }>();

function post(message: OutMessage): void {
  if (!disposed) scope.postMessage(message);
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Translation failed.';
}

function reportProgress(info: ProgressInfo): void {
  if (info.status !== 'progress') return;

  fileProgress.set(info.file, {
    loaded: info.loaded,
    total: info.total > 0 ? info.total : undefined,
  });

  let loaded = 0;
  let total = 0;
  let complete = fileProgress.size > 0;
  for (const file of fileProgress.values()) {
    loaded += file.loaded;
    if (file.total === undefined) complete = false;
    else total += file.total;
  }

  if (complete) {
    post({ type: 'progress', loaded, total });
  } else {
    post({
      type: 'progress',
      loaded: info.loaded,
      total: info.total > 0 ? info.total : undefined,
      file: info.file,
    });
  }
}

function load(): Promise<TranslationPipeline> {
  if (translator) return Promise.resolve(translator);
  if (loadPromise) return loadPromise;

  fileProgress.clear();
  post({ type: 'state', state: 'loading' });
  loadPromise = pipeline('translation', TRANSLATION_MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: reportProgress,
  }).then(
    (created) => {
      if (disposed) {
        void created.dispose();
        throw new Error('Translation worker was disposed.');
      }
      translator = created;
      post({ type: 'state', state: 'ready' });
      return created;
    },
    (error: unknown) => {
      loadPromise = null;
      fileProgress.clear();
      throw error;
    },
  );
  return loadPromise;
}

async function translate(id: string, text: string): Promise<void> {
  const input = text.trim();
  if (!input) {
    // The app treats an empty translation as a failure, so report it as an error
    // instead of spending inference time on an empty prompt.
    post({ type: 'error', id, message: 'No text to translate.' });
    return;
  }

  const active = translator ?? (loadPromise ? await loadPromise : null);
  if (!active || disposed) throw new Error('Translation model is not loaded.');

  const output = await active(input, {
    src_lang: 'en',
    tgt_lang: 'ja',
    max_new_tokens: 128,
  });
  if (disposed) return;

  const translation = output[0]?.translation_text ?? '';
  if (!translation.trim()) {
    post({ type: 'error', id, message: 'Translation returned an empty result.' });
    return;
  }

  post({ type: 'result', id, text: translation });
}

async function runTranslation(id: string, text: string): Promise<void> {
  try {
    await translate(id, text);
  } catch (error) {
    post({ type: 'error', id, message: describeError(error) });
    if (!translator) post({ type: 'state', state: 'error' });
  }
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  const current = translator;
  translator = null;
  loadPromise = null;
  fileProgress.clear();
  if (current) void current.dispose();
  scope.close();
}

scope.onmessage = (event: MessageEvent<InMessage>): void => {
  if (disposed) return;
  try {
    const message = event.data;
    switch (message.type) {
      case 'load':
        void load().catch((error: unknown) => {
          post({ type: 'error', id: null, message: describeError(error) });
          post({ type: 'state', state: 'error' });
        });
        break;
      case 'translate':
        chain = chain
          .then(() => runTranslation(message.id, message.text))
          .catch(() => undefined);
        break;
      case 'dispose':
        dispose();
        break;
    }
  } catch (error) {
    post({ type: 'error', id: null, message: describeError(error) });
  }
};
