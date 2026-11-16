// Package bible is a Go port of electron/bible-loader.ts + electron/verse-workers.ts.
//
// All translation parsing lives here, behind a parsed-translation cache, so
// chapter reads, book lists, searches and verse compares never block the
// Wails event loop. Each translation file is read + JSON.parsed at most once
// per app session (sticky cache routing mirrors the Electron worker pool's
// sticky home-worker routing).
package bible

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// TranslationMeta mirrors the catalog rows in bibles/index.json.
type TranslationMeta struct {
	Abbr      string `json:"abbr"`
	Name      string `json:"name"`
	Copyright string `json:"copyright"`
	Books     int    `json:"books"`
	Chapters  int    `json:"chapters"`
	Verses    int    `json:"verses"`
}

// Book is one book of a parsed translation.
type Book struct {
	Name     string     `json:"name"`
	Chapters [][]string `json:"chapters"`
}

// Translation is one fully parsed <ABBR>.json file.
type Translation struct {
	Abbr      string `json:"abbr"`
	Name      string `json:"name"`
	Copyright string `json:"copyright"`
	Books     []Book `json:"books"`
}

// ChapterData is the payload for one chapter read.
type ChapterData struct {
	Abbr            string   `json:"abbr"`
	BookName        string   `json:"bookName"`
	BookIndex       int      `json:"bookIndex"`
	ChapterIndex    int      `json:"chapterIndex"`
	ChapterNumber   int      `json:"chapterNumber"`
	TotalChapters   int      `json:"totalChapters"`
	Verses          []string `json:"verses"`
	Copyright       string   `json:"copyright"`
	TranslationName string   `json:"translationName"`
}

// BookMeta is one row of a translation's book list.
type BookMeta struct {
	Name         string `json:"name"`
	ChapterCount int    `json:"chapterCount"`
}

// SearchResult is one verse hit.
type SearchResult struct {
	BookIndex    int    `json:"bookIndex"`
	ChapterIndex int    `json:"chapterIndex"`
	VerseIndex   int    `json:"verseIndex"`
	Reference    string `json:"reference"`
	Text         string `json:"text"`
}

// CompareVerseEntry is one translation's text for a compared verse.
type CompareVerseEntry struct {
	Abbr      string `json:"abbr"`
	Name      string `json:"name"`
	Copyright string `json:"copyright"`
	Text      string `json:"text"`
}

// Loader owns every parsed translation for the session.
type Loader struct {
	dir string

	mu           sync.RWMutex
	translations map[string]*Translation

	catalogMu sync.RWMutex
	catalog   []TranslationMeta

	prewarmMu      sync.Mutex
	prewarmStarted bool
	disposed       bool
}

// NewLoader creates a loader for the bibles directory.
func NewLoader(dir string) *Loader {
	return &Loader{
		dir:          dir,
		translations: make(map[string]*Translation),
	}
}

// GetCatalog reads bibles/index.json (cached after the first read).
func (l *Loader) GetCatalog() ([]TranslationMeta, error) {
	l.catalogMu.RLock()
	if l.catalog != nil {
		c := l.catalog
		l.catalogMu.RUnlock()
		return c, nil
	}
	l.catalogMu.RUnlock()

	raw, err := os.ReadFile(filepath.Join(l.dir, "index.json"))
	if err != nil {
		return nil, err
	}
	var catalog []TranslationMeta
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return nil, err
	}
	l.catalogMu.Lock()
	l.catalog = catalog
	l.catalogMu.Unlock()
	return catalog, nil
}

// load returns the parsed translation, reading + parsing the JSON file at
// most once per session.
func (l *Loader) load(abbr string) (*Translation, error) {
	l.mu.RLock()
	if t, ok := l.translations[abbr]; ok {
		l.mu.RUnlock()
		return t, nil
	}
	l.mu.RUnlock()

	raw, err := os.ReadFile(filepath.Join(l.dir, abbr+".json"))
	if err != nil {
		return nil, err
	}
	var t Translation
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, err
	}
	l.mu.Lock()
	// Another goroutine may have parsed it while we worked; keep the first.
	if existing, ok := l.translations[abbr]; ok {
		l.mu.Unlock()
		return existing, nil
	}
	l.translations[abbr] = &t
	l.mu.Unlock()
	return &t, nil
}

// GetBookList returns book names + chapter counts for one translation.
func (l *Loader) GetBookList(abbr string) ([]BookMeta, error) {
	t, err := l.load(abbr)
	if err != nil {
		return nil, err
	}
	books := make([]BookMeta, len(t.Books))
	for i, b := range t.Books {
		books[i] = BookMeta{Name: b.Name, ChapterCount: len(b.Chapters)}
	}
	return books, nil
}

// GetChapter returns full chapter data for one translation.
func (l *Loader) GetChapter(abbr string, bookIndex, chapterIndex int) (ChapterData, error) {
	t, err := l.load(abbr)
	if err != nil {
		return ChapterData{}, err
	}
	if bookIndex < 0 || bookIndex >= len(t.Books) {
		return ChapterData{}, fmt.Errorf("book index %d out of range for %s (%d books)", bookIndex, abbr, len(t.Books))
	}
	book := t.Books[bookIndex]
	if chapterIndex < 0 || chapterIndex >= len(book.Chapters) {
		return ChapterData{}, fmt.Errorf("chapter index %d out of range for %s %s", chapterIndex, abbr, book.Name)
	}
	return ChapterData{
		Abbr:            abbr,
		BookName:        book.Name,
		BookIndex:       bookIndex,
		ChapterIndex:    chapterIndex,
		ChapterNumber:   chapterIndex + 1,
		TotalChapters:   len(book.Chapters),
		Verses:          book.Chapters[chapterIndex],
		Copyright:       t.Copyright,
		TranslationName: t.Name,
	}, nil
}

