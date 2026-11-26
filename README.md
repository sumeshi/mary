# Mary

On-device real-time English captions with optional Japanese translation.

Mary turns English speech into large, live captions and can add Japanese below confirmed lines. Speech recognition and translation run entirely in the browser, so audio and captions never leave your device.

## Features

- Live English captions with provisional and confirmed text
- Optional English-to-Japanese translation
- Tiny, Small (default), and Medium streaming speech models
- Installable PWA with offline use after the first download
- Copy the transcript or save it as a text file
- Light, dark, and system themes; four caption sizes
- No accounts, telemetry, or external caption/translation services

## Use

1. Open Mary over HTTPS in a modern browser. iOS/iPadOS Safari 16.4 or newer is recommended.
2. Tap the round start control at the bottom and allow microphone access.
3. Speak English. Provisional text appears while you talk; confirmed lines stay in the transcript.
4. Use the translate button in the header to show Japanese below confirmed lines.
5. To install, use your browser's **Install** or **Add to Home Screen** action.

### Offline use

Start captioning once while online so the selected speech model is stored. For offline translation, enable translation once or use **Settings → Offline → Prepare offline**. After that, the app, speech model, and translation runtime work without a network connection.

The Small speech model is about 158 MB; the translation model is about 610 MB. Models can be deleted from Settings. Browsers may evict site data under storage pressure, so Mary requests persistent storage when preparing offline use.

## Privacy

- No audio is recorded or stored.
- Audio, captions, and translations are never transmitted.
- No analytics, telemetry, accounts, or cookies.
- The microphone starts only after an explicit start action.

Model files are downloaded from `download.moonshine.ai` and `huggingface.co`; those are the only external downloads Mary makes.

## Notes

- English speech only; translation is English-to-Japanese.
- Only confirmed captions are translated. Translation runs after a caption is confirmed, so it lags behind the English text. When the queue is full, the oldest pending line is skipped.
- Recognition and translation quality depend on the model and device. Small is the default balance; Tiny is faster, Medium is more accurate.
- iOS pauses microphone capture when the app is backgrounded or the screen locks. Screen Wake Lock works in installed web apps on iOS 18.4 and newer.
- Long pauses or memory pressure can stop the audio pipeline. Stop and start captioning again to recover.

## Development

Node.js 20.19+ or 22.12+ is required.

```bash
pnpm install
pnpm dev
```

`pnpm dev` copies the Moonshine SDK and ONNX Runtime files into `public/` and starts Vite.

```bash
pnpm build
pnpm preview
```

The build output is static files in `dist/`. Serve it over HTTPS with:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`public/_headers` sets these for Cloudflare Pages and Netlify. For a sub-path deployment, build with `BASE_URL=/mary/ pnpm build`. Hosts that cannot set headers fall back to the service worker; the page reloads once, and Safari may not load module workers reliably in that mode.

## Models and licenses

- Speech recognition: Moonshine Voice streaming models (MIT).
- Translation: `Xenova/m2m100_418M`, a quantized ONNX conversion of Facebook's M2M100 (MIT).
- Runtime: ONNX Runtime Web (MIT), Transformers.js (Apache-2.0), Moonshine WASM binding (MIT).

Third-party copyright notices and license texts are included in the app under **Settings → About → Third-party notices** and are served as `THIRD_PARTY_NOTICES.txt`.

## License

MIT. See [LICENSE](LICENSE).
