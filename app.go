package main

// App is the Wails backend for the Bible App. It exposes the same surface
// the Electron main process exposes over IPC (see electron/main.ts and
// electron/preload.ts), so the React frontend runs unchanged:
//
//	bible:  GetCatalog / GetChapter / GetBookList / Search / GetVerses
//	        (+ "bible:verses-progress" events while a compare streams in)
//	tts:    TTSIsAvailable / TTSGetStats / TTSSpeak / TTSPrefetch /
//	        TTSStop / TTSUpdateConfig (+ "tts:state-change" events)
//	store:  StoreGet / StoreGetAll / StoreSet
//
// The frontend bridge (frontend/src/wails-bridge.ts) maps window.electronAPI
// onto these methods when running inside Wails, so every context, hook and
// component behaves exactly as in the Electron build.

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/Samthesurf/bible-app/backend/bible"
	"github.com/Samthesurf/bible-app/backend/store"
	"github.com/Samthesurf/bible-app/backend/tts"
)

// VersesResult is the resolved payload of a GetVerses call.
type VersesResult struct {
	RequestID string                   `json:"requestId"`
	Entries   []bible.CompareVerseEntry `json:"entries"`
}

// TTSStats mirrors the Electron tts:get-stats payload.
type TTSStats struct {
	Cached     int    `json:"cached"`
	LastSource string `json:"lastSource"`
}

// App holds backend state for the Wails runtime.
type App struct {
	ctx   context.Context
	Bible *bible.Loader
	Store *store.Store
	TTS   tts.Engine
}

// NewApp resolves data paths and wires the engines (same priority order as
// Electron's createTTSEngine).
func NewApp() *App {
	biblesDir := resolveBiblesDir()
	println("[Bible] data dir: " + biblesDir)
	loader := bible.NewLoader(biblesDir)

	settingsPath := resolveSettingsPath()
	st := store.NewStore(settingsPath)

	pythonPath, servicePath := resolveLocalTTSPaths()
	engine := tts.NewEngine(servicePath, pythonPath)

	return &App{Bible: loader, Store: st, TTS: engine}
}

// Startup runs when the Wails runtime is ready. It wires TTS state changes
// to frontend events and starts the background translation prewarm.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	a.TTS.OnStateChange(func(s tts.State) {
		runtime.EventsEmit(a.ctx, "tts:state-change", s)
	})
	a.Bible.Prepare()
	a.Bible.StartBackgroundPrewarm()
}

// Shutdown releases backend resources (TTS service, temp files).
func (a *App) Shutdown(_ context.Context) {
	a.Bible.Dispose()
	a.TTS.Cleanup()
}

// --- Bible ---------------------------------------------------------------

// GetCatalog returns the translation catalog.
func (a *App) GetCatalog() ([]bible.TranslationMeta, error) {
	return a.Bible.GetCatalog()
}

// GetChapter returns one chapter of one translation.
func (a *App) GetChapter(abbr string, bookIndex int, chapterIndex int) (bible.ChapterData, error) {
	return a.Bible.GetChapter(abbr, bookIndex, chapterIndex)
}

// GetBookList returns book names + chapter counts for one translation.
func (a *App) GetBookList(abbr string) ([]bible.BookMeta, error) {
	return a.Bible.GetBookList(abbr)
}

// Search runs a substring search inside one translation.
func (a *App) Search(abbr string, query string, maxResults int) ([]bible.SearchResult, error) {
	if maxResults <= 0 {
		maxResults = 50
	}
	return a.Bible.Search(abbr, query, maxResults)
}

// GetVerses resolves one verse across many translations, emitting
// "bible:verses-progress" events ({requestId, index, entry}) as the
// contiguous prefix fills, exactly like the Electron handler.
func (a *App) GetVerses(abbrs []string, bookIndex int, chapterIndex int, verseIndex int, requestID string) (VersesResult, error) {
	entries := a.Bible.GetVerses(abbrs, bookIndex, chapterIndex, verseIndex, func(index int, entry bible.CompareVerseEntry) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "bible:verses-progress", map[string]interface{}{
				"requestId": requestID,
				"index":     index,
				"entry":     entry,
			})
		}
	})
	return VersesResult{RequestID: requestID, Entries: entries}, nil
}

// --- TTS -----------------------------------------------------------------

