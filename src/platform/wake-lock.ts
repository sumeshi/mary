/**
 * Best-effort screen wake lock. Browsers release the lock when the page is
 * hidden, so it is requested again when the page becomes visible.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  private readonly handleVisibilityChange = (): void => {
    if (!this.wanted || document.visibilityState !== 'visible') return;
    void this.acquire();
  };

  async request(): Promise<void> {
    if (!('wakeLock' in navigator) || !navigator.wakeLock) return;

    if (!this.wanted) {
      this.wanted = true;
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    await this.acquire();
  }

  async release(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    const sentinel = this.sentinel;
    this.sentinel = null;
    if (!sentinel) return;

    try {
      await sentinel.release();
    } catch {
      // The browser may already have released it.
    }
  }

  private async acquire(): Promise<void> {
    if (!this.wanted || this.sentinel || document.visibilityState !== 'visible') {
      return;
    }
    if (!('wakeLock' in navigator) || !navigator.wakeLock) return;

    try {
      const sentinel = await navigator.wakeLock.request('screen');

      if (!this.wanted) {
        try {
          await sentinel.release();
        } catch {
          // Release raced with page teardown.
        }
        return;
      }

      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // NotAllowedError, hidden documents, and unsupported screens only mean
      // that the display may dim; speech recognition still works.
    }
  }
}
