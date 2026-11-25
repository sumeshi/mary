import { registerSW } from 'virtual:pwa-register';

export type IsolationResult = 'isolated' | 'reloading' | 'unsupported';

const RELOAD_GUARD_KEY = 'mary.coi-reload';
const REGISTRATION_TIMEOUT_MS = 10_000;
const CONTROLLER_TIMEOUT_MS = 3_000;

/** Register the generated service worker as early as possible. */
export function registerPWA(): void {
  if (typeof window === 'undefined') return;
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  registerSW({ immediate: true });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      resolve(null);
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function waitForController(timeoutMs: number): Promise<ServiceWorker | null> {
  if (navigator.serviceWorker.controller) {
    return Promise.resolve(navigator.serviceWorker.controller);
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve(navigator.serviceWorker.controller);
    }, timeoutMs);

    const onChange = (): void => {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve(navigator.serviceWorker.controller);
    };

    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });
}

/** Arm the one-shot guard. Returns false if it is already set or unusable. */
function armReloadGuard(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === '1') return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
    return true;
  } catch {
    // Without sessionStorage a reload could loop forever.
    return false;
  }
}

function clearReloadGuard(): void {
  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    // Storage may be blocked; nothing to clean up.
  }
}

/**
 * Cross-origin isolation is required by the threaded Moonshine and ONNX
 * runtimes. Static hosts cannot send COOP/COEP, so the service worker injects
 * them; the document that registered the worker must be reloaded once to pick
 * those headers up. Call this after `registerPWA()`.
 */
export async function ensureCrossOriginIsolation(): Promise<IsolationResult> {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('crossOriginIsolated' in window)) return 'unsupported';

  if (window.crossOriginIsolated) {
    clearReloadGuard();
    return 'isolated';
  }

  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }

  const registration = await withTimeout(navigator.serviceWorker.ready, REGISTRATION_TIMEOUT_MS);
  if (window.crossOriginIsolated) {
    clearReloadGuard();
    return 'isolated';
  }
  if (!registration) return 'unsupported';

  const controller =
    navigator.serviceWorker.controller ?? (await waitForController(CONTROLLER_TIMEOUT_MS));
  if (window.crossOriginIsolated) {
    clearReloadGuard();
    return 'isolated';
  }
  if (!controller) return 'unsupported';

  if (!armReloadGuard()) return 'unsupported';

  window.location.reload();
  return 'reloading';
}
