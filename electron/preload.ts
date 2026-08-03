import { contextBridge, ipcRenderer } from 'electron';

// Types are declared in src/types/electron-api.d.ts (shared shape).
const api = {
  bible: {
    getCatalog: () => ipcRenderer.invoke('bible:get-catalog'),
    getChapter: (abbr: string, bookIndex: number, chapterIndex: number) =>
      ipcRenderer.invoke('bible:get-chapter', { abbr, bookIndex, chapterIndex }),
    getBookList: (abbr: string) => ipcRenderer.invoke('bible:get-book-list', abbr),
    search: (abbr: string, query: string, maxResults?: number) =>
      ipcRenderer.invoke('bible:search', { abbr, query, maxResults }),
  },
  tts: {
    isAvailable: () => ipcRenderer.invoke('tts:is-available'),
    getStats: () => ipcRenderer.invoke('tts:get-stats'),
    speak: (text: string) => ipcRenderer.invoke('tts:speak', { text }),
    prefetch: (text: string) => ipcRenderer.invoke('tts:prefetch', { text }),
    stop: () => ipcRenderer.invoke('tts:stop'),
    updateConfig: (voice?: string, speed?: number) =>
      ipcRenderer.invoke('tts:update-config', { voice, speed }),
    onStateChange: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state);
      ipcRenderer.on('tts:state-change', listener);
      return () => ipcRenderer.removeListener('tts:state-change', listener);
    },
  },
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', { key, value }),
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