// TTSIsAvailable reports whether any TTS engine is configured.
func (a *App) TTSIsAvailable() (bool, error) {
	return a.TTS.IsAvailable(), nil
}

// TTSGetStats returns cache diagnostics.
func (a *App) TTSGetStats() (TTSStats, error) {
	cached, lastSource := a.TTS.Stats()
	return TTSStats{Cached: cached, LastSource: lastSource}, nil
}

// TTSSpeak plays text aloud (blocks until playback finishes or stops).
func (a *App) TTSSpeak(text string) error {
	return a.TTS.Speak(text)
}

// TTSPrefetch warms audio for text ahead of playback.
func (a *App) TTSPrefetch(text string) error {
	return a.TTS.Prefetch(text)
}

// TTSStop halts playback.
func (a *App) TTSStop() error {
	return a.TTS.Stop()
}

// TTSUpdateConfig sets the runtime voice/speed. Empty voice or
// non-positive speed keeps the current value.
func (a *App) TTSUpdateConfig(voice string, speed float64) error {
	a.TTS.UpdateConfig(voice, speed)
	return nil
}

// --- Store ---------------------------------------------------------------

// StoreGet returns one persisted key (nil when absent).
func (a *App) StoreGet(key string) (interface{}, error) {
	v, ok := a.Store.Get(key)
	if !ok {
		return nil, nil
	}
	return v, nil
}

// StoreGetAll returns the whole settings object in one call.
func (a *App) StoreGetAll() (map[string]interface{}, error) {
	return a.Store.GetAll(), nil
}

// StoreSet persists one key.
func (a *App) StoreSet(key string, value interface{}) error {
	return a.Store.Set(key, value)
}

// OpenURL opens an external link in the system browser (Wails equivalent
// of Electron's setWindowOpenHandler deny + shell.openExternal).
func (a *App) OpenURL(url string) error {
	if a.ctx == nil {
		return nil
	}
	if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
		runtime.BrowserOpenURL(a.ctx, url)
	}
	return nil
}

// --- Path resolution -----------------------------------------------------

// resolveBiblesDir mirrors Electron's getBiblesPath: an explicit
// BIBLE_DATA_DIR wins, then a bibles/ directory next to the executable
// (packaged app), then the development checkout.
func resolveBiblesDir() string {
	if env := strings.TrimSpace(os.Getenv("BIBLE_DATA_DIR")); env != "" {
		return env
	}
	if exe, err := os.Executable(); err == nil {
		nextToExe := filepath.Join(filepath.Dir(exe), "bibles")
		if fi, err := os.Stat(nextToExe); err == nil && fi.IsDir() {
			return nextToExe
		}
		// Wails packaged layouts sometimes nest resources one level up.
		if cwd, err := os.Getwd(); err == nil {
			candidate := filepath.Join(cwd, "bibles")
			if fi, err := os.Stat(candidate); err == nil && fi.IsDir() {
				return candidate
			}
			_ = cwd
		}
	}
	return "bibles"
}

// resolveSettingsPath mirrors Electron's userData/settings.json using the
// OS config dir: ~/.config/bible-app/settings.json on Linux.
func resolveSettingsPath() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		home, herr := os.UserHomeDir()
		if herr != nil {
			return "settings.json"
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "bible-app", "settings.json")
}

// resolveLocalTTSPaths mirrors Electron's localPythonPath/localServicePath:
// the user-level venv (~/.local/share/bible-app-kokoro/tts-venv) is shared
// by dev and packaged builds; the service script sits next to the
// executable when packaged, else in the repo's electron/ directory.
func resolveLocalTTSPaths() (pythonPath, servicePath string) {
	home, _ := os.UserHomeDir()
	userPython := filepath.Join(home, ".local", "share", "bible-app-kokoro", "tts-venv", "bin", "python")
	if _, err := os.Stat(userPython); err == nil {
		pythonPath = userPython
	} else if exe, err := os.Executable(); err == nil {
		pythonPath = filepath.Join(filepath.Dir(exe), "tts-venv", "bin", "python")
	} else {
		pythonPath = filepath.Join("tts-venv", "bin", "python")
	}

	if exe, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "electron", "kokoro_service.py")
		if _, err := os.Stat(candidate); err == nil {
			return pythonPath, candidate
		}
	}
	return pythonPath, filepath.Join("electron", "kokoro_service.py")
}
