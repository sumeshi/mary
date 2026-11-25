import type { DownloadProgress, TranslationState } from '../types';

export interface TranslationHandlers {
  onState(state: TranslationState): void;
  onProgress(progress: DownloadProgress | null): void;
  onResult(id: string, text: string): void;
  onError(id: string | null, message: string): void;
  onSkipped(id: string): void;
}

type InMessage =
  | { type: 'load' }
  | { type: 'translate'; id: string; text: string }
  | { type: 'dispose' };

type OutMessage =
  | { type: 'state'; state: 'loading' | 'ready' | 'error' }
  | { type: 'progress'; loaded: number; total?: number; file?: string }
  | { type: 'result'; id: string; text: string }
  | { type: 'error'; id?: string | null; message: string };

interface QueueItem {
  id: string;
  text: string;
}

const MAX_QUEUE = 6;
const WORKER_ERROR = 'Translation worker failed.';

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Translation failed.';
}

export class TranslationService {
  private readonly handlers: TranslationHandlers;
  private stateValue: TranslationState = 'disabled';
  private worker: Worker | null = null;
  private startPromise: Promise<void> | null = null;
  private resolveStart: (() => void) | null = null;
  private rejectStart: ((error: Error) => void) | null = null;
  private pending: QueueItem[] = [];
  private current: QueueItem | null = null;
  private readonly activeIds = new Set<string>();

  constructor(handlers: TranslationHandlers) {
    this.handlers = handlers;
  }

  get state(): TranslationState {
    return this.stateValue;
  }

  start(): Promise<void> {
    if (this.stateValue === 'ready' && this.worker) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    this.stateValue = 'loading';
    this.handlers.onState('loading');
    this.handlers.onProgress(null);

    const promise = new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    this.startPromise = promise;

    worker.onmessage = (event: MessageEvent): void => {
      this.handleMessage(worker, event.data as OutMessage);
    };
    worker.onerror = (event: ErrorEvent): void => {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      this.handleWorkerFailure(worker, event.message || WORKER_ERROR);
    };
    worker.onmessageerror = (): void => {
      this.handleWorkerFailure(worker, 'Unable to read a message from the translation worker.');
    };

    try {
      worker.postMessage({ type: 'load' } satisfies InMessage);
    } catch (error) {
      this.handleWorkerFailure(worker, describeError(error));
    }

    return promise;
  }

  translate(id: string, text: string): void {
    if (this.stateValue !== 'ready' && this.stateValue !== 'loading') return;
    if (this.activeIds.has(id)) return;

    if (this.pending.length >= MAX_QUEUE) {
      const dropped = this.pending.shift();
      if (dropped) {
        this.activeIds.delete(dropped.id);
        this.handlers.onSkipped(dropped.id);
      }
    }

    this.activeIds.add(id);
    this.pending.push({ id, text });
    this.dispatchNext();
  }

  stop(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) worker.terminate();

    const skipped: string[] = [];
    if (this.current) skipped.push(this.current.id);
    this.current = null;
    for (const item of this.pending) skipped.push(item.id);
    this.pending = [];
    this.activeIds.clear();

    for (const id of skipped) this.handlers.onSkipped(id);
    this.settleStart(new Error('Translation stopped.'));

    if (this.stateValue !== 'disabled') {
      this.stateValue = 'disabled';
      this.handlers.onState('disabled');
    }
    this.handlers.onProgress(null);
  }

  private handleMessage(worker: Worker, message: OutMessage): void {
    if (worker !== this.worker) return;

    switch (message.type) {
      case 'state':
        this.handleState(message.state);
        break;
      case 'progress':
        this.handlers.onProgress({
          loaded: message.loaded,
          total: message.total,
          file: message.file,
        });
        break;
      case 'result':
        this.handleResult(message.id, message.text);
        break;
      case 'error':
        this.handleError(message.id ?? null, message.message);
        break;
    }
  }

  private handleState(state: 'loading' | 'ready' | 'error'): void {
    if (state === 'ready') {
      this.stateValue = 'ready';
      this.handlers.onProgress(null);
      this.handlers.onState('ready');
      this.settleStart();
      this.dispatchNext();
      return;
    }

    if (state === 'error') {
      if (this.stateValue !== 'error') {
        this.stateValue = 'error';
        this.handlers.onState('error');
      }
      this.settleStart(new Error('Failed to load the translation model.'));
      return;
    }

    if (this.stateValue !== 'loading') {
      this.stateValue = 'loading';
      this.handlers.onState('loading');
      this.handlers.onProgress(null);
    }
  }

  private handleResult(id: string, text: string): void {
    if (this.current?.id !== id) return;

    this.current = null;
    this.activeIds.delete(id);
    this.handlers.onResult(id, text);
    this.dispatchNext();
  }

  private handleError(id: string | null, message: string): void {
    if (id !== null && this.current?.id === id) {
      this.current = null;
      this.activeIds.delete(id);
      this.handlers.onError(id, message);
      this.dispatchNext();
      return;
    }

    if (this.stateValue === 'loading') {
      this.stateValue = 'error';
      this.handlers.onState('error');
      this.settleStart(new Error(message));
    }
    this.handlers.onError(id, message);
  }

  private handleWorkerFailure(worker: Worker, message: string): void {
    if (worker !== this.worker) return;

    const failed = this.current;
    this.current = null;
    if (failed) this.activeIds.delete(failed.id);

    this.worker = null;
    worker.terminate();

    this.handlers.onError(failed?.id ?? null, message);

    if (this.stateValue !== 'error') {
      this.stateValue = 'error';
      this.handlers.onState('error');
    }
    this.settleStart(new Error(message));
  }

  private settleStart(error?: Error): void {
    const resolve = this.resolveStart;
    const reject = this.rejectStart;
    this.resolveStart = null;
    this.rejectStart = null;
    this.startPromise = null;
    if (error) reject?.(error);
    else resolve?.();
  }

  private dispatchNext(): void {
    if (this.stateValue !== 'ready' || this.worker === null || this.current !== null) return;

    const item = this.pending.shift();
    if (!item) return;

    this.current = item;
    try {
      this.worker.postMessage({ type: 'translate', id: item.id, text: item.text } satisfies InMessage);
    } catch (error) {
      this.current = null;
      this.activeIds.delete(item.id);
      this.handlers.onError(item.id, describeError(error));
      this.dispatchNext();
    }
  }
}
