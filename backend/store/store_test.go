package store

import (
	"path/filepath"
	"testing"
)

func TestGetSetRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(filepath.Join(dir, "settings.json"))

	if v, ok := s.Get("missing"); ok || v != nil {
		t.Fatalf("expected absent key, got %v", v)
	}
	if err := s.Set("theme", "dark"); err != nil {
		t.Fatal(err)
	}
	if err := s.Set("fontSize", float64(20)); err != nil {
		t.Fatal(err)
	}

	all := s.GetAll()
	if all["theme"] != "dark" || all["fontSize"] != float64(20) {
		t.Fatalf("unexpected snapshot: %v", all)
	}

	// A fresh handle on the same file must see persisted values.
	s2 := NewStore(filepath.Join(dir, "settings.json"))
	v, ok := s2.Get("theme")
	if !ok || v != "dark" {
		t.Fatalf("expected persisted theme, got %v", v)
	}
}
