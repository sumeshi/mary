import {
  ASR_MODELS,
  TRANSLATION_MODEL_BYTES,
  TRANSLATION_MODEL_ID,
  formatBytes,
  formatPercent,
} from '../models';
import { DEFAULT_SETTINGS } from '../settings';
import type {
  AppState,
  AppUI,
  AsrModelId,
  AsrState,
  DownloadProgress,
  FontScale,
  OfflineStatus,
  PartialSubtitle,
  SubtitleLine,
  ThemeMode,
  TranslationRenderState,
  UIActions,
} from '../types';
import { maryIcons as icons } from './icons';
import { VoiceRope, type VoiceState } from './voice';

const MAX_RENDERED_LINES = 500;
const PIN_THRESHOLD_PX = 80;
const APP_VERSION = '0.1.0';
const DARK_THEME_COLOR = '#0a0c11';
const LIGHT_THEME_COLOR = '#f5f7fb';

interface AsrCardRefs {
  card: HTMLElement;
  radio: HTMLInputElement;
  badge: HTMLElement;
  download: HTMLButtonElement;
  remove: HTMLButtonElement;
}

interface ProgressView {
  root: HTMLElement;
  title: HTMLElement;
  percent: HTMLElement;
  detail: HTMLElement;
  fill: HTMLElement;
}

type OfflineKey = 'network' | 'app' | 'asr' | 'translation' | 'runtime';

