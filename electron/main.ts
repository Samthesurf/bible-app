import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { BibleLoader } from './bible-loader';
import { JsonStore } from './store';
import { StubTTSEngine, type TTSEngine } from './tts-stub';
import { KokoroTTSEngine } from './tts-kokoro';
import { LocalKokoroTTSEngine } from './tts-local';
import { HybridTTSEngine } from './tts-hybrid';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// TTS wiring: prefer local Kokoro (free, offline), else OpenRouter Kokoro,
// else the stub.  See electron/tts-local.ts and electron/tts-kokoro.ts.
// ---------------------------------------------------------------------------
const ttsEngine: TTSEngine = createTTSEngine();

function createTTSEngine(): TTSEngine {
  const local = new LocalKokoroTTSEngine({});
  const hasLocal = fs.existsSync(localPythonPath()) && fs.existsSync(localServicePath());

  // 1) Hybrid: OpenRouter live playback + background local cache warming.
  //    First pass costs a few cents; repeat readings play from the free,
  //    instant local cache. Best of both worlds.
  const apiKey = resolveOpenRouterKey();
  if (apiKey && apiKey.length >= 10 && hasLocal) {
    console.log('[TTS] Hybrid engine: OpenRouter live + local cache warming.');
    return new HybridTTSEngine(new KokoroTTSEngine({ apiKey }), local);
  }

  // 2) OpenRouter only (fast, but no local cache available).
  if (apiKey && apiKey.length >= 10) {
    console.log('[TTS] Kokoro TTS engine initialized (OpenRouter).');
    return new KokoroTTSEngine({ apiKey });
  }

  // 3) Local only (free, offline, but slow on this CPU).
  if (hasLocal) {
    console.log('[TTS] Using local Kokoro engine (slow, offline).');
    return local;
  }

  // 4) Stub.
  console.warn('[TTS] No local Kokoro or OpenRouter key found. TTS disabled.');
  return new StubTTSEngine();
}

function localPythonPath(): string {
  // User-level (shared by dev + packaged). The venv lives here so the
  // packaged app can find it without bundling 100MB+ into the binary.
  const userPath = path.join(app.getPath('home'), '.local', 'share', 'bible-app-kokoro', 'tts-venv', 'bin', 'python');
  if (fs.existsSync(userPath)) return userPath;
  if (app.isPackaged) return path.join(process.resourcesPath, 'tts-venv', 'bin', 'python');
  return path.join(app.getAppPath(), 'tts-venv', 'bin', 'python');
}
function localServicePath(): string {
  // The service script is bundled inside app.asar (dev) or resources (packaged).
  if (app.isPackaged) return path.join(process.resourcesPath, 'electron', 'kokoro_service.py');
  return path.join(app.getAppPath(), 'electron', 'kokoro_service.py');
}

/** Resolve the OpenRouter API key: env var > ~/.hermes/.env > null. */
function resolveOpenRouterKey(): string | null {
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }
  try {
    const envPath = path.join(homedir(), '.hermes', '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    const match = content.match(/^OPENROUTER_API_KEY=(.+)/m);
    if (match?.[1] && !match[1].startsWith('#')) {
      return match[1].trim();
    }
  } catch {
    // ~/.hermes/.env not found
  }
  return null;
}

const bibleLoader = new BibleLoader(getBiblesPath());
const store = new JsonStore(path.join(app.getPath('userData'), 'settings.json'));

