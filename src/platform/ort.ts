/**
 * ONNX Runtime Web ships a larger JSEP build for WebGPU. Mary's translation
 * pipeline runs on the WASM execution provider, and the plain SIMD/threaded
 * build keeps every deployment asset under Cloudflare's 25 MiB file limit.
 */
export function ortWasmPaths(baseUrl: string): { mjs: string; wasm: string } {
  return {
    mjs: new URL(`${baseUrl}ort/ort-wasm-simd-threaded.mjs`, location.origin).href,
    wasm: new URL(`${baseUrl}ort/ort-wasm-simd-threaded.wasm`, location.origin).href,
  };
}
