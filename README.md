# Mary

On-device real-time English captions with optional Japanese translation, built as a static PWA.

Mary listens through the microphone, transcribes English speech with [Moonshine Voice](https://github.com/moonshine-ai/moonshine) streaming models, and shows provisional and confirmed captions in a large, conference-friendly view. Japanese translations can be shown under confirmed English lines using [Transformers.js](https://huggingface.co/docs/transformers.js/). Audio and caption text never leave the device.

## Features

- Streaming English captions with provisional text and a confirmed history.
- Optional English-to-Japanese translation of confirmed lines only.
- Tiny, Small (default), and Medium streaming speech models.
- Offline operation after the app and models are downloaded once.
- Model download progress, per-model deletion, and an offline-readiness check.
- Light, dark, and system themes; four caption sizes.
- Installable PWA with a service worker and Screen Wake Lock support.
- No accounts, telemetry, audio recording, or external caption/translation services.

## Requirements

- Node.js 20.19 or newer (22.12+ recommended) for development.
- A modern browser with WebAssembly. iOS/iPadOS Safari 16.4 or newer is recommended.
- HTTPS (or `localhost`) for microphone access and service workers.
- Cross-origin isolation, as described below. The threaded Moonshine WASM runtime needs `SharedArrayBuffer`.

## Development

```bash
npm install
npm run dev
```

`npm run dev` copies the Moonshine WASM SDK and the ONNX Runtime WASM files into `public/` and starts Vite. The dev server sends the isolation headers, so no service-worker reload is needed while developing.

Build and preview:

```bash
npm run build
npm run preview
```

The production output is a set of static files in `dist/`.

## Deployment

### Cross-origin isolation

Speech recognition uses a threaded WebAssembly build. The page must be served with:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`public/_headers` contains these headers for hosts that support that file (Netlify, Cloudflare Pages). Configure the same headers on any other static host.

GitHub Pages cannot set response headers. In that case Mary's service worker adds the headers and the page reloads once after the worker takes control. Server-side headers are still preferred because they apply to the very first load.

### Sub-path deployments

For a project page such as `https://example.com/mary/`, build with the matching base:

```bash
BASE_URL=/mary/ npm run build
```

The default base is `/`.

## Offline use

1. Open Mary online and start captioning once so the selected speech model is cached. The default Small Streaming model is about 158 MB.
2. Optionally enable Japanese translation once (about 610 MB for the quantized translation model plus the local ONNX Runtime) and/or use **Settings → Offline → Prepare offline**.
3. After that, the app, the speech model, the translation model, and the inference runtime are available without a network connection.

Speech models are cached in Cache Storage under `moonshine-models-v1`; translation files use `transformers-cache`; the self-hosted ONNX Runtime is cached by the service worker. Settings show whether each piece is ready. Models can be deleted individually from Settings.

Browsers may evict site data under storage pressure. Mary requests persistent storage when preparing offline use, but the browser makes the final decision.

## iOS notes

- Install the app to the Home Screen for a standalone, full-screen experience.
- Microphone capture requires HTTPS and a user gesture.
- iOS pauses microphone capture when the app is backgrounded or the screen locks. Mary requests a Screen Wake Lock while listening; this works in installed web apps on iOS 18.4 and newer. Older versions keep the screen awake only in Safari tabs, if at all.
- If the app is served from GitHub Pages, the first visit reloads once so the service worker can enable cross-origin isolation. On Safari, direct COOP/COEP headers are strongly preferred: WebKit has had issues loading module workers on pages isolated by a service worker, so the GitHub Pages fallback may not work reliably.
- Long pauses or OS memory pressure can stop the audio pipeline. Stop and start captioning again to recover.

## Models and licenses

- Speech recognition: Moonshine Voice streaming models (Tiny 34M, Small 123M, Medium 245M parameters). English streaming models are MIT licensed. The current catalog offers these three streaming sizes; Base Streaming is not published for English.
- Translation: `Xenova/m2m100_418M`, a quantized ONNX conversion of Facebook's M2M100 418M multilingual model (MIT). The initially suggested `Xenova/opus-mt-en-jap` conversion was rejected because it returns unrelated Japanese text, even in its original PyTorch form; M2M100 is larger but reliable.
- Runtime: ONNX Runtime Web (MIT), Transformers.js (Apache-2.0), Moonshine WASM binding (MIT).

Model downloads come from `download.moonshine.ai` and `huggingface.co`. Those are the only network requests Mary makes, and only when a model is downloaded.

## Privacy

- No audio is recorded or stored.
- No audio, captions, or translations are transmitted.
- No analytics, telemetry, accounts, or cookies.
- The microphone starts only after an explicit Start action and stops on Stop.

## Limitations

- English speech only; the translation direction is fixed to English → Japanese.
- Recognition and translation quality depend on the model and device. Small Streaming is the balance between latency and accuracy; Tiny is faster but less accurate, Medium is more accurate but heavier.
- The Japanese translation model is about 610 MB. It is only downloaded when translation is enabled or preloaded, and it is a better fit for desktop than for older phones with limited memory.
- Translation runs after a caption is confirmed, so it lags behind the English text. When the translation queue is full, the oldest pending line is skipped rather than delaying speech recognition.
- Background audio and screen-locked operation are controlled by the OS and are not guaranteed.

## License

MIT. See [LICENSE](LICENSE).
