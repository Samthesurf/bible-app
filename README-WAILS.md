# Bible App: Go/Wails port

This branch ports the Electron main process to **Go/Wails** while keeping the
React frontend pixel-for-pixel identical. Same UI, same UX, same behaviour.

## Layout

```
main.go                  Wails entrypoint (window 1280x860, min 720x560)
app.go                   Bound App: bible / tts / store / OpenURL + Startup/Shutdown
wails.json               Wails project config (builds the same Vite frontend)
backend/bible/loader.go  Port of electron/bible-loader.ts + verse-workers.ts
backend/store/store.go   Port of electron/store.ts (JSON settings file)
backend/tts/tts.go       Port of tts-stub/kokoro/local/hybrid engines
src/wails-bridge.ts      Maps window.electronAPI onto the Go bindings
```

The Electron code (`electron/`) is untouched and still works: `src/main.tsx`
imports the bridge, which only activates when `window.go.*` exists (Wails)
and leaves `window.electronAPI` alone otherwise.

## Parity notes

- **Bible data**: same `bibles/*.json` files. Resolution order:
  `BIBLE_DATA_DIR` env > `bibles/` next to the binary > `./bibles` (dev).
  Generate with `python3 build_bibles.py` (gitignored, ~204 MB).
- **Parsing**: each translation is read + parsed at most once per session
  (sticky in-memory cache, the Go equivalent of the worker pool's sticky
  home-worker routing). `GetVerses` resolves translations in parallel and
  emits `bible:verses-progress` in the same top-to-bottom contiguous-prefix
  order as Electron, so the compare popup streams identically.
- **Settings**: `~/.config/bible-app/settings.json` (Wails) vs Electron's
  `userData/settings.json`. Same keys, so behaviour matches; values are
  stored per-backend. `getAll` keeps the single-round-trip hydration.
- **TTS**: same four-engine priority (hybrid > OpenRouter > local > stub),
  same OpenRouter endpoint/headers/retry policy, same `mpv` playback, same
  persistent cache dir (`~/.cache/bible-app-kokoro/cache`), same Python
  service protocol (`electron/kokoro_service.py`, clean env, `-u -E`).
  State events keep the same shape (`{status, text?, message?}`).
- **External links**: open in the system browser via `OpenURL`, never in-app.
- **Window**: same title, size, minimum size and background colour.

## Development

```bash
go version            # needs Go 1.24+
npm install           # frontend deps (first time only)

# Vite + Wails hot reload
wails dev

# Or plain Vite against the Electron backend (unchanged)
npm run dev:electron
```

## Building

```bash
# 1. Bible data (required at runtime, not bundled in git)
python3 build_bibles.py

# 2. Linux desktop binary (needs libgtk-3-dev + libwebkit2gtk-4.1-dev)
npm run build:wails

# Binary lands in build/bin/bible-app-wails.
# Ship a bibles/ directory next to it (or set BIBLE_DATA_DIR).
```

## Verification

```bash
go vet ./...              # backend typecheck
npx tsc -p tsconfig.node.json --noEmit   # electron main still compiles
npm run build:renderer    # frontend bundle (shared by both backends)
```
