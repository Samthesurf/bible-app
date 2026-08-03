import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { BibleLoader } from './bible-loader';
import { JsonStore } from './store';
import { StubTTSEngine, type TTSEngine } from './tts-stub';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// TTS wiring point: replace StubTTSEngine with a real implementation later.
// See electron/tts-stub.ts for the TTSEngine interface.
// ---------------------------------------------------------------------------
const ttsEngine: TTSEngine = new StubTTSEngine();

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

  ipcMain.handle('tts:is-available', () => ttsEngine.isAvailable());
  ipcMain.handle('tts:speak', (_event, payload: { text: string }) => ttsEngine.speak(payload.text));
  ipcMain.handle('tts:stop', () => ttsEngine.stop());

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
}