// Search runs a case-insensitive substring search inside one translation.
func (l *Loader) Search(abbr, query string, maxResults int) ([]SearchResult, error) {
	if maxResults <= 0 {
		maxResults = 50
	}
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return []SearchResult{}, nil
	}
	t, err := l.load(abbr)
	if err != nil {
		return nil, err
	}
	results := make([]SearchResult, 0, maxResults)
outer:
	for b := range t.Books {
		book := &t.Books[b]
		for c := range book.Chapters {
			chapter := book.Chapters[c]
			for v := range chapter {
				if strings.Contains(strings.ToLower(chapter[v]), needle) {
					results = append(results, SearchResult{
						BookIndex:    b,
						ChapterIndex: c,
						VerseIndex:   v,
						Reference:    fmt.Sprintf("%s %d:%d", book.Name, c+1, v+1),
						Text:         chapter[v],
					})
					if len(results) >= maxResults {
						break outer
					}
				}
			}
		}
	}
	return results, nil
}

// getVerse resolves one verse from one translation. Out-of-range references
// yield an empty text (never an error), mirroring the Electron worker.
func (l *Loader) getVerse(abbr string, bookIndex, chapterIndex, verseIndex int) (CompareVerseEntry, error) {
	t, err := l.load(abbr)
	if err != nil {
		return CompareVerseEntry{}, err
	}
	text := ""
	if bookIndex >= 0 && bookIndex < len(t.Books) {
		book := t.Books[bookIndex]
		if chapterIndex >= 0 && chapterIndex < len(book.Chapters) {
			chapter := book.Chapters[chapterIndex]
			if verseIndex >= 0 && verseIndex < len(chapter) {
				text = chapter[verseIndex]
			}
		}
	}
	return CompareVerseEntry{Abbr: abbr, Name: t.Name, Copyright: t.Copyright, Text: text}, nil
}

type verseResult struct {
	index int
	entry CompareVerseEntry
}

// GetVerses fetches a single verse across many translations at once.
//
// Translations resolve in parallel (bounded by CPU count, like the Electron
// worker pool). Each translation is parsed exactly once per session, so the
// first compare warms the cache and later look-ups are in-memory.
//
// Results are delivered top-to-bottom via onEntry as soon as each
// translation resolves: whenever a fetch completes, the now-complete
// contiguous prefix is flushed, so the UI fills progressively instead of
// waiting for all 56 files.
func (l *Loader) GetVerses(abbrs []string, bookIndex, chapterIndex, verseIndex int, onEntry func(index int, entry CompareVerseEntry)) []CompareVerseEntry {
	entries := make([]CompareVerseEntry, len(abbrs))
	if len(abbrs) == 0 {
		return entries
	}
	workers := runtime.NumCPU()
	if workers < 2 {
		workers = 2
	}
	if workers > 8 {
		workers = 8
	}
	sem := make(chan struct{}, workers)
	ch := make(chan verseResult, len(abbrs))
	for i, abbr := range abbrs {
		go func(i int, abbr string) {
			sem <- struct{}{}
			defer func() { <-sem }()
			entry, err := l.getVerse(abbr, bookIndex, chapterIndex, verseIndex)
			if err != nil {
				entry = CompareVerseEntry{Abbr: abbr}
			}
			ch <- verseResult{index: i, entry: entry}
		}(i, abbr)
	}
	filled := make([]bool, len(abbrs))
	nextToEmit := 0
	for n := 0; n < len(abbrs); n++ {
		r := <-ch
		entries[r.index] = r.entry
		filled[r.index] = true
		for nextToEmit < len(abbrs) && filled[nextToEmit] {
			if onEntry != nil {
				onEntry(nextToEmit, entries[nextToEmit])
			}
			nextToEmit++
		}
	}
	return entries
}

// Prepare warms nothing by itself (Go has no thread-spawn cost on the
// critical path); it exists for API symmetry with the Electron loader.
func (l *Loader) Prepare() {}

// StartBackgroundPrewarm parses every translation in the background as a
// trickle: popular translations first so common compares are instant within
// a second or two, the rest following one at a time. Each translation is
// parsed exactly once, so the full set settles with no disk/CPU spikes.
func (l *Loader) StartBackgroundPrewarm() {
	l.prewarmMu.Lock()
	if l.prewarmStarted || l.disposed {
		l.prewarmMu.Unlock()
		return
	}
	l.prewarmStarted = true
	l.prewarmMu.Unlock()

	go func() {
		catalog, err := l.GetCatalog()
		if err != nil {
			return
		}
		popular := []string{"KJV", "NKJV", "NIV", "ESV", "NLT", "NASB", "CSB", "AMP", "MSG", "WEB"}
		rank := func(abbr string) int {
			for i, p := range popular {
				if p == abbr {
					return i
				}
			}
			return len(popular)
		}
		ordered := append([]TranslationMeta(nil), catalog...)
		sort.SliceStable(ordered, func(i, j int) bool { return rank(ordered[i].Abbr) < rank(ordered[j].Abbr) })

		time.Sleep(500 * time.Millisecond)
		for _, t := range ordered {
			l.prewarmMu.Lock()
			disposed := l.disposed
			l.prewarmMu.Unlock()
			if disposed {
				return
			}
			_, _ = l.load(t.Abbr)
			time.Sleep(150 * time.Millisecond)
		}
	}()
}

// Dispose stops background work. Parsed translations are plain memory and
// need no teardown.
func (l *Loader) Dispose() {
	l.prewarmMu.Lock()
	l.disposed = true
	l.prewarmMu.Unlock()
}