function getBiblesPath(): string {
  if (app.isPackaged) {
    // electron-builder copies bibles/ into <app>/resources/bibles
    return path.join(process.resourcesPath, 'bibles');
  }
  return path.join(app.getAppPath(), 'bibles');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: Number(process.env.DEBUG_WIDTH ?? 1280),
    height: Number(process.env.DEBUG_HEIGHT ?? 860),
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#fcfcfc',
    title: 'Bible App',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in the system browser, never in-app
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    void loadDevURL(mainWindow);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Debug/QA hook: DEBUG_SHOT=/path/out.png captures a screenshot after the
  // page settles. DEBUG_SHOT_SCRIPT=/path/script.js runs in the page first
  // (drives UI interactions), DEBUG_SHOT_DELAY_MS tunes the settle delay.
  // DEBUG_WIDTH/DEBUG_HEIGHT override the window size.
  const debugShot = process.env.DEBUG_SHOT;
  if (debugShot) {
    const win = mainWindow;
    const delay = Number(process.env.DEBUG_SHOT_DELAY_MS ?? 2200);
    const scriptPath = process.env.DEBUG_SHOT_SCRIPT;
    win?.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        const run = () => {
          setTimeout(() => {
            void win?.webContents.capturePage().then((image) => {
              fs.writeFileSync(debugShot, image.toPNG());
              console.log('SHOT-SAVED:' + debugShot);
              app.quit();
            });
          }, delay);
        };
        if (scriptPath) {
          const script = fs.readFileSync(scriptPath, 'utf-8');
          void win?.webContents.executeJavaScript(script).then(run).catch((err) => {
            console.error('SCRIPT-ERROR:' + err);
            run();
          });
        } else {
          run();
        }
      }, 600);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** In dev, wait for the Vite server to come up before loading. */
async function loadDevURL(win: BrowserWindow): Promise<void> {
  const url = 'http://localhost:5173';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await win.loadURL(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Vite dev server not reachable at ${url}`);
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------
function registerIpc(): void {
  ipcMain.handle('bible:get-catalog', () => bibleLoader.getCatalog());

  ipcMain.handle(
    'bible:get-chapter',
    (_event, payload: { abbr: string; bookIndex: number; chapterIndex: number }) =>
      bibleLoader.getChapter(payload.abbr, payload.bookIndex, payload.chapterIndex),
  );

  ipcMain.handle('bible:get-book-list', (_event, abbr: string) => bibleLoader.getBookList(abbr));

  ipcMain.handle(
    'bible:search',
    (_event, payload: { abbr: string; query: string; maxResults?: number }) =>
      bibleLoader.search(payload.abbr, payload.query, payload.maxResults ?? 50),
  );

  ipcMain.handle(
    'bible:get-verses',
    (
      _event,
      payload: {
        abbrs: string[];
        bookIndex: number;
        chapterIndex: number;
        verseIndex: number;
      },
    ) => bibleLoader.getVerses(payload.abbrs, payload.bookIndex, payload.chapterIndex, payload.verseIndex),
  );

  ipcMain.handle('tts:is-available', () => ttsEngine.isAvailable());
  ipcMain.handle('tts:get-stats', () => {
    if ('getStats' in ttsEngine) {
      return (ttsEngine as unknown as { getStats: () => { cached: number; lastSource: string } }).getStats();
    }
    return { cached: 0, lastSource: 'none' };
  });
  ipcMain.handle('tts:speak', (_event, payload: { text: string }) => ttsEngine.speak(payload.text));
  ipcMain.handle('tts:prefetch', (_event, payload: { text: string }) => {
    if ('prefetch' in ttsEngine) {
      // Return the promise (not void) so the renderer can await a verse's
      // prefetch (e.g. verse 0 before the chapter loop starts).
      return (ttsEngine as unknown as { prefetch: (t: string) => Promise<void> }).prefetch(payload.text);
    }
  });
  ipcMain.handle('tts:stop', () => ttsEngine.stop());
  ipcMain.handle('tts:update-config', (_event, payload: { voice?: string; speed?: number }) => {
    if ('updateConfig' in ttsEngine) {
      (ttsEngine as KokoroTTSEngine).updateConfig(payload.voice, payload.speed);
    }
  });

  ttsEngine.onStateChange((state) => {
    mainWindow?.webContents.send('tts:state-change', state);
  });

  ipcMain.handle('store:get', (_event, key: string) => store.get(key));
  ipcMain.handle('store:set', (_event, payload: { key: string; value: unknown }) =>
    store.set(payload.key, payload.value),
  );
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();

    if (app.isPackaged) {
      // Strict CSP for the packaged build; Vite dev needs relaxed headers.
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
            ],
          },
        });
      });
    }

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Clean up TTS temp files on quit
  app.on('before-quit', () => {
    if ('cleanup' in ttsEngine) {
      (ttsEngine as KokoroTTSEngine).cleanup();
    }
  });
}
