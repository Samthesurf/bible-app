// Package store is a Go port of electron/store.ts: a minimal JSON file
// store that persists plain settings to a single file. Small,
// dependency-free, offline.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Store persists settings as JSON in one file.
type Store struct {
	mu       sync.Mutex
	filePath string
	data     map[string]interface{}
	loaded   bool
}

// NewStore creates a store backed by filePath.
func NewStore(filePath string) *Store {
	return &Store{filePath: filePath, data: make(map[string]interface{})}
}

func (s *Store) ensureLoadedLocked() {
	if s.loaded {
		return
	}
	raw, err := os.ReadFile(s.filePath)
	if err != nil {
		s.data = make(map[string]interface{})
		s.loaded = true
		return
	}
	if err := json.Unmarshal(raw, &s.data); err != nil {
		s.data = make(map[string]interface{})
	}
	if s.data == nil {
		s.data = make(map[string]interface{})
	}
	s.loaded = true
}

// Get returns one key (nil, false when absent).
func (s *Store) Get(key string) (interface{}, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureLoadedLocked()
	v, ok := s.data[key]
	return v, ok
}

// GetAll returns a copy of the whole settings object in one call (one IPC
// round trip for hydration).
func (s *Store) GetAll() map[string]interface{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureLoadedLocked()
	out := make(map[string]interface{}, len(s.data))
	for k, v := range s.data {
		out[k] = v
	}
	return out
}

// Set writes one key and flushes to disk.
func (s *Store) Set(key string, value interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureLoadedLocked()
	s.data[key] = value
	return s.flushLocked()
}

func (s *Store) flushLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.filePath + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.filePath)
}
