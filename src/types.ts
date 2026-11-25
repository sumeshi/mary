export type AsrModelId = 'tiny' | 'small' | 'medium';
export type ThemeMode = 'system' | 'light' | 'dark';
export type FontScale = 'small' | 'medium' | 'large' | 'xlarge';

export interface Settings {
  asrModel: AsrModelId;
  translation: boolean;
  fontScale: FontScale;
  theme: ThemeMode;
}

export type AsrState = 'idle' | 'loading' | 'listening' | 'error';
export type TranslationState = 'disabled' | 'loading' | 'ready' | 'error';

export interface DownloadProgress {
  loaded: number;
  total?: number;
  file?: string;
}

export type TranslationRenderState = 'none' | 'pending' | 'done' | 'error' | 'skipped';

export interface SubtitleLine {
  id: string;
  text: string;
  startedAt: number;
  translation?: string;
  translationState: TranslationRenderState;
}

export interface PartialSubtitle {
  id: string;
  text: string;
  startedAt: number;
}

export interface ModelStatus {
  cached: boolean;
  bytes: number;
}

export interface OfflineStatus {
  online: boolean;
  crossOriginIsolated: boolean;
  appCached: boolean;
  asrModel: ModelStatus;
  translationModel: ModelStatus;
  translationRuntime: boolean;
}

export interface AppState {
  settings: Settings;
  asrState: AsrState;
  asrDetail: string | null;
  translationState: TranslationState;
  asrProgress: DownloadProgress | null;
  translationProgress: DownloadProgress | null;
  offline: OfflineStatus | null;
  modelStatus: Record<AsrModelId, ModelStatus>;
  translationModel: ModelStatus;
  canStart: boolean;
  blockReason: string | null;
}

export interface UIActions {
  toggleListening(): void;
  setTranslationEnabled(enabled: boolean): void;
  updateSettings(patch: Partial<Settings>): void;
  downloadAsrModel(id: AsrModelId): void;
  deleteAsrModel(id: AsrModelId): void;
  downloadTranslationModel(): void;
  deleteTranslationModel(): void;
  prepareOffline(): void;
  refreshModelStatus(): void;
}

export interface AppUI {
  update(patch: Partial<AppState>): void;
  addLine(line: SubtitleLine): void;
  updateTranslation(
    id: string,
    patch: Pick<SubtitleLine, 'translation' | 'translationState'>,
  ): void;
  setPartial(partial: PartialSubtitle | null): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  destroy(): void;
}

export interface TranscriptResult {
  id: string;
  text: string;
  startedAt: number;
}
