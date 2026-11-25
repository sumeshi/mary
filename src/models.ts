import type { AsrModelId } from './types';

export interface ModelFile {
  name: string;
  size: number;
}

export interface AsrModelInfo {
  id: AsrModelId;
  arch: 2 | 4 | 5;
  label: string;
  params: string;
  wer: string;
  note: string;
  baseUrl: string;
  files: ModelFile[];
  sizeBytes: number;
}

const ENGLISH_RELEASE = 'quantized_26_07_30';

function model(id: AsrModelId, arch: 2 | 4 | 5, label: string, params: string, wer: string, note: string, files: ModelFile[]): AsrModelInfo {
  const baseUrl = `https://download.moonshine.ai/model/${id}-streaming-en/${ENGLISH_RELEASE}`;
  return {
    id,
    arch,
    label,
    params,
    wer,
    note,
    baseUrl,
    files,
    sizeBytes: files.reduce((sum, file) => sum + file.size, 0),
  };
}

/**
 * The English streaming catalog published with Moonshine WASM 0.1.6.
 * Keep this list in sync with the SDK's sttDependencies() manifest.
 */
export const ASR_MODELS: readonly AsrModelInfo[] = [
  model('tiny', 2, 'Tiny Streaming', '34M', '12.0%', 'Fastest, lower accuracy', [
    { name: 'adapter.ort', size: 1319664 },
    { name: 'cross_kv.ort', size: 1287544 },
    { name: 'decoder_kv.ort', size: 32583720 },
    { name: 'encoder.ort', size: 7675440 },
    { name: 'frontend.ort', size: 8324920 },
    { name: 'streaming_config.json', size: 509 },
    { name: 'tokenizer.bin', size: 249974 },
  ]),
  model('small', 4, 'Small Streaming', '123M', '7.84%', 'Balanced default', [
    { name: 'adapter.ort', size: 2870368 },
    { name: 'cross_kv.ort', size: 5356536 },
    { name: 'decoder_kv.ort', size: 81878600 },
    { name: 'encoder.ort', size: 44148576 },
    { name: 'frontend.ort', size: 30984520 },
    { name: 'streaming_config.json', size: 512 },
    { name: 'tokenizer.bin', size: 249974 },
  ]),
  model('medium', 5, 'Medium Streaming', '245M', '6.65%', 'Best accuracy, heaviest', [
    { name: 'adapter.ort', size: 3651296 },
    { name: 'cross_kv.ort', size: 11643776 },
    { name: 'decoder_kv.ort', size: 146972408 },
    { name: 'encoder.ort', size: 94705376 },
    { name: 'frontend.ort', size: 47567576 },
    { name: 'streaming_config.json', size: 513 },
    { name: 'tokenizer.bin', size: 249974 },
  ]),
];

export function getAsrModel(id: AsrModelId): AsrModelInfo {
  const found = ASR_MODELS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown speech recognition model: ${id}`);
  return found;
}

/**
 * The originally suggested Xenova/opus-mt-en-jap conversion produces unrelated
 * Japanese text, even from the original PyTorch checkpoint. M2M100 is larger
 * but translates reliably and is MIT licensed.
 */
export const TRANSLATION_MODEL_ID = 'Xenova/m2m100_418M';
/** Pinned so cache keys, tokenizer, and ONNX weights stay in step. */
export const TRANSLATION_MODEL_REVISION = '9c374f0b7aca709787cea97b047bfbbd1559d177';
/** Quantized encoder + merged decoder, plus tokenizer metadata. */
export const TRANSLATION_MODEL_BYTES = 639_976_029;

export const MOONSHINE_CACHE = 'moonshine-models-v1';
export const TRANSFORMERS_CACHE = 'transformers-cache';
export const RUNTIME_CACHE = 'mary-runtime-v1';
export const APP_CACHE_PREFIX = 'workbox-precache';

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function formatPercent(loaded: number, total?: number): number | undefined {
  if (!total || total <= 0) return undefined;
  return Math.min(100, Math.round((loaded / total) * 100));
}
