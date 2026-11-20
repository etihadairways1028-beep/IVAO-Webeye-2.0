import { useEffect, useState } from 'react';

/** "Install app" support: registers the service worker and exposes the browser's install prompt. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Checks for a newer deploy whenever the app comes back to the foreground (and every 10 minutes),
 * and reloads into it. Home-screen apps on iPad/iPhone resume from memory and would otherwise keep
 * showing an old version for days. */
function watchForNewBuild() {
  let last = 0;
  const check = async () => {
    if (Date.now() - last < 60_000) return;
    last = Date.now();
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const { build } = (await r.json()) as { build?: string };
      if (build && build !== __BUILD_ID__ && build > __BUILD_ID__) {
        // Guard: never reload twice for the same build (e.g. if a cache still serves the old page).
        try {
          if (sessionStorage.getItem('pulse.reloadedFor') === build) return;
          sessionStorage.setItem('pulse.reloadedFor', build);
        } catch {
          /* storage blocked: one reload is still fine */
        }
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update().catch(() => undefined);
        location.reload();
      }
    } catch {
      /* offline: try again later */
    }
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  window.setInterval(check, 10 * 60_000);
  check();
}

export function initInstall() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' }).then((r) => r.update()).catch(() => undefined);
      // A new version took over: reload once so nobody is stuck on the old one.
      const had = !!navigator.serviceWorker.controller;
      watchForNewBuild();
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (had && !reloaded) (reloaded = true), location.reload();
      });
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 'prompt' = the browser can install now; 'ios' = Safari, use Share → Add to Home Screen; null = installed or unsupported. */
export function useInstall(): { mode: 'prompt' | 'ios' | null; install: () => Promise<void> } {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const mode = isStandalone() ? null : deferred ? 'prompt' : isIos() ? 'ios' : null;
  return {
    mode,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice.catch(() => undefined);
      deferred = null;
      emit();
    },
  };
}
