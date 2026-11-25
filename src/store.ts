import type { SubtitleLine, TranslationRenderState } from './types';

const MAX_LINES = 500;

export class SubtitleStore {
  private lines: SubtitleLine[] = [];
  private readonly byId = new Map<string, SubtitleLine>();

  add(line: SubtitleLine): void {
    if (this.byId.has(line.id)) {
      this.updateTranslation(line.id, {
        translation: line.translation,
        translationState: line.translationState,
      });
      return;
    }
    this.lines.push(line);
    this.byId.set(line.id, line);
    while (this.lines.length > MAX_LINES) {
      const removed = this.lines.shift();
      if (removed) this.byId.delete(removed.id);
    }
  }

  updateTranslation(
    id: string,
    patch: Pick<SubtitleLine, 'translation' | 'translationState'>,
  ): void {
    const line = this.byId.get(id);
    if (!line) return;
    line.translation = patch.translation;
    line.translationState = patch.translationState;
  }

  get(id: string): SubtitleLine | undefined {
    return this.byId.get(id);
  }

  setTranslationState(id: string, state: TranslationRenderState): void {
    const line = this.byId.get(id);
    if (line) line.translationState = state;
  }

  all(): readonly SubtitleLine[] {
    return this.lines;
  }

  clear(): void {
    this.lines = [];
    this.byId.clear();
  }
}
