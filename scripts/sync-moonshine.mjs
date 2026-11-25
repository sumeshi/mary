import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const moonshineSource = join(root, 'node_modules', '@moonshine-ai', 'moonshine-wasm', 'dist');
const moonshineTarget = join(root, 'public', 'moonshine');
const ortSource = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const ortTarget = join(root, 'public', 'ort');

async function copyMoonshine() {
  await rm(moonshineTarget, { recursive: true, force: true });
  await mkdir(moonshineTarget, { recursive: true });
  const files = await readdir(moonshineSource);
  for (const file of files) {
    if (!/\.(?:js|mjs|wasm)$/.test(file)) continue;
    await cp(join(moonshineSource, file), join(moonshineTarget, file));
  }
}

async function copyOrt() {
  await rm(ortTarget, { recursive: true, force: true });
  await mkdir(ortTarget, { recursive: true });
  for (const file of [
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
  ]) {
    await cp(join(ortSource, file), join(ortTarget, file));
  }
}

await copyMoonshine();
await copyOrt();
