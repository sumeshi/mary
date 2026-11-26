import type {
  ModelArch,
  SttWorkerHost,
  TranscriptEventListener,
  TranscriptLine,
} from '@moonshine-ai/moonshine-wasm';
import type { AsrModelInfo } from '../models';
import type {
  AsrState,
  DownloadProgress,
  PartialSubtitle,
  TranscriptResult,
} from '../types';
import { ScreenWakeLock } from '../platform/wake-lock';
import { MicrophoneCapture } from './capture';

const TRANSCRIBER_ID = 'main';
const STREAM_ID = 'main';
const SAMPLE_RATE = 16000;
const MOONSHINE_BASE_URL = new URL(
  `${import.meta.env.BASE_URL}moonshine/`,
  location.origin,
).href;

export interface SpeechEngineHandlers {
  onState(state: AsrState, detail?: string | null): void;
  onPartial(partial: PartialSubtitle | null): void;
  onFinal(result: TranscriptResult): void;
  onProgress(progress: DownloadProgress | null): void;
  onError(message: string): void;
}

interface EngineSession {
  cancelled: boolean;
  disposed: Promise<void> | null;
  host: SttWorkerHost | null;
  capture: MicrophoneCapture | null;
  wakeLock: ScreenWakeLock | null;
  streamReady: boolean;
  startedAt: Map<string, number>;
  partialId: string | null;
  partialText: string | null;
}

export class SpeechEngine {
  private readonly handlers: SpeechEngineHandlers;
  private session: EngineSession | null = null;
  private active = false;
  private disposal: Promise<void> | null = null;

  constructor(handlers: SpeechEngineHandlers) {
    this.handlers = handlers;
  }

  get running(): boolean {
    return this.active;
  }

  async start(model: AsrModelInfo): Promise<void> {
    // A previous session may still be flushing its final line.
    if (this.disposal) await this.disposal;
    if (this.active) throw new Error('Speech recognition is already running.');

    const session = createSession();
    this.session = session;
    this.active = true;

    this.handlers.onProgress(null);
    this.handlers.onPartial(null);
    this.handlers.onState('loading', 'Loading speech model…');

    try {
      this.assertCurrent(session);
      const sdk = await loadSdk();
      this.assertCurrent(session);

      const host = new sdk.SttWorkerHost(MOONSHINE_BASE_URL);
      session.host = host;
      host.onProgress = (transcriberId, loaded, total, file) => {
        if (!this.isCurrent(session) || transcriberId !== TRANSCRIBER_ID) return;
        this.handlers.onProgress({ loaded, total, file });
      };

      await host.loadTranscriber({
        transcriberId: TRANSCRIBER_ID,
        modelArch: model.arch as ModelArch,
        source: { kind: 'catalog', language: 'en' },
      });
      this.assertCurrent(session);
      this.handlers.onProgress(null);

      await host.createStream(TRANSCRIBER_ID, STREAM_ID, {
        updateInterval: 0.4,
        priority: 1,
      });
      session.streamReady = true;
      this.assertCurrent(session);

      host.setListener(STREAM_ID, this.listenerFor(session));
      await host.start(STREAM_ID);
      this.assertCurrent(session);

      const capture = new MicrophoneCapture({
        onAudio: (samples) => {
          if (!this.isCurrent(session)) return;
          try {
            host.addAudio(STREAM_ID, samples, SAMPLE_RATE);
          } catch {
            // Audio that races with shutdown is not worth reporting.
          }
        },
        onError: (message) => this.fail(session, message),
      });
      session.capture = capture;
      await capture.start();
      this.assertCurrent(session);

      const wakeLock = new ScreenWakeLock();
      session.wakeLock = wakeLock;
      await wakeLock.request();
      this.assertCurrent(session);
      this.handlers.onState('listening', null);
    } catch (error) {
      const current = this.isCurrent(session);
      if (current) {
        this.session = null;
        this.active = false;
      }

      const disposal = this.dispose(session);

      if (current) {
        this.handlers.onProgress(null);
        this.handlers.onPartial(null);
        this.handlers.onState('error', errorMessage(error));
      }

      await disposal;

      if (!current) return;

      this.handlers.onPartial(null);
      this.handlers.onProgress(null);
      throw new Error(errorMessage(error));
    }
  }

  async stop(): Promise<void> {
    if (this.disposal) await this.disposal;
    if (!this.active || !this.session) return;

    const session = this.session;
    this.session = null;
    this.active = false;

    // Return to idle before teardown so the control is usable immediately.
    // start() waits for the disposal itself.
    this.handlers.onProgress(null);
    this.handlers.onPartial(null);
    this.handlers.onState('idle', null);

    try {
      await this.dispose(session);
    } finally {
      this.handlers.onPartial(null);
      this.handlers.onProgress(null);
    }
  }

