# Bible App 📖

An offline desktop Bible reader built with Electron + React + TypeScript,
replicating the clean Bible.com reading experience. Ships with **56 English
translations** (~204 MB) fully bundled, no internet required.

## Features

- **56 translations**: KJV, NKJV, NLT, GNT, GW, ESV, NIV, NASB and more,
  switched via the version dropdown (filterable)
- **Bible.com-style reading UI**: centered serif column, superscript verse
  numbers, circular prev/next arrows, copyright footer
- **Themes**: Light / Sepia / Dark via the AA popover, plus font size and
  line spacing sliders (persisted)
- **Parallel view**: two translations side by side with synced scrolling
  (stacks automatically in narrow windows)
- **Search**: instant verse search across the loaded translation, from the
  header search bar
- **Keyboard navigation**: ← / → for prev / next chapter
- **TTS**: toolbar audio button and per-verse play affordance, powered by
  the hybrid engine described below
- **Remembers your place**: last translation, book and chapter restored on
  launch

## Data

- `bibles/*.json`: one compact JSON per translation:
  `{abbr, name, copyright, books: [{name, chapters: [["verse 1", ...], ...]}]}`
- `bibles/index.json`: catalog (abbr, name, copyright, counts)
- Verse number = array index + 1
- Regenerate from the raw source with `python3 build_bibles.py` (re-clones
  the upstream repo first, see the script header)

## Development

```bash
npm install        # first time only
npm run dev:electron   # Vite dev server + Electron with HMR
```

Requirements: Node 20+, npm 10+. If npm blocks install scripts
(`install-scripts` warnings), run
`npm install-scripts approve electron esbuild electron-winstaller`.

## Building

```bash
npm run build          # tsc main + vite build + electron-builder (AppImage)
npm run build:dir      # unpacked build only (faster for testing)
```

The packaged app loads bibles from `<app>/resources/bibles`
(electron-builder `extraResources`). Artifacts land in `release/`.

## Text-to-speech

**Hybrid engine (default):** plays each verse live via OpenRouter's Kokoro
(`hexgrad/kokoro-82m`) while a **local Kokoro-onnx** model synthesizes the same
verse in the background into a persistent cache (`~/.cache/bible-app-kokoro/`).
The next time that verse is played it's read from the local cache; instant and
free. First pass through a passage costs a few cents of OpenRouter credits;
repeat readings are entirely offline. Falls back to OpenRouter-only, then
local-only, then a stub as prerequisites are missing.

- **OpenRouter** needs an API key (auto-resolved from `~/.hermes/.env` or the
  `OPENROUTER_API_KEY` env var).
- **Local Kokoro** needs a Python venv at `tts-venv/` with `kokoro-onnx` and the
  model in `~/.local/share/bible-app-kokoro/` (see `electron/kokoro_service.py`).
  Note: on modest CPUs local synthesis is ~15-50x slower than the API, which is
  why it's used as a background cache warmer rather than the live path.

The `TTSEngine` interface (`electron/tts-stub.ts`) stays the contract; swap
engines in `electron/main.ts` `createTTSEngine()`.

## Architecture

```
electron/           Main process (Node)
  main.ts           Window, IPC handlers, CSP, TTS wiring point
  preload.ts        contextBridge → window.electronAPI
  bible-loader.ts   Reads bibles/*.json, LRU cache (2 translations)
  store.ts          Tiny JSON settings store (userData)
  tts-stub.ts       TTSEngine interface + stub
src/                Renderer (React + Vite)
  context/          BibleContext (position/navigation), SettingsContext
  hooks/            useChapter, useKeyboardNav
  components/       Header, SearchBar, ReadingToolbar, pickers,
                    ChapterView, Verse, ParallelView, NavArrow,
                    TextSettingsPopover, TTSButton, Footer
  App.css           Design tokens + light/sepia/dark themes
```

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
strict CSP in packaged builds, external links open in the system browser.

## QA / debug hooks

`electron/main.ts` has env-guarded capture hooks used during visual QA:

```bash
DEBUG_SHOT=/tmp/shot.png DEBUG_SHOT_SCRIPT=/tmp/qa.js electron .
DEBUG_WIDTH=820 DEBUG_HEIGHT=640 DEBUG_SHOT=/tmp/narrow.png electron .
```

## License notes

KJV, ASV, WEB, DARBY, YLT, DRA and other public-domain texts are free to
redistribute. Modern versions (NKJV, NLT, GNT, GW, ESV, NIV, NASB, ...) are
copyrighted; their publishers have not granted redistribution rights, so
they are fine for a private app but require publisher licensing before a
public release. Each translation's `copyright` field carries the notice.
