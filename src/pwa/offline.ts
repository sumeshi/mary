import type { OfflineStatus, Settings } from '../types';
import {
  getAsrModelStatus,
  getTranslationModelStatus,
  isAppCached,
  isTranslationRuntimeCached,
} from './cache';

/** Snapshot of everything needed to caption and translate without a network. */
export async function getOfflineStatus(settings: Settings): Promise<OfflineStatus> {
  const [asrModel, translationModel, appCached, translationRuntime] = await Promise.all([
    getAsrModelStatus(settings.asrModel),
    getTranslationModelStatus(),
    isAppCached(),
    isTranslationRuntimeCached(),
  ]);

  return {
    online: typeof navigator === 'undefined' ? false : navigator.onLine,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    appCached,
    asrModel,
    translationModel,
    translationRuntime,
  };
}
