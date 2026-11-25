/**
 * ONNX Runtime Web ships several WASM variants. Chromium handles the JSEP
 * build used by onnxruntime-web's WebGPU bundle; other engines (notably Safari)
 * get the plain SIMD/threaded build, which is also the smaller one.
 */
export type OrtWasmSuffix = '' | '.jsep';

export function ortWasmSuffix(): OrtWasmSuffix {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  const iOS =
    /iPhone|iPad|iPod/.test(agent) ||
    (platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1);
  if (iOS) return '';
  const chromium = /Chrome|Chromium|CriOS|Edg\//.test(agent) && !/OPR\//.test(agent);
  return chromium ? '.jsep' : '';
}

export function ortWasmPaths(baseUrl: string): { mjs: string; wasm: string } {
  const suffix = ortWasmSuffix();
  return {
    mjs: new URL(`${baseUrl}ort/ort-wasm-simd-threaded${suffix}.mjs`, location.origin).href,
    wasm: new URL(`${baseUrl}ort/ort-wasm-simd-threaded${suffix}.wasm`, location.origin).href,
  };
}
