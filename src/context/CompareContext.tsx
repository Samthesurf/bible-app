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

let requestSeq = 0;

export function CompareProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { catalog } = useBible();
  const [verse, setVerse] = useState<CompareVerse | null>(null);
  const [entries, setEntries] = useState<CompareVerseEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const entriesRef = useRef<CompareVerseEntry[] | null>(null);

  const closeCompare = useCallback(() => {
    requestIdRef.current = null;
    entriesRef.current = null;
    setVerse(null);
    setEntries(null);
    setLoading(false);
  }, []);

  const openCompare = useCallback(
    (v: CompareVerse) => {
      if (!catalog.length) return;
      const requestId = `cmp-${++requestSeq}`;
      requestIdRef.current = requestId;

      // Instant row for the current translation from the already-loaded chapter.
      const currentEntry: CompareVerseEntry = {
        abbr: v.currentAbbr,
        name: '',
        copyright: '',
        text: v.currentText,
      };

      // Pre-allocate the full array so progressive entries fill top-to-bottom.
      const slots: (CompareVerseEntry | null)[] = new Array(catalog.length).fill(null);
      setVerse(v);
      setEntries(slots as CompareVerseEntry[]);
      setLoading(true);

      const apply = (index: number, entry: CompareVerseEntry) => {
        if (requestIdRef.current !== requestId) return; // stale request
        slots[index] = entry;
        setEntries([...slots] as CompareVerseEntry[]);
      };

      // Stream from the main process as translations resolve.
      const unsubscribe = window.electronAPI.bible.onVersesProgress(({ requestId: rid, index, entry }) => {
        if (rid !== requestId) return;
        apply(index, entry);
      });

      const abbrs = catalog.map((t) => t.abbr);
      void window.electronAPI.bible
        .getVerses(abbrs, v.bookIndex, v.chapterIndex, v.verseIndex, requestId)
        .then(({ entries: loaded }) => {
          if (requestIdRef.current !== requestId) {
            unsubscribe();
            return;
          }
          // Ensure every slot is filled (belt and braces after streaming).
          const final = [...loaded];
          setEntries(final);
          setLoading(false);
          unsubscribe();
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) {
            unsubscribe();
            return;
          }
          // Fall back to just the current verse on failure.
          const fallback: (CompareVerseEntry | null)[] = new Array(catalog.length).fill(null);
          fallback[0] = currentEntry;
          setEntries(fallback as CompareVerseEntry[]);
          setLoading(false);
          unsubscribe();
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
      <CompareVersions verse={verse} entries={entries} loading={loading} onClose={closeCompare} />
    </CompareContext.Provider>
  );
}

export function useCompare(): CompareState {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error('useCompare must be used within CompareProvider');
  return ctx;
}