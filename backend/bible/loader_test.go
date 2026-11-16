package bible

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func mustJSON(t *testing.T, v interface{}) []byte {
	t.Helper()
	buf, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return buf
}

func writeTestBibles(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	genesis := [][]string{
		{"In the beginning God created the heaven and the earth.", "And the earth was without form."},
		{"Thus the heavens and the earth were finished.", "And God blessed the seventh day."},
	}
	exodus := [][]string{
		{"Now these are the names of the children of Israel.", "And Joseph died."},
	}
	write := func(tr Translation) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, tr.Abbr+".json"), mustJSON(t, tr), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(Translation{Abbr: "KJV", Name: "King James Version", Copyright: "Public Domain", Books: []Book{
		{Name: "Genesis", Chapters: genesis},
		{Name: "Exodus", Chapters: exodus},
	}})
	write(Translation{Abbr: "NKJV", Name: "New King James Version", Copyright: "Test", Books: []Book{
		{Name: "Genesis", Chapters: genesis},
	}})
	catalog := []TranslationMeta{
		{Abbr: "KJV", Name: "King James Version", Copyright: "Public Domain", Books: 2, Chapters: 3, Verses: 6},
		{Abbr: "NKJV", Name: "New King James Version", Copyright: "Test", Books: 1, Chapters: 2, Verses: 4},
	}
	if err := os.WriteFile(filepath.Join(dir, "index.json"), mustJSON(t, catalog), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestCatalog(t *testing.T) {
	l := NewLoader(writeTestBibles(t))
	cat, err := l.GetCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if len(cat) != 2 || cat[0].Abbr != "KJV" {
		t.Fatalf("unexpected catalog: %+v", cat)
	}
}

func TestChapterAndBookList(t *testing.T) {
	l := NewLoader(writeTestBibles(t))
	books, err := l.GetBookList("KJV")
	if err != nil {
		t.Fatal(err)
	}
	if len(books) != 2 || books[0].ChapterCount != 2 {
		t.Fatalf("unexpected book list: %+v", books)
	}
	ch, err := l.GetChapter("KJV", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if ch.BookName != "Genesis" || ch.ChapterNumber != 1 || len(ch.Verses) != 2 {
		t.Fatalf("unexpected chapter: %+v", ch)
	}
	if _, err := l.GetChapter("KJV", 9, 0); err == nil {
		t.Fatal("expected out-of-range book error")
	}
	if _, err := l.GetChapter("KJV", 0, 9); err == nil {
		t.Fatal("expected out-of-range chapter error")
	}
}

func TestSearch(t *testing.T) {
	l := NewLoader(writeTestBibles(t))
	res, err := l.Search("KJV", "beginning", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 1 || res[0].Reference != "Genesis 1:1" {
		t.Fatalf("unexpected search: %+v", res)
	}
	if res, _ := l.Search("KJV", "   ", 50); len(res) != 0 {
		t.Fatal("expected empty results for blank query")
	}
}

func TestGetVersesOrdered(t *testing.T) {
	l := NewLoader(writeTestBibles(t))
	var got []int
	entries := l.GetVerses([]string{"KJV", "NKJV", "MISSING"}, 0, 0, 0, func(i int, e CompareVerseEntry) {
		got = append(got, i)
	})
	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}
	if entries[0].Text == "" || entries[1].Text == "" {
		t.Fatalf("expected verse text, got %+v", entries)
	}
	if entries[2].Abbr != "MISSING" || entries[2].Text != "" {
		t.Fatalf("expected empty fallback entry, got %+v", entries[2])
	}
	// Progress callbacks must arrive as a contiguous prefix 0,1,2.
	for i, v := range got {
		if v != i {
			t.Fatalf("progress out of order: %v", got)
		}
	}
}