function query<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Mary UI is missing an element: ${selector}`);
  return element;
}

function createVoiceRope(canvas: HTMLCanvasElement): VoiceRope | null {
  try {
    return new VoiceRope(canvas);
  } catch {
    // Captioning still works without the decorative canvas.
    return null;
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--:--';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function setTime(time: HTMLTimeElement, timestamp: number): void {
  time.textContent = formatTime(timestamp);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    time.removeAttribute('datetime');
  } else {
    time.dateTime = date.toISOString();
  }
}

function progressMarkup(kind: 'asr' | 'translation', label: string): string {
  return `
    <div
      class="mary-download"
      data-progress="${kind}"
      role="progressbar"
      aria-label="${label}"
      aria-valuemin="0"
      aria-valuemax="100"
      hidden
    >
      <div class="mary-download__head">
        <span data-progress-title>${label}</span>
        <span class="mary-download__percent" data-progress-percent></span>
      </div>
      <div class="mary-download__track" aria-hidden="true">
        <span class="mary-download__fill" data-progress-fill></span>
      </div>
      <p class="mary-download__detail" data-progress-detail></p>
    </div>
  `;
}

function buildAsrCards(): string {
  return ASR_MODELS.map(
    (model) => `
      <div class="mary-model" data-model-card="${model.id}">
        <label class="mary-model__choice">
          <input
            class="mary-model__radio"
            type="radio"
            name="mary-asr-model"
            value="${model.id}"
            aria-label="${model.label}"
          />
          <span class="mary-model__body">
            <span class="mary-model__top">
              <span class="mary-model__name">${model.label}</span>
              <span class="mary-badge" data-model-badge="${model.id}">Not cached</span>
            </span>
            <span class="mary-model__meta">
              ${model.params} params · ${model.wer} WER · ${formatBytes(model.sizeBytes)}
            </span>
            <span class="mary-model__note">${model.note}</span>
          </span>
        </label>
        <div class="mary-model__actions">
          <button
            type="button"
            class="mary-small-button"
            data-model-download="${model.id}"
            aria-label="Download ${model.label} model"
          >
            ${icons.download}<span>Download</span>
          </button>
          <button
            type="button"
            class="mary-small-button"
            data-model-delete="${model.id}"
            aria-label="Delete ${model.label} model"
          >
            ${icons.trash}<span>Delete</span>
          </button>
        </div>
      </div>
    `,
  ).join('');
}

function buildSettingsMarkup(): string {
  return `
    <dialog
      class="mary-settings"
      data-settings-dialog
      aria-modal="true"
      aria-labelledby="mary-settings-title"
      aria-describedby="mary-settings-subtitle"
    >
      <div class="mary-settings__sheet">
        <header class="mary-settings__header">
          <div>
            <h2 class="mary-settings__title" id="mary-settings-title">Settings</h2>
            <p class="mary-settings__subtitle" id="mary-settings-subtitle">Audio never leaves this device.</p>
          </div>
          <button
            type="button"
            class="mary-icon-button"
            data-close-settings
            aria-label="Close settings"
            title="Close"
          >
            ${icons.close}
          </button>
        </header>

        <div class="mary-settings__body">
          <section class="mary-settings__section" aria-labelledby="mary-settings-asr">
            <h3 id="mary-settings-asr">Speech recognition</h3>
            <p class="mary-settings__lede">
              Choose the Moonshine model used to caption English. Larger models are more accurate but
              use more memory.
            </p>
            <p class="mary-settings__warning" data-asr-lock hidden>Stop captioning to switch models.</p>
            <div class="mary-models" role="group" aria-label="Speech recognition models">
              ${buildAsrCards()}
            </div>
            ${progressMarkup('asr', 'Speech model download')}
          </section>

          <section class="mary-settings__section" aria-labelledby="mary-settings-translation">
            <h3 id="mary-settings-translation">Translation</h3>
            <div class="mary-row">
              <div class="mary-row__copy">
                <span class="mary-row__title">Japanese translation</span>
                <span class="mary-row__desc">Show Japanese below each confirmed English caption.</span>
              </div>
              <button
                type="button"
                class="mary-switch"
                role="switch"
                aria-checked="false"
                aria-label="Japanese translation"
                data-translation-switch
              ></button>
            </div>

            <div class="mary-model-summary">
              <div class="mary-model-summary__info">
                <span class="mary-model-summary__name">${TRANSLATION_MODEL_ID}</span>
                <span class="mary-model-summary__meta">
                  <span>${formatBytes(TRANSLATION_MODEL_BYTES)}</span>
                  <span aria-hidden="true">·</span>
                  <span class="mary-badge" data-translation-badge>Not cached</span>
                </span>
                <span class="mary-model-summary__state" data-translation-state>Translation is off.</span>
              </div>
              <div class="mary-model-summary__actions">
                <button
                  type="button"
                  class="mary-small-button"
                  data-translation-download
                  aria-label="Download the Japanese translation model"
                >
                  ${icons.download}<span>Download</span>
                </button>
                <button
                  type="button"
                  class="mary-small-button"
                  data-translation-delete
                  aria-label="Delete the Japanese translation model"
                >
                  ${icons.trash}<span>Delete</span>
                </button>
              </div>
            </div>

            ${progressMarkup('translation', 'Translation model download')}
            <p class="mary-settings__note">
              Only confirmed captions are translated. The translation model is not loaded
              automatically while translation is off. The model is about 610 MB, so it is a better
              fit for desktop or recent phones.
            </p>
          </section>

          <section class="mary-settings__section" aria-labelledby="mary-settings-text">
            <h3 id="mary-settings-text">Text size</h3>
            <p class="mary-settings__lede">Scale the English captions and Japanese translations.</p>
            <div class="mary-segmented" role="group" aria-label="Caption text size">
              <button type="button" class="mary-segmented__button" data-font-scale="small" aria-pressed="false">Small</button>
              <button type="button" class="mary-segmented__button" data-font-scale="medium" aria-pressed="true">Medium</button>
              <button type="button" class="mary-segmented__button" data-font-scale="large" aria-pressed="false">Large</button>
              <button type="button" class="mary-segmented__button" data-font-scale="xlarge" aria-pressed="false">Extra large</button>
            </div>
          </section>

          <section class="mary-settings__section" aria-labelledby="mary-settings-theme">
            <h3 id="mary-settings-theme">Theme</h3>
            <div class="mary-segmented" role="group" aria-label="Color theme">
              <button type="button" class="mary-segmented__button" data-theme-mode="system" aria-pressed="true">System</button>
              <button type="button" class="mary-segmented__button" data-theme-mode="light" aria-pressed="false">Light</button>
              <button type="button" class="mary-segmented__button" data-theme-mode="dark" aria-pressed="false">Dark</button>
            </div>
          </section>

          <section class="mary-settings__section" aria-labelledby="mary-settings-offline">
            <h3 id="mary-settings-offline">Offline</h3>
            <p class="mary-settings__lede">
              Mary can caption without a network connection after the app and models are stored.
            </p>
            <div class="mary-offline-list">
              <div class="mary-offline-row">
                <span>Network</span>
                <span class="mary-offline-row__status" data-offline="network" data-state="pending">Checking…</span>
              </div>
              <div class="mary-offline-row">
                <span>App shell</span>
                <span class="mary-offline-row__status" data-offline="app" data-state="pending">Checking…</span>
              </div>
              <div class="mary-offline-row">
                <span>Speech model</span>
                <span class="mary-offline-row__status" data-offline="asr" data-state="pending">Checking…</span>
              </div>
              <div class="mary-offline-row">
                <span>Translation model</span>
                <span class="mary-offline-row__status" data-offline="translation" data-state="pending">Checking…</span>
              </div>
              <div class="mary-offline-row">
                <span>Translation runtime</span>
                <span class="mary-offline-row__status" data-offline="runtime" data-state="pending">Checking…</span>
              </div>
            </div>
            <p class="mary-settings__note" data-isolation>Cross-origin isolation: checking…</p>
            <p class="mary-settings__note" data-offline-summary>Checking what is stored on this device…</p>
            <button type="button" class="mary-action-button" data-prepare-offline>
              ${icons.download}<span>Prepare offline</span>
            </button>
          </section>

          <section class="mary-settings__section mary-about" aria-labelledby="mary-settings-about">
            <h3 id="mary-settings-about">About</h3>
            <p>
              Mary captions English speech entirely on your device. Audio is never recorded,
              uploaded, or sent to a server. There are no accounts, no telemetry, and no external
              caption services.
            </p>
            <p class="mary-settings__note">
              Speech recognition is powered by
              <a href="https://github.com/moonshine-ai/moonshine" target="_blank" rel="noopener noreferrer">Moonshine</a>.
              Japanese translation uses
              <a href="https://huggingface.co/docs/transformers.js/" target="_blank" rel="noopener noreferrer">Transformers.js</a>
              with the <span class="mary-model-summary__name">${TRANSLATION_MODEL_ID}</span> model.
            </p>
            <p class="mary-settings__note">
              <a href="${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener noreferrer">Third-party notices</a>
            </p>
            <p class="mary-version">Version ${APP_VERSION}</p>
          </section>
        </div>
      </div>
    </dialog>
  `;
}

function buildAppMarkup(): string {
  return `
    <div class="mary-app">
      <div class="mary-top">
        <header class="mary-header">
          <h1 class="mary-sr-only">Mary</h1>
          <span class="mary-sr-only" data-status data-state="ready" role="status" aria-live="polite">
            <span data-status-text>Ready</span>
          </span>
          <button
            type="button"
            class="mary-icon-button"
            data-copy-captions
            aria-label="Copy captions"
            title="Copy captions"
          >
            ${icons.copy}
          </button>
          <button
            type="button"
            class="mary-icon-button"
            data-save-captions
            aria-label="Save captions as text"
            title="Save captions as text"
          >
            ${icons.download}
          </button>
          <button
            type="button"
            class="mary-icon-button mary-translate"
            role="switch"
            aria-checked="false"
            aria-label="Translate captions to Japanese: off"
            data-translate-toggle
            data-state="off"
            title="Translate captions"
          >
            ${icons.translate}
          </button>
          <button
            type="button"
            class="mary-icon-button"
            data-open-settings
            aria-label="Open settings"
            title="Settings"
          >
            ${icons.settings}
          </button>
        </header>
        <div
          class="mary-progress"
          data-app-progress
          role="progressbar"
          aria-label="Speech model progress"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-hidden="true"
        >
          <span class="mary-progress__fill" data-app-progress-fill></span>
        </div>
      </div>

      <div class="mary-stage">
        <main class="mary-captions" data-captions tabindex="0" aria-label="Live captions">
          <div class="mary-captions__inner">
            <div class="mary-empty" data-empty>
              <p class="mary-empty__title">No captions yet</p>
            </div>
            <div class="mary-lines" data-lines></div>
            <article class="mary-caption mary-partial" data-partial data-empty="true">
              <time class="mary-caption__time" data-partial-time aria-hidden="true"></time>
              <p
                class="mary-caption__text"
                lang="en"
                data-partial-text
                aria-live="polite"
                aria-atomic="true"
              ></p>
            </article>
          </div>
        </main>
        <button type="button" class="mary-jump" data-jump hidden>
          ${icons.arrowDown}<span>Jump to latest</span>
        </button>
      </div>

      <footer class="mary-footer">
        <div class="mary-footer__inner">
          <div class="mary-controls">
            <div class="mary-voice" data-voice data-state="idle">
              <canvas class="mary-voice__canvas" data-voice-canvas aria-hidden="true"></canvas>
              <button
                type="button"
                class="mary-voice__button"
                data-start-button
                aria-label="Start captioning"
              ></button>
            </div>
          </div>
          <p class="mary-notice" data-notice hidden></p>
        </div>
      </footer>
    </div>
  `;
}

function isFontScale(value: string | undefined): value is FontScale {
  return value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge';
}

function isThemeMode(value: string | undefined): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function applyTranslation(
  node: ParentNode,
  translation: string | undefined,
  translationState: TranslationRenderState,
): void {
  const target = node.querySelector<HTMLElement>('.mary-caption__translation');
  if (!target) return;

  target.dataset.state = translationState;
  if (translationState === 'done' && translation) {
    target.lang = 'ja';
    target.textContent = translation;
    target.hidden = false;
    return;
  }
  if (translationState === 'pending') {
    target.lang = 'en';
    target.textContent = 'Translating…';
    target.hidden = false;
    return;
  }
  if (translationState === 'error') {
    target.lang = 'en';
    target.textContent = 'Translation unavailable';
    target.hidden = false;
    return;
  }
  target.textContent = '';
  target.hidden = true;
}

/**
 * Render the caption UI into `root`. This module owns only the nodes it creates
 * and never reads from the ASR, translation, or PWA layers directly.
 */
export function createUI(root: HTMLElement, actions: UIActions): AppUI {
  const state: AppState = {
    settings: { ...DEFAULT_SETTINGS },
    asrState: 'idle',
    asrDetail: null,
    translationState: 'disabled',
    asrProgress: null,
    translationProgress: null,
    offline: null,
    modelStatus: {
      tiny: { cached: false, bytes: 0 },
      small: { cached: false, bytes: 0 },
      medium: { cached: false, bytes: 0 },
    },
    translationModel: { cached: false, bytes: 0 },
    canStart: true,
    blockReason: null,
  };

  root.innerHTML = `
    ${buildAppMarkup()}
    ${buildSettingsMarkup()}
    <div class="mary-toasts" data-toasts aria-label="Notifications"></div>
  `;

  const appEl = query<HTMLElement>(root, '.mary-app');
  const statusEl = query<HTMLElement>(root, '[data-status]');
  const statusText = query<HTMLElement>(root, '[data-status-text]');
  const noticeEl = query<HTMLParagraphElement>(root, '[data-notice]');
  const appProgress = query<HTMLElement>(root, '[data-app-progress]');
  const appProgressFill = query<HTMLElement>(root, '[data-app-progress-fill]');
  const startButton = query<HTMLButtonElement>(root, '[data-start-button]');
  const voiceEl = query<HTMLElement>(root, '[data-voice]');
  const voiceCanvas = query<HTMLCanvasElement>(root, '[data-voice-canvas]');
  const voiceRope = createVoiceRope(voiceCanvas);
  const translateToggle = query<HTMLButtonElement>(root, '[data-translate-toggle]');
  const copyButton = query<HTMLButtonElement>(root, '[data-copy-captions]');
  const saveButton = query<HTMLButtonElement>(root, '[data-save-captions]');
  const captionsEl = query<HTMLElement>(root, '[data-captions]');
  const linesEl = query<HTMLElement>(root, '[data-lines]');
  const emptyEl = query<HTMLElement>(root, '[data-empty]');
  const partialEl = query<HTMLElement>(root, '[data-partial]');
  const partialTime = query<HTMLTimeElement>(root, '[data-partial-time]');
  const partialText = query<HTMLParagraphElement>(root, '[data-partial-text]');
  const jumpButton = query<HTMLButtonElement>(root, '[data-jump]');
  const toastRegion = query<HTMLElement>(root, '[data-toasts]');
  const settingsButton = query<HTMLButtonElement>(root, '[data-open-settings]');
  const dialogEl = query<HTMLDialogElement>(root, '[data-settings-dialog]');
  const closeButton = query<HTMLButtonElement>(root, '[data-close-settings]');
  const asrLockHint = query<HTMLElement>(root, '[data-asr-lock]');
  const settingsBody = query<HTMLElement>(root, '.mary-settings__body');
  const asrProgressView: ProgressView = {
    root: query<HTMLElement>(root, '[data-progress="asr"]'),
    title: query<HTMLElement>(root, '[data-progress="asr"] [data-progress-title]'),
    percent: query<HTMLElement>(root, '[data-progress="asr"] [data-progress-percent]'),
    detail: query<HTMLElement>(root, '[data-progress="asr"] [data-progress-detail]'),
    fill: query<HTMLElement>(root, '[data-progress="asr"] [data-progress-fill]'),
  };
  const translationProgressView: ProgressView = {
    root: query<HTMLElement>(root, '[data-progress="translation"]'),
    title: query<HTMLElement>(root, '[data-progress="translation"] [data-progress-title]'),
    percent: query<HTMLElement>(root, '[data-progress="translation"] [data-progress-percent]'),
    detail: query<HTMLElement>(root, '[data-progress="translation"] [data-progress-detail]'),
    fill: query<HTMLElement>(root, '[data-progress="translation"] [data-progress-fill]'),
  };
  const translationSwitch = query<HTMLButtonElement>(root, '[data-translation-switch]');
  const translationBadge = query<HTMLElement>(root, '[data-translation-badge]');
  const translationStateLabel = query<HTMLElement>(root, '[data-translation-state]');
  const translationDownload = query<HTMLButtonElement>(root, '[data-translation-download]');
  const translationDelete = query<HTMLButtonElement>(root, '[data-translation-delete]');
  const isolationNote = query<HTMLElement>(root, '[data-isolation]');
  const offlineSummary = query<HTMLElement>(root, '[data-offline-summary]');
  const prepareButton = query<HTMLButtonElement>(root, '[data-prepare-offline]');
  const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  const fontButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-font-scale]'),
  );
  const themeButtons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('[data-theme-mode]'),
  );
  const offlineRows = new Map<string, HTMLElement>();
  for (const row of root.querySelectorAll<HTMLElement>('[data-offline]')) {
    const key = row.dataset.offline;
    if (key) offlineRows.set(key, row);
  }

  const modelRefs = new Map<AsrModelId, AsrCardRefs>();
  for (const model of ASR_MODELS) {
    modelRefs.set(model.id, {
      card: query<HTMLElement>(root, `[data-model-card="${model.id}"]`),
      radio: query<HTMLInputElement>(root, `[data-model-card="${model.id}"] input[type="radio"]`),
      badge: query<HTMLElement>(root, `[data-model-badge="${model.id}"]`),
      download: query<HTMLButtonElement>(root, `[data-model-download="${model.id}"]`),
      remove: query<HTMLButtonElement>(root, `[data-model-delete="${model.id}"]`),
    });
  }

  const darkQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  const reducedMotionQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

  const lineNodes = new Map<string, HTMLElement>();
  const toastTimers = new Set<number>();
  const listenerController = new AbortController();
  const listenerOptions: AddEventListenerOptions = { signal: listenerController.signal };
  let pinned = true;
  let settingsOpen = false;
  let destroyed = false;

  function hasOwn(patch: Partial<AppState>, key: keyof AppState): boolean {
    return Object.prototype.hasOwnProperty.call(patch, key);
  }

  function applyAppearance(): void {
    const documentRoot = document.documentElement;
    if (documentRoot.dataset.theme !== state.settings.theme) {
      documentRoot.dataset.theme = state.settings.theme;
    }
    if (documentRoot.dataset.font !== state.settings.fontScale) {
      documentRoot.dataset.font = state.settings.fontScale;
    }

    const prefersDark = darkQuery ? darkQuery.matches : true;
    const resolved =
      state.settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : state.settings.theme;
    if (documentRoot.dataset.resolvedTheme !== resolved) {
      documentRoot.dataset.resolvedTheme = resolved;
    }
    if (themeColorMeta) {
      const color = resolved === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
      if (themeColorMeta.content !== color) themeColorMeta.content = color;
    }
  }

  function statusLabel(value: AsrState): string {
    switch (value) {
      case 'idle':
        return 'Ready';
      case 'loading':
        return 'Loading speech model';
      case 'listening':
        return 'Listening';
      case 'error':
        return 'Error';
    }
  }

  function isNearBottom(): boolean {
    return captionsEl.scrollHeight - captionsEl.scrollTop - captionsEl.clientHeight <= PIN_THRESHOLD_PX;
  }

  function scrollToBottom(): void {
    captionsEl.scrollTop = captionsEl.scrollHeight;
  }

  function updateJumpButton(): void {
    const hasOverflow = captionsEl.scrollHeight > captionsEl.clientHeight + 24;
    jumpButton.hidden = pinned || !hasOverflow;
  }

  function updateEmptyState(): void {
    const hasPartial = partialEl.dataset.empty === 'false';
    emptyEl.hidden = lineNodes.size > 0 || hasPartial;
  }

  function updateProgress(view: ProgressView, progress: DownloadProgress | null, label: string): void {
    view.root.hidden = progress === null;
    if (!progress) {
      view.fill.style.width = '0%';
      view.fill.dataset.indeterminate = 'false';
      view.root.removeAttribute('aria-valuenow');
      view.root.removeAttribute('aria-valuetext');
      return;
    }

    const percent = formatPercent(progress.loaded, progress.total);
    const detail = progress.total
      ? `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)}`
      : `${formatBytes(progress.loaded)} downloaded`;
    view.title.textContent = progress.file ? `Downloading ${progress.file}` : label;
    view.percent.textContent = percent === undefined ? 'Working…' : `${percent}%`;
    view.detail.textContent = detail;
    view.root.setAttribute('aria-valuetext', `${label}: ${detail}`);

    if (percent === undefined) {
      view.fill.style.width = '35%';
      view.fill.dataset.indeterminate = 'true';
      view.root.removeAttribute('aria-valuenow');
      return;
    }
    view.fill.style.width = `${percent}%`;
    view.fill.dataset.indeterminate = 'false';
    view.root.setAttribute('aria-valuenow', String(percent));
  }

  function updateAppProgress(): void {
    const progress = state.asrProgress;
    const active =
      state.asrState === 'loading' ||
      (progress !== null && state.asrState !== 'listening');
    appProgress.dataset.active = active ? 'true' : 'false';
    appProgress.setAttribute('aria-hidden', active ? 'false' : 'true');

    const percent = progress ? formatPercent(progress.loaded, progress.total) : undefined;
    if (!active) {
      appProgressFill.style.width = '0%';
      appProgressFill.dataset.indeterminate = 'false';
      appProgress.removeAttribute('aria-valuenow');
      appProgress.removeAttribute('aria-valuetext');
      return;
    }

    const detail = progress
      ? progress.total
        ? `${formatBytes(progress.loaded)} of ${formatBytes(progress.total)}`
        : `${formatBytes(progress.loaded)} downloaded`
      : 'Preparing the speech model';
    appProgress.setAttribute('aria-valuetext', detail);

    if (percent === undefined) {
      appProgressFill.style.width = '35%';
      appProgressFill.dataset.indeterminate = 'true';
      appProgress.removeAttribute('aria-valuenow');
      return;
    }
    appProgressFill.style.width = `${percent}%`;
    appProgressFill.dataset.indeterminate = 'false';
    appProgress.setAttribute('aria-valuenow', String(percent));
  }

  function updateNotice(): void {
    let message = '';
    let kind: 'info' | 'error' = 'info';

    if (state.asrState === 'error') {
      message = state.asrDetail ?? state.blockReason ?? 'Speech recognition stopped unexpectedly.';
      kind = 'error';
    } else if (state.asrState === 'idle' && !state.canStart && state.blockReason) {
      message = state.blockReason;
    }

    const hidden = message.length === 0;
    if (noticeEl.hidden !== hidden) noticeEl.hidden = hidden;
    if (noticeEl.textContent !== message) noticeEl.textContent = message;
    if (noticeEl.dataset.kind !== kind) noticeEl.dataset.kind = kind;
    const role = kind === 'error' ? 'alert' : 'status';
    if (noticeEl.getAttribute('role') !== role) noticeEl.setAttribute('role', role);
  }

  function updateChrome(): void {
    const label = statusLabel(state.asrState);
    const statusState = state.asrState === 'idle' ? 'ready' : state.asrState;
    const statusAria = `Status: ${label}`;
    const statusTitle = state.asrDetail ?? '';
    if (statusEl.dataset.state !== statusState) statusEl.dataset.state = statusState;
    if (statusEl.getAttribute('aria-label') !== statusAria) {
      statusEl.setAttribute('aria-label', statusAria);
    }
    if (statusEl.title !== statusTitle) statusEl.title = statusTitle;
    if (statusText.textContent !== label) statusText.textContent = label;

    updateAppProgress();
    updateNotice();

    const listening = state.asrState === 'listening';
    const loading = state.asrState === 'loading';
    const canToggle = listening || loading;
    const startAction = listening ? 'Stop' : loading ? 'Cancel' : 'Start';
    const startAria = listening
      ? 'Stop captioning'
      : loading
        ? 'Cancel loading the speech model'
        : 'Start captioning';
    const startTitle = !canToggle && !state.canStart && state.blockReason ? state.blockReason : '';
    const voiceState: VoiceState =
      state.asrState === 'idle' && !state.canStart && state.blockReason
        ? 'blocked'
        : state.asrState;

    if (voiceEl.dataset.state !== voiceState) voiceEl.dataset.state = voiceState;
    voiceRope?.setState(voiceState);
    const voiceColor = getComputedStyle(document.documentElement)
      .getPropertyValue(
        voiceState === 'loading'
          ? '--mary-warning'
          : voiceState === 'error' || voiceState === 'blocked'
            ? '--mary-error'
            : voiceState === 'listening'
              ? '--mary-accent'
              : '--mary-muted',
      )
      .trim();
    voiceRope?.setColor(voiceColor);
    startButton.disabled = !canToggle && !state.canStart;
    if (startButton.getAttribute('aria-label') !== startAria) {
      startButton.setAttribute('aria-label', startAria);
    }
    if (startButton.title !== (startTitle || startAction)) {
      startButton.title = startTitle || startAction;
    }

    const translationOn = state.settings.translation;
    const translationDisplay =
      state.translationState === 'loading'
        ? 'Loading'
        : state.translationState === 'error'
          ? 'Error'
          : translationOn
            ? 'On'
            : 'Off';
    const translationAria = `Translate captions to Japanese: ${translationDisplay.toLowerCase()}`;
    const translationStateName =
      state.translationState === 'loading'
        ? 'loading'
        : state.translationState === 'error'
          ? 'error'
          : translationOn
            ? 'on'
            : 'off';

    if (translateToggle.getAttribute('aria-checked') !== String(translationOn)) {
      translateToggle.setAttribute('aria-checked', String(translationOn));
    }
    if (translateToggle.getAttribute('aria-label') !== translationAria) {
      translateToggle.setAttribute('aria-label', translationAria);
    }
    if (translateToggle.title !== translationAria) {
      translateToggle.title = translationAria;
    }
    if (translateToggle.dataset.state !== translationStateName) {
      translateToggle.dataset.state = translationStateName;
    }

    updateEmptyState();
    if (pinned) scrollToBottom();
    updateJumpButton();
  }

  function translationStatusText(): string {
    if (!state.settings.translation) return 'Translation is off.';
    switch (state.translationState) {
      case 'disabled':
        return 'Translation is on. The model loads when captioning starts.';
      case 'loading':
        return 'Loading the translation model…';
      case 'ready':
        return 'Translation is ready.';
      case 'error':
        return 'The translation model could not be loaded.';
    }
  }

  function setBadge(element: HTMLElement, cached: boolean): void {
    element.textContent = cached ? 'Cached' : 'Not cached';
    element.dataset.state = cached ? 'ready' : 'missing';
  }

  function setOfflineRow(key: OfflineKey, ready: boolean | null): void {
    const element = offlineRows.get(key);
    if (!element) return;
    element.textContent = ready === null ? 'Checking…' : ready ? 'Ready' : 'Missing';
    element.dataset.state = ready === null ? 'pending' : ready ? 'ready' : 'missing';
  }

  function setNetworkRow(online: boolean | null): void {
    const element = offlineRows.get('network');
    if (!element) return;
    element.textContent = online === null ? 'Checking…' : online ? 'Online' : 'Offline';
    element.dataset.state = online ? 'ready' : 'pending';
  }

  function updateOffline(offline: OfflineStatus | null): void {
    if (!offline) {
      setNetworkRow(null);
      setOfflineRow('app', null);
      setOfflineRow('asr', null);
      setOfflineRow('translation', null);
      setOfflineRow('runtime', null);
      isolationNote.textContent = 'Cross-origin isolation: checking…';
      offlineSummary.textContent = 'Checking what is stored on this device…';
      prepareButton.disabled = true;
      return;
    }

    setNetworkRow(offline.online);
    setOfflineRow('app', offline.appCached);
    setOfflineRow('asr', offline.asrModel.cached);
    setOfflineRow('translation', offline.translationModel.cached);
    setOfflineRow('runtime', offline.translationRuntime);

    const translationRequired = state.settings.translation;
    const readyForOffline =
      offline.appCached &&
      offline.asrModel.cached &&
      (!translationRequired || (offline.translationModel.cached && offline.translationRuntime));

    prepareButton.disabled = !offline.online || readyForOffline;
    isolationNote.textContent = `Cross-origin isolation: ${
      offline.crossOriginIsolated ? 'enabled' : 'unavailable'
    }.`;
    offlineSummary.textContent = readyForOffline
      ? 'Everything needed for your current settings is stored on this device.'
      : offline.online
        ? 'Download the missing pieces before you lose connectivity.'
        : 'Connect to the internet to finish preparing offline use.';
  }

  function updateSettingsPanel(): void {
    const listening = state.asrState === 'listening';
    asrLockHint.hidden = !listening;

    for (const model of ASR_MODELS) {
      const refs = modelRefs.get(model.id);
      if (!refs) continue;
      const selected = state.settings.asrModel === model.id;
      const status = state.modelStatus[model.id] ?? { cached: false, bytes: 0 };
      const activeDuringLoad = selected && state.asrState === 'loading';

      refs.radio.checked = selected;
      refs.radio.disabled = listening;
      refs.card.classList.toggle('mary-model--selected', selected);
      setBadge(refs.badge, status.cached);
      refs.download.disabled = status.cached || activeDuringLoad;
      refs.remove.disabled =
        !status.cached || (selected && (listening || state.asrState === 'loading'));
    }

    updateProgress(asrProgressView, state.asrProgress, 'Speech model download');

    translationSwitch.setAttribute('aria-checked', String(state.settings.translation));
    translationSwitch.setAttribute(
      'aria-label',
      `Japanese translation: ${state.settings.translation ? 'on' : 'off'}`,
    );
    setBadge(translationBadge, state.translationModel.cached);
    translationStateLabel.textContent = translationStatusText();
    translationStateLabel.dataset.state = state.translationState;

    const translationBusy = state.translationState === 'loading';
    translationDownload.disabled = state.translationModel.cached || translationBusy;
    translationDelete.disabled = !state.translationModel.cached || translationBusy;
    updateProgress(
      translationProgressView,
      state.translationProgress,
      'Translation model download',
    );

    for (const button of fontButtons) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.fontScale === state.settings.fontScale),
      );
    }
    for (const button of themeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.themeMode === state.settings.theme));
    }

    updateOffline(state.offline);
  }

  function render(): void {
    applyAppearance();
    updateChrome();
    if (settingsOpen) updateSettingsPanel();
  }

  function createCaptionNode(line: SubtitleLine): HTMLElement {
    const article = document.createElement('article');
    article.className = 'mary-caption mary-caption--new';
    article.dataset.lineId = line.id;

    const time = document.createElement('time');
    time.className = 'mary-caption__time';
    const text = document.createElement('p');
    text.className = 'mary-caption__text';
    text.lang = 'en';
    const translation = document.createElement('p');
    translation.className = 'mary-caption__translation';
    translation.lang = 'ja';
    translation.hidden = true;

    article.append(time, text, translation);
    applyLineContent(article, line);
    return article;
  }

  function applyLineContent(node: HTMLElement, line: SubtitleLine): void {
    const time = node.querySelector<HTMLTimeElement>('.mary-caption__time');
    const text = node.querySelector<HTMLParagraphElement>('.mary-caption__text');
    if (time) setTime(time, line.startedAt);
    if (text) text.textContent = line.text;
    applyTranslation(node, line.translation, line.translationState);
  }

  function update(patch: Partial<AppState>): void {
    if (destroyed) return;

    if (patch.settings) state.settings = { ...state.settings, ...patch.settings };
    if (patch.asrState !== undefined) state.asrState = patch.asrState;
    if (hasOwn(patch, 'asrDetail')) state.asrDetail = patch.asrDetail ?? null;
    if (patch.translationState !== undefined) state.translationState = patch.translationState;
    if (hasOwn(patch, 'asrProgress')) state.asrProgress = patch.asrProgress ?? null;
    if (hasOwn(patch, 'translationProgress')) {
      state.translationProgress = patch.translationProgress ?? null;
    }
    if (hasOwn(patch, 'offline')) state.offline = patch.offline ?? null;
    if (patch.modelStatus !== undefined) {
      state.modelStatus = { ...state.modelStatus, ...patch.modelStatus };
    }
    if (patch.translationModel !== undefined) {
      state.translationModel = { ...state.translationModel, ...patch.translationModel };
    }
    if (patch.canStart !== undefined) state.canStart = patch.canStart;
    if (hasOwn(patch, 'blockReason')) state.blockReason = patch.blockReason ?? null;

    render();
  }

  function addLine(line: SubtitleLine): void {
    if (destroyed) return;

    const existing = lineNodes.get(line.id);
    if (existing) {
      applyLineContent(existing, line);
    } else {
      const node = createCaptionNode(line);
      lineNodes.set(line.id, node);
      linesEl.append(node);

      while (linesEl.children.length > MAX_RENDERED_LINES) {
        const oldest = linesEl.firstElementChild as HTMLElement | null;
        if (!oldest) break;
        const removedId = oldest.dataset.lineId;
        oldest.remove();
        if (removedId) lineNodes.delete(removedId);
      }
    }

    updateEmptyState();
    if (pinned) scrollToBottom();
    updateJumpButton();
  }

  function updateTranslation(
    id: string,
    patch: Pick<SubtitleLine, 'translation' | 'translationState'>,
  ): void {
    if (destroyed) return;
    const node = lineNodes.get(id);
    if (!node) return;
    applyTranslation(node, patch.translation, patch.translationState);
    if (pinned) scrollToBottom();
    updateJumpButton();
  }

  function setPartial(partial: PartialSubtitle | null): void {
    if (destroyed) return;

    const text = partial?.text ?? '';
    if (!partial || text.trim().length === 0) {
      partialEl.dataset.empty = 'true';
      partialText.textContent = '';
      partialTime.textContent = '';
      partialTime.removeAttribute('datetime');
      updateEmptyState();
      if (pinned) scrollToBottom();
      updateJumpButton();
      return;
    }

    if (partialTime.textContent !== formatTime(partial.startedAt)) {
      setTime(partialTime, partial.startedAt);
    }
    if (partialText.textContent !== text) {
      partialText.textContent = text;
    }
    partialEl.dataset.empty = 'false';
    updateEmptyState();
    if (pinned) scrollToBottom();
    updateJumpButton();
  }

  function toast(message: string, kind: 'info' | 'error' = 'info'): void {
    if (destroyed) return;

    const element = document.createElement('div');
    element.className = 'mary-toast';
    element.dataset.kind = kind;
    element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    element.textContent = message;
    toastRegion.append(element);

    const timer = window.setTimeout(
      () => {
        toastTimers.delete(timer);
        element.remove();
      },
      kind === 'error' ? 8000 : 4000,
    );
    toastTimers.add(timer);
  }

  function finishSettingsClose(): void {
    if (!settingsOpen) return;
    settingsOpen = false;
    document.documentElement.classList.remove('mary-modal-open');
    if (toastRegion.parentElement !== document.body) {
      document.body.append(toastRegion);
    }
    if (!destroyed) settingsButton.focus();
  }

  function closeSettings(): void {
    if (!settingsOpen) return;
    if (dialogEl.open) {
      if (typeof dialogEl.close === 'function') {
        dialogEl.close();
      } else {
        dialogEl.removeAttribute('open');
      }
    }
    finishSettingsClose();
  }

  function openSettings(): void {
    if (destroyed || settingsOpen) return;

    settingsOpen = true;
    updateSettingsPanel();
    toastRegion.remove();
    dialogEl.append(toastRegion);
    document.documentElement.classList.add('mary-modal-open');

    if (typeof dialogEl.showModal === 'function') {
      try {
        if (!dialogEl.open) dialogEl.showModal();
      } catch {
        dialogEl.setAttribute('open', '');
      }
    } else {
      dialogEl.setAttribute('open', '');
    }

    settingsBody.scrollTop = 0;
    closeButton.focus();
    actions.refreshModelStatus();
  }

  function selectAsrModel(id: AsrModelId): void {
    if (state.asrState === 'listening' || state.settings.asrModel === id) return;
    state.settings = { ...state.settings, asrModel: id };
    actions.updateSettings({ asrModel: id });
    render();
  }

  function setTranslationEnabled(enabled: boolean): void {
    state.settings = { ...state.settings, translation: enabled };
    actions.setTranslationEnabled(enabled);
    render();
  }

  function toggleTranslation(): void {
    setTranslationEnabled(!state.settings.translation);
  }

  function setFontScale(scale: FontScale): void {
    if (state.settings.fontScale === scale) return;
    state.settings = { ...state.settings, fontScale: scale };
    actions.updateSettings({ fontScale: scale });
    render();
  }

  function setTheme(theme: ThemeMode): void {
    if (state.settings.theme === theme) return;
    state.settings = { ...state.settings, theme };
    actions.updateSettings({ theme });
    render();
  }

  function onCaptionsScroll(): void {
    pinned = isNearBottom();
    updateJumpButton();
  }

  function onJumpClick(): void {
    captionsEl.scrollTo({
      top: captionsEl.scrollHeight,
      behavior: reducedMotionQuery?.matches ? 'auto' : 'smooth',
    });
  }

  function onResize(): void {
    if (pinned) scrollToBottom();
    updateJumpButton();
  }

  function onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && settingsOpen) {
      event.preventDefault();
      closeSettings();
    }
  }

  function onSchemeChange(): void {
    if (state.settings.theme === 'system') applyAppearance();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;

    listenerController.abort();
    voiceRope?.destroy();

    for (const timer of toastTimers) window.clearTimeout(timer);
    toastTimers.clear();

    if (settingsOpen) {
      settingsOpen = false;
      document.documentElement.classList.remove('mary-modal-open');
      if (dialogEl.open) {
        if (typeof dialogEl.close === 'function') dialogEl.close();
        else dialogEl.removeAttribute('open');
      }
    }

    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.resolvedTheme;
    delete document.documentElement.dataset.font;

    toastRegion.remove();
    dialogEl.remove();
    appEl.remove();
  }

  function onDialogCancel(event: Event): void {
    event.preventDefault();
    closeSettings();
  }

  function onDialogClose(): void {
    finishSettingsClose();
  }

  function onDialogClick(event: MouseEvent): void {
    if (!settingsOpen || event.target !== dialogEl) return;
    const rect = dialogEl.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) closeSettings();
  }

  // Settings: close paths.
  settingsButton.addEventListener('click', openSettings, listenerOptions);
  copyButton.addEventListener('click', () => actions.copyCaptions(), listenerOptions);
  saveButton.addEventListener('click', () => actions.saveCaptions(), listenerOptions);
  closeButton.addEventListener('click', closeSettings, listenerOptions);
  dialogEl.addEventListener('cancel', onDialogCancel, listenerOptions);
  dialogEl.addEventListener('close', onDialogClose, listenerOptions);
  dialogEl.addEventListener('click', onDialogClick, listenerOptions);

  // Settings: model selection and downloads.
  for (const model of ASR_MODELS) {
    const refs = modelRefs.get(model.id);
    if (!refs) continue;
    refs.radio.addEventListener(
      'change',
      () => {
        if (refs.radio.checked) selectAsrModel(model.id);
      },
      listenerOptions,
    );
    refs.download.addEventListener(
      'click',
      () => actions.downloadAsrModel(model.id),
      listenerOptions,
    );
    refs.remove.addEventListener(
      'click',
      () => actions.deleteAsrModel(model.id),
      listenerOptions,
    );
  }

  translationSwitch.addEventListener('click', toggleTranslation, listenerOptions);
  translationDownload.addEventListener(
    'click',
    () => actions.downloadTranslationModel(),
    listenerOptions,
  );
  translationDelete.addEventListener(
    'click',
    () => actions.deleteTranslationModel(),
    listenerOptions,
  );
  prepareButton.addEventListener('click', () => actions.prepareOffline(), listenerOptions);

  for (const button of fontButtons) {
    button.addEventListener(
      'click',
      () => {
        const value = button.dataset.fontScale;
        if (isFontScale(value)) setFontScale(value);
      },
      listenerOptions,
    );
  }
  for (const button of themeButtons) {
    button.addEventListener(
      'click',
      () => {
        const value = button.dataset.themeMode;
        if (isThemeMode(value)) setTheme(value);
      },
      listenerOptions,
    );
  }

  // Main controls.
  startButton.addEventListener('click', () => actions.toggleListening(), listenerOptions);
  translateToggle.addEventListener('click', toggleTranslation, listenerOptions);
  jumpButton.addEventListener('click', onJumpClick, listenerOptions);
  captionsEl.addEventListener('scroll', onCaptionsScroll, {
    passive: true,
    signal: listenerController.signal,
  });
  window.addEventListener('resize', onResize, listenerOptions);
  document.addEventListener('keydown', onDocumentKeydown, listenerOptions);
  if (darkQuery) darkQuery.addEventListener('change', onSchemeChange, listenerOptions);

  applyAppearance();
  render();

  return {
    update,
    addLine,
    updateTranslation,
    setPartial,
    toast,
    destroy,
  };
}
