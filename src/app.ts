import type {
  AppState,
  AsrModelId,
  Settings,
  SubtitleLine,
  UIActions,
} from './types';
import { ASR_MODELS, getAsrModel } from './models';
import { loadSettings, saveSettings } from './settings';
import { SubtitleStore } from './store';
import { createUI } from './ui/ui';
import { SpeechEngine } from './asr/engine';
import { TranslationService } from './translation/service';
import {
  deleteAsrModel,
  deleteTranslationModel,
  downloadAsrModel,
  getAsrModelStatus,
  getTranslationModelStatus,
  pruneAsrCache,
  pruneTranslationCache,
  requestPersistentStorage,
} from './pwa/cache';
import { getOfflineStatus } from './pwa/offline';
import { ensureCrossOriginIsolation, registerPWA } from './pwa/register';

function emptyModelStatus(): AppState['modelStatus'] {
  return {
    tiny: { cached: false, bytes: 0 },
    small: { cached: false, bytes: 0 },
    medium: { cached: false, bytes: 0 },
  };
}

export function createApp(root: HTMLElement): void {
  const store = new SubtitleStore();
  let settings = loadSettings();
  let refreshing: Promise<void> | null = null;
  let engine: SpeechEngine | null = null;
  let translation: TranslationService | null = null;
  let translationErrorShown = false;

  const state: AppState = {
    settings,
    asrState: 'idle',
    asrDetail: null,
    translationState: 'disabled',
    asrProgress: null,
    translationProgress: null,
    offline: null,
    modelStatus: emptyModelStatus(),
    translationModel: { cached: false, bytes: 0 },
    canStart: false,
    blockReason: null,
  };

  const actions: UIActions = {
    toggleListening: () => {
      void toggleListening();
    },
    setTranslationEnabled: (enabled) => {
      void setTranslationEnabled(enabled);
    },
    updateSettings: (patch) => {
      void updateSettings(patch);
    },
    downloadAsrModel: (id) => {
      void downloadModel(id);
    },
    deleteAsrModel: (id) => {
      void removeModel(id);
    },
    downloadTranslationModel: () => {
      void preloadTranslation();
    },
    deleteTranslationModel: () => {
      void removeTranslationModel();
    },
    prepareOffline: () => {
      void prepareOffline();
    },
    refreshModelStatus: () => {
      void refreshStatus();
    },
  };

  const ui = createUI(root, actions);
  ui.update(state);

  function setState(patch: Partial<AppState>): void {
    Object.assign(state, patch);
    ui.update(patch);
  }

  function markPendingTranslations(stateName: SubtitleLine['translationState']): void {
    for (const line of store.all()) {
      if (line.translationState === 'pending') {
        store.setTranslationState(line.id, stateName);
        ui.updateTranslation(line.id, {
          translation: line.translation,
          translationState: stateName,
        });
      }
    }
  }

  function getTranslationService(): TranslationService {
    if (translation) return translation;
    translation = new TranslationService({
      onState: (next) => {
        setState({ translationState: next });
        if (next === 'ready') {
          translationErrorShown = false;
          void refreshStatus();
        }
        if (next === 'error') {
          markPendingTranslations('error');
        }
        if (next === 'disabled') {
          setState({ translationProgress: null });
        }
      },
      onProgress: (progress) => {
        setState({ translationProgress: progress });
      },
      onResult: (id, text) => {
        store.updateTranslation(id, { translation: text, translationState: 'done' });
        ui.updateTranslation(id, { translation: text, translationState: 'done' });
      },
      onError: (id, message) => {
        if (id) {
          store.updateTranslation(id, { translation: undefined, translationState: 'error' });
          ui.updateTranslation(id, { translation: undefined, translationState: 'error' });
        }
        if (!translationErrorShown) {
          translationErrorShown = true;
          ui.toast(
            message
              ? `Japanese translation is unavailable: ${message}`
              : 'Japanese translation is unavailable. English captions continue.',
            'error',
          );
        }
      },
      onSkipped: (id) => {
        store.updateTranslation(id, { translation: undefined, translationState: 'skipped' });
        ui.updateTranslation(id, { translation: undefined, translationState: 'skipped' });
      },
    });
    return translation;
  }

  function getEngine(): SpeechEngine {
    if (engine) return engine;
    engine = new SpeechEngine({
      onState: (next, detail) => {
        setState({
          asrState: next,
          asrDetail: detail ?? null,
          asrProgress: next === 'idle' ? null : state.asrProgress,
        });
        if (next === 'listening' && settings.translation) {
          void getTranslationService()
            .start()
            .catch(() => {
              // The service reports its own error state.
            });
        }
        if (next === 'listening') {
          void refreshStatus();
        }
        if (next === 'idle') {
          translation?.stop();
          setState({ translationState: 'disabled', translationProgress: null });
        }
      },
      onPartial: (partial) => {
        ui.setPartial(partial);
      },
      onFinal: (result) => {
        ui.setPartial(null);
        const translationEnabled = settings.translation;
        const line: SubtitleLine = {
          id: result.id,
          text: result.text,
          startedAt: result.startedAt,
          translationState: translationEnabled ? 'pending' : 'none',
        };
        store.add(line);
        ui.addLine(line);
        if (translationEnabled) {
          if (state.translationState === 'error') {
            store.setTranslationState(line.id, 'error');
            ui.updateTranslation(line.id, { translation: undefined, translationState: 'error' });
          } else {
            getTranslationService().translate(line.id, result.text);
          }
        }
      },
      onProgress: (progress) => {
        setState({ asrProgress: progress });
      },
      onError: (message) => {
        setState({ asrState: 'error', asrDetail: message });
        ui.toast(message, 'error');
      },
    });
    return engine;
  }

  async function toggleListening(): Promise<void> {
    if (state.asrState === 'listening' || state.asrState === 'loading') {
      await stopListening();
      return;
    }
    await startListening();
  }

  async function startListening(): Promise<void> {
    if (!state.canStart) {
      if (state.blockReason) ui.toast(state.blockReason, 'error');
      return;
    }
    if (state.asrState === 'loading' || state.asrState === 'listening') return;
    setState({ asrState: 'loading', asrDetail: 'Loading speech model', asrProgress: null });
    try {
      await getEngine().start(getAsrModel(settings.asrModel));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({ asrState: 'error', asrDetail: message, asrProgress: null });
      ui.toast(message, 'error');
    }
  }

  async function stopListening(): Promise<void> {
    await engine?.stop();
    translation?.stop();
    setState({
      asrState: 'idle',
      asrDetail: null,
      asrProgress: null,
      translationState: 'disabled',
      translationProgress: null,
    });
  }

  async function setTranslationEnabled(enabled: boolean): Promise<void> {
    settings = { ...settings, translation: enabled };
    saveSettings(settings);
    setState({ settings: { ...settings } });
    if (!enabled) {
      translation?.stop();
      setState({ translationState: 'disabled', translationProgress: null });
      markPendingTranslations('skipped');
      return;
    }
    if (state.asrState === 'listening') {
      try {
        await getTranslationService().start();
      } catch {
        // The service reports its own error state.
      }
    }
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    const modelChanged = patch.asrModel !== undefined && patch.asrModel !== settings.asrModel;
    settings = { ...settings, ...patch };
    saveSettings(settings);
    setState({ settings: { ...settings } });
    if (!modelChanged) return;
    if (state.asrState === 'listening' || state.asrState === 'loading') {
      await stopListening();
      await startListening();
    }
  }

  async function refreshStatus(): Promise<void> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const entries = await Promise.all(
          ASR_MODELS.map(async (model) => [model.id, await getAsrModelStatus(model.id)] as const),
        );
        const modelStatus = emptyModelStatus();
        for (const [id, status] of entries) modelStatus[id] = status;
        const translationModel = await getTranslationModelStatus();
        const offline = await getOfflineStatus(settings);
        setState({ modelStatus, translationModel, offline });
      } catch {
        // Cache Storage can be unavailable in private or restricted browsing.
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function downloadModel(id: AsrModelId): Promise<void> {
    try {
      await downloadAsrModel(id, (progress) => setState({ asrProgress: progress }));
      setState({ asrProgress: null });
      await refreshStatus();
      ui.toast(`${getAsrModel(id).label} is ready offline.`);
    } catch (error) {
      setState({ asrProgress: null });
      ui.toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function removeModel(id: AsrModelId): Promise<void> {
    if (settings.asrModel === id && (state.asrState === 'listening' || state.asrState === 'loading')) {
      await stopListening();
    }
    await deleteAsrModel(id);
    await refreshStatus();
    ui.toast(`${getAsrModel(id).label} was removed from this device.`);
  }

  async function preloadTranslation(): Promise<void> {
    try {
      const service = getTranslationService();
      await service.start();
      if (state.asrState !== 'listening') service.stop();
      await refreshStatus();
      ui.toast('Japanese translation is ready offline.');
    } catch (error) {
      ui.toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function removeTranslationModel(): Promise<void> {
    translation?.stop();
    await deleteTranslationModel();
    await refreshStatus();
    ui.toast('The Japanese translation model was removed from this device.');
  }

  async function prepareOffline(): Promise<void> {
    try {
      await requestPersistentStorage();
      await downloadAsrModel(settings.asrModel, (progress) => setState({ asrProgress: progress }));
      setState({ asrProgress: null });
      if (settings.translation) {
        const service = getTranslationService();
        await service.start();
        if (state.asrState !== 'listening') service.stop();
      }
      await refreshStatus();
      ui.toast('Offline setup is complete.');
    } catch (error) {
      setState({ asrProgress: null });
      ui.toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  function updateConnectivity(): void {
    void getOfflineStatus(settings)
      .then((offline) => setState({ offline }))
      .catch(() => undefined);
  }

  window.addEventListener('online', updateConnectivity);
  window.addEventListener('offline', updateConnectivity);
  window.addEventListener('pagehide', () => {
    void engine?.stop();
    translation?.stop();
  });

  registerPWA();

  void (async () => {
    const isolation = await ensureCrossOriginIsolation();
    if (isolation === 'reloading') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        canStart: false,
        blockReason: 'Microphone capture is not available in this browser.',
      });
      return;
    }
    if (isolation === 'unsupported') {
      setState({
        canStart: false,
        blockReason:
          'Speech recognition needs cross-origin isolation (COOP/COEP). Serve the app with the required headers, or open it once through the offline service worker and reload.',
      });
    } else {
      setState({ canStart: true, blockReason: null });
    }
    void (async () => {
      try {
        await pruneAsrCache();
        await pruneTranslationCache();
      } catch {
        // Old model files are harmless if cleanup is unavailable.
      }
      await refreshStatus();
    })();
  })();
}
