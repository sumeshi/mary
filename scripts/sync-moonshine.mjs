import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const moonshineSource = join(root, 'node_modules', '@moonshine-ai', 'moonshine-wasm', 'dist');
const moonshineTarget = join(root, 'public', 'moonshine');
// Resolve through Transformers.js so pnpm's isolated node_modules still finds
// the ONNX Runtime build that matches the installed package.
const transformersRequire = createRequire(
  realpathSync(join(root, 'node_modules', '@huggingface', 'transformers', 'package.json')),
);
const ortSource = dirname(transformersRequire.resolve('onnxruntime-web'));
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
  ]) {
    await cp(join(ortSource, file), join(ortTarget, file));
  }
}

await copyMoonshine();
await copyOrt();
