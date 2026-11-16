/**
 * Wails runtime bridge.
 *
 * When the app runs inside Wails (Go backend), `window.go.*` exposes the
 * bound App methods and `window.runtime` exposes events. This module maps
 * that onto the exact `window.electronAPI` shape the React code uses, so
 * every context, hook and component behaves identically to Electron.
 *
 * When running under Electron (or plain Vite dev), `window.electronAPI`
 * already exists and this module does nothing.
 *
 * No UI or behaviour changes: same method names, same payloads, same
 * event names ("bible:verses-progress", "tts:state-change").
 */

type WailsApp = {
  GetCatalog: () => Promise<unknown>;
  GetChapter: (abbr: string, bookIndex: number, chapterIndex: number) => Promise<unknown>;
  GetBookList: (abbr: string) => Promise<unknown>;
  Search: (abbr: string, query: string, maxResults: number) => Promise<unknown>;
  GetVerses: (
    abbrs: string[],
    bookIndex: number,
    chapterIndex: number,
    verseIndex: number,
    requestId: string,
  ) => Promise<unknown>;
  TTSIsAvailable: () => Promise<boolean>;
  TTSGetStats: () => Promise<unknown>;
  TTSSpeak: (text: string) => Promise<void>;
  TTSPrefetch: (text: string) => Promise<void>;
  TTSStop: () => Promise<void>;
  TTSUpdateConfig: (voice: string, speed: number) => Promise<void>;
  StoreGet: (key: string) => Promise<unknown>;
  StoreGetAll: () => Promise<Record<string, unknown>>;
  StoreSet: (key: string, value: unknown) => Promise<void>;
  OpenURL: (url: string) => Promise<void>;
};

type WailsRuntime = {
  EventsOn: (event: string, callback: (payload: unknown) => void) => () => void;
};

function getWailsApp(): WailsApp | null {
  const w = window as unknown as { go?: Record<string, Record<string, WailsApp>> };
  if (!w.go) return null;
  // Bound struct namespace depends on the Go package: `main` when App lives
  // in package main, `backend` if it is ever moved. Probe both.
  return w.go.main?.App ?? w.go.backend?.App ?? null;
}

function getWailsRuntime(): WailsRuntime | null {
  const w = window as unknown as { runtime?: WailsRuntime };
  return w.runtime ?? null;
}

function installBridge(): void {
  const w = window as unknown as { electronAPI?: unknown };
  // Electron (or an already-installed bridge): leave untouched.
  if (w.electronAPI) return;

  const app = getWailsApp();
  const runtime = getWailsRuntime();
  // Plain Vite dev server without Wails: nothing to bridge.
  if (!app || !runtime) return;

  // Fan-out for progress events: one runtime subscription, many UI listeners.
  const versesListeners = new Set<(payload: { requestId: string; index: number; entry: unknown }) => void>();
  let versesUnsub: (() => void) | null = null;

  const stateListeners = new Set<(state: unknown) => void>();
  let stateUnsub: (() => void) | null = null;

  const api = {
    bible: {
      getCatalog: () => app.GetCatalog(),
      getChapter: (abbr: string, bookIndex: number, chapterIndex: number) =>
        app.GetChapter(abbr, bookIndex, chapterIndex),
      getBookList: (abbr: string) => app.GetBookList(abbr),
      search: (abbr: string, query: string, maxResults = 50) =>
        app.Search(abbr, query, maxResults),
      getVerses: (
        abbrs: string[],
        bookIndex: number,
        chapterIndex: number,
        verseIndex: number,
        requestId: string,
      ) => app.GetVerses(abbrs, bookIndex, chapterIndex, verseIndex, requestId),
      onVersesProgress: (
        callback: (payload: { requestId: string; index: number; entry: unknown }) => void,
      ) => {
        versesListeners.add(callback);
        if (!versesUnsub) {
          versesUnsub = runtime.EventsOn('bible:verses-progress', (payload) => {
            const p = payload as { requestId: string; index: number; entry: unknown };
            versesListeners.forEach((cb) => cb(p));
          });
        }
        return () => {
          versesListeners.delete(callback);
          if (versesListeners.size === 0 && versesUnsub) {
            versesUnsub();
            versesUnsub = null;
          }
        };
      },
    },
    tts: {
      isAvailable: () => app.TTSIsAvailable(),
      getStats: () => app.TTSGetStats(),
      speak: (text: string) => app.TTSSpeak(text),
      prefetch: (text: string) => app.TTSPrefetch(text),
      stop: () => app.TTSStop(),
      updateConfig: (voice?: string, speed?: number) =>
        app.TTSUpdateConfig(voice ?? '', speed ?? -1),
      onStateChange: (callback: (state: unknown) => void) => {
        stateListeners.add(callback);
        if (!stateUnsub) {
          stateUnsub = runtime.EventsOn('tts:state-change', (payload) => {
            stateListeners.forEach((cb) => cb(payload));
          });
        }
        return () => {
          stateListeners.delete(callback);
          if (stateListeners.size === 0 && stateUnsub) {
            stateUnsub();
            stateUnsub = null;
          }
        };
      },
    },
    store: {
      get: (key: string) => app.StoreGet(key),
      getAll: () => app.StoreGetAll(),
      set: (key: string, value: unknown) => app.StoreSet(key, value),
    },
  };

  w.electronAPI = api;

  // External links open in the system browser, never in-app
  // (mirrors Electron's setWindowOpenHandler).
  document.addEventListener('click', (e) => {
    const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('http://') || href.startsWith('https://')) {
      e.preventDefault();
      void app.OpenURL(href);
    }
  });
}

installBridge();

export {};
