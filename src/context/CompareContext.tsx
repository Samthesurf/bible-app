import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useBible } from './BibleContext';
import type { CompareVerseEntry } from '../types/bible';
import CompareVersions from '../components/CompareVersions';

export interface CompareVerse {
  reference: string;
  bookIndex: number;
  chapterIndex: number;
  verseIndex: number;
  currentAbbr: string;
  /** Instant text from the already-loaded chapter, shown until bulk load resolves. */
  currentText: string;
}

interface CompareState {
  verse: CompareVerse | null;
  entries: CompareVerseEntry[] | null;
  loading: boolean;
  openCompare: (verse: CompareVerse) => void;
  closeCompare: () => void;
}

const CompareContext = createContext<CompareState | null>(null);

export function CompareProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { catalog } = useBible();
  const [verse, setVerse] = useState<CompareVerse | null>(null);
  const [entries, setEntries] = useState<CompareVerseEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  const closeCompare = useCallback(() => {
    requestIdRef.current += 1; // invalidate any in-flight fetch
    setVerse(null);
    setEntries(null);
    setLoading(false);
  }, []);

  const openCompare = useCallback(
    (v: CompareVerse) => {
      if (!catalog.length) return;
      const requestId = ++requestIdRef.current;
      setVerse(v);
      setLoading(true);
      setEntries(null);

      // Instant row for the current translation from the already-loaded chapter.
      const currentEntry: CompareVerseEntry = {
        abbr: v.currentAbbr,
        name: '',
        copyright: '',
        text: v.currentText,
      };

      const abbrs = catalog.map((t) => t.abbr);
      void window.electronAPI.bible
        .getVerses(abbrs, v.bookIndex, v.chapterIndex, v.verseIndex)
        .then((loaded) => {
          if (requestId !== requestIdRef.current) return; // stale
          setEntries(loaded);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (requestId !== requestIdRef.current) return;
          console.error('COMPARE-GET-VERSES-FAILED:', err instanceof Error ? err.message : String(err));
          // Fall back to just the current verse on failure.
          setEntries([currentEntry]);
          setLoading(false);
        });
    },
    [catalog],
  );

  // Close on Escape.
  useEffect(() => {
    if (!verse) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCompare();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [verse, closeCompare]);

  const value = useMemo<CompareState>(
    () => ({ verse, entries, loading, openCompare, closeCompare }),
    [verse, entries, loading, openCompare, closeCompare],
  );

  return (
    <CompareContext.Provider value={value}>
      {children}
      <CompareVersions
        verse={verse}
        entries={entries}
        loading={loading}
        onClose={closeCompare}
      />
    </CompareContext.Provider>
  );
}

export function useCompare(): CompareState {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error('useCompare must be used within CompareProvider');
  return ctx;
}