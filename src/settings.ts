import type { FontScale, Settings, ThemeMode } from './types';

const STORAGE_KEY = 'mary.settings.v1';

const FONT_SCALES: readonly FontScale[] = ['small', 'medium', 'large', 'xlarge'];
const THEMES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export const DEFAULT_SETTINGS: Settings = {
  asrModel: 'small',
  translation: false,
  fontScale: 'medium',
  theme: 'system',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_SETTINGS };
    return {
      asrModel:
        parsed.asrModel === 'tiny' || parsed.asrModel === 'medium' || parsed.asrModel === 'small'
          ? parsed.asrModel
          : DEFAULT_SETTINGS.asrModel,
      translation:
        typeof parsed.translation === 'boolean' ? parsed.translation : DEFAULT_SETTINGS.translation,
      fontScale: FONT_SCALES.includes(parsed.fontScale as FontScale)
        ? (parsed.fontScale as FontScale)
        : DEFAULT_SETTINGS.fontScale,
      theme: THEMES.includes(parsed.theme as ThemeMode)
        ? (parsed.theme as ThemeMode)
        : DEFAULT_SETTINGS.theme,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Captioning still works when storage is unavailable.
  }
}