  private listenerFor(session: EngineSession): TranscriptEventListener {
    return {
      onLineStarted: ({ line }) => {
        session.startedAt.set(line.id, Date.now());
        this.emitPartial(session, line);
      },
      onLineTextChanged: ({ line }) => this.emitPartial(session, line),
      onLineCompleted: ({ line }) => this.completeLine(session, line),
      onError: ({ error }) => this.fail(session, error.message),
    };
  }

  private emitPartial(session: EngineSession, line: TranscriptLine): void {
    const text = line.text.trim();
    if (!text) {
      if (session.partialId === line.id) this.clearPartial(session);
      return;
    }

    if (session.partialId === line.id && session.partialText === text) return;

    let startedAt = session.startedAt.get(line.id);
    if (startedAt === undefined) {
      // A line normally starts before it has text, but keep partials stable if
      // the SDK ever delivers text first.
      startedAt = Date.now() - Math.max(0, line.duration) * 1000;
      session.startedAt.set(line.id, startedAt);
    }

    session.partialId = line.id;
    session.partialText = text;
    this.handlers.onPartial({ id: line.id, text, startedAt });
  }

  private completeLine(session: EngineSession, line: TranscriptLine): void {
    const text = line.text.trim();
    const startedAt =
      session.startedAt.get(line.id) ??
      Date.now() - Math.max(0, line.duration) * 1000;

    session.startedAt.delete(line.id);
    if (session.partialId === line.id) this.clearPartial(session);

    if (!text) return;
    this.handlers.onFinal({ id: line.id, text, startedAt });
  }

  private clearPartial(session: EngineSession): void {
    session.partialId = null;
    session.partialText = null;
    this.handlers.onPartial(null);
  }

  private fail(session: EngineSession, message: string): void {
    if (!this.isCurrent(session)) return;

    this.session = null;
    this.active = false;
    const disposal = this.dispose(session);

    this.handlers.onState('error', message);
    this.handlers.onProgress(null);
    this.handlers.onPartial(null);
    this.handlers.onError(message);
    void disposal.then(
      () => this.handlers.onPartial(null),
      () => this.handlers.onPartial(null),
    );
  }

  private isCurrent(session: EngineSession): boolean {
    return !session.cancelled && this.session === session;
  }

  private assertCurrent(session: EngineSession): void {
    if (!this.isCurrent(session)) {
      throw new DOMException('Speech recognition stopped.', 'AbortError');
    }
  }

  private dispose(session: EngineSession): Promise<void> {
    session.cancelled = true;

    if (!session.disposed) {
      const disposed = this.release(session);
      session.disposed = disposed;
      this.disposal = disposed;
      void disposed.then(
        () => this.clearDisposal(disposed),
        () => this.clearDisposal(disposed),
      );
    }

    return session.disposed;
  }

  private clearDisposal(disposed: Promise<void>): void {
    if (this.disposal === disposed) this.disposal = null;
  }

  private async release(session: EngineSession): Promise<void> {
    const host = session.host;

    if (host && session.streamReady) {
      // stop() forces a final pass, so the trailing line is emitted before the
      // RPC resolves.
      try {
        await host.stop(STREAM_ID);
      } catch {
        // The worker may already be gone.
      }
      try {
        await host.closeStream(STREAM_ID);
      } catch {
        // The stream may already be gone.
      }
      session.streamReady = false;
    }

    try {
      host?.close();
    } catch {
      // Already terminated.
    }
    session.host = null;

    if (session.wakeLock) {
      try {
        await session.wakeLock.release();
      } catch {
        // The browser may already have released it.
      }
      session.wakeLock = null;
    }

    if (session.capture) {
      try {
        await session.capture.stop();
      } catch {
        // Tracks and the context are best-effort at this point.
      }
      session.capture = null;
    }
  }
}

function createSession(): EngineSession {
  return {
    cancelled: false,
    disposed: null,
    host: null,
    capture: null,
    wakeLock: null,
    streamReady: false,
    startedAt: new Map<string, number>(),
    partialId: null,
    partialText: null,
  };
}

async function loadSdk(): Promise<typeof import('@moonshine-ai/moonshine-wasm')> {
  const url = `${MOONSHINE_BASE_URL}index.js`;
  return (await import(/* @vite-ignore */ url)) as typeof import(
    '@moonshine-ai/moonshine-wasm'
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (/fetch|network|load failed/i.test(error.message)) {
      return 'Could not load the speech model. Check your connection and try again.';
    }
    return error.message;
  }
  return 'Speech recognition could not start.';
}
