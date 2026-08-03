import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { BookMeta, TranslationMeta } from '../types/bible';

type ParallelMode = 'translations' | 'chapters';

interface BibleState {
  catalog: TranslationMeta[];
  catalogLoaded: boolean;
  translationAbbr: string;
  bookIndex: number;
  chapterIndex: number;
  bookList: BookMeta[] | null;
  parallelEnabled: boolean;
  parallelMode: ParallelMode;
  secondaryAbbr: string | null;
  secondaryBookIndex: number;
  secondaryChapterIndex: number;
  setTranslation: (abbr: string) => void;
  navigate: (bookIndex: number, chapterIndex: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  toggleParallel: () => void;
  setParallelMode: (mode: ParallelMode) => void;
  setSecondaryTranslation: (abbr: string) => void;
  setSecondaryPosition: (bookIndex: number, chapterIndex: number) => void;
}

const BibleContext = createContext<BibleState | null>(null);

const DEFAULT_TRANSLATION = 'KJV';

export function BibleProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<TranslationMeta[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [translationAbbr, setTranslationAbbr] = useState(DEFAULT_TRANSLATION);
  const [bookIndex, setBookIndex] = useState(0);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [bookList, setBookList] = useState<BookMeta[] | null>(null);
  const [parallelEnabled, setParallelEnabled] = useState(false);
  const [parallelMode, setParallelModeState] = useState<ParallelMode>('translations');
  const [secondaryAbbr, setSecondaryAbbr] = useState<string | null>('NKJV');
  const [secondaryBookIndex, setSecondaryBookIndex] = useState(0);
  const [secondaryChapterIndex, setSecondaryChapterIndex] = useState(1);

  const hydrated = useRef(false);

  // Load catalog once
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.bible.getCatalog().then((c) => {
      if (!cancelled) {
        setCatalog(c);
        setCatalogLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Load book list for the current translation
  useEffect(() => {
    let cancelled = false;
    setBookList(null);
    void window.electronAPI.bible.getBookList(translationAbbr).then((books) => {
      if (!cancelled) setBookList(books);
    });
    return () => { cancelled = true; };
  }, [translationAbbr]);

  // Restore all persisted state once
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.electronAPI.store.get<string>('translationAbbr'),
      window.electronAPI.store.get<number>('bookIndex'),
      window.electronAPI.store.get<number>('chapterIndex'),
      window.electronAPI.store.get<string>('parallelMode'),
      window.electronAPI.store.get<string>('secondaryAbbr'),
      window.electronAPI.store.get<number>('secondaryBookIndex'),
      window.electronAPI.store.get<number>('secondaryChapterIndex'),
    ]).then(([abbr, book, chapter, pm, secAbbr, secBook, secChap]) => {
      if (cancelled) return;
      if (abbr) setTranslationAbbr(abbr);
      if (typeof book === 'number') setBookIndex(book);
      if (typeof chapter === 'number') setChapterIndex(chapter);
      if (pm === 'translations' || pm === 'chapters') setParallelModeState(pm);
      if (secAbbr) setSecondaryAbbr(secAbbr);
      if (typeof secBook === 'number') setSecondaryBookIndex(secBook);
      if (typeof secChap === 'number') setSecondaryChapterIndex(secChap);
      hydrated.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  // Persist position on change (only after hydration)
  useEffect(() => {
    if (!hydrated.current) return;
    void window.electronAPI.store.set('translationAbbr', translationAbbr);
  }, [translationAbbr]);
  useEffect(() => {
    if (!hydrated.current) return;
    void window.electronAPI.store.set('bookIndex', bookIndex);
  }, [bookIndex]);
  useEffect(() => {
    if (!hydrated.current) return;
    void window.electronAPI.store.set('chapterIndex', chapterIndex);
  }, [chapterIndex]);
  useEffect(() => {
    if (!hydrated.current) return;
    void window.electronAPI.store.set('parallelMode', parallelMode);
  }, [parallelMode]);
  useEffect(() => {
    if (!hydrated.current) return;
    void window.electronAPI.store.set('secondaryAbbr', secondaryAbbr);
  }, [secondaryAbbr]);
  useEffect(() => {
    if (!hydrated.current) return;
    void window.electronAPI.store.set('secondaryBookIndex', secondaryBookIndex);
  }, [secondaryBookIndex]);
  useEffect(() => {
    if (!hydrated.current) return;
    void window.electronAPI.store.set('secondaryChapterIndex', secondaryChapterIndex);
  }, [secondaryChapterIndex]);

  // Clamp position when the book list changes
  useEffect(() => {
    if (!bookList) return;
    if (bookIndex >= bookList.length) setBookIndex(0);
    const book = bookList[bookIndex];
    if (book && chapterIndex >= book.chapterCount) setChapterIndex(0);
  }, [bookList, bookIndex, chapterIndex]);

  const setTranslation = useCallback((abbr: string) => {
    setTranslationAbbr(abbr);
  }, []);

  const navigate = useCallback((book: number, chapter: number) => {
    setBookIndex(book);
    setChapterIndex(chapter);
  }, []);

  const nextChapter = useCallback(() => {
    setChapterIndex((c) => {
      if (!bookList) return c + 1;
      const book = bookList[bookIndex];
      if (book && c + 1 < book.chapterCount) return c + 1;
      if (bookIndex + 1 < bookList.length) {
        setBookIndex(bookIndex + 1);
        return 0;
      }
      return c;
    });
  }, [bookIndex, bookList]);

  const prevChapter = useCallback(() => {
    setChapterIndex((c) => {
      if (c > 0) return c - 1;
      if (!bookList) return 0;
      if (bookIndex - 1 >= 0) {
        const prevBook = bookList[bookIndex - 1];
        setBookIndex(bookIndex - 1);
        return prevBook ? prevBook.chapterCount - 1 : 0;
      }
      return 0;
    });
  }, [bookIndex, bookList]);

  const toggleParallel = useCallback(() => {
    setParallelEnabled((enabled) => !enabled);
  }, []);

  const setParallelMode = useCallback((mode: ParallelMode) => {
    setParallelModeState(mode);
    // Smart default: when switching to chapters mode, set secondary to next chapter
    if (mode === 'chapters' && bookList) {
      const book = bookList[bookIndex];
      if (book) {
        setSecondaryBookIndex(bookIndex);
        setSecondaryChapterIndex(Math.min(chapterIndex + 1, book.chapterCount - 1));
      }
    }
  }, [bookIndex, chapterIndex, bookList]);

  const setSecondaryTranslation = useCallback((abbr: string) => {
    setSecondaryAbbr(abbr);
  }, []);

  const setSecondaryPosition = useCallback((book: number, chapter: number) => {
    setSecondaryBookIndex(book);
    setSecondaryChapterIndex(chapter);
  }, []);

  const value = useMemo<BibleState>(
    () => ({
      catalog,
      catalogLoaded,
      translationAbbr,
      bookIndex,
      chapterIndex,
      bookList,
      parallelEnabled,
      parallelMode,
      secondaryAbbr,
      secondaryBookIndex,
      secondaryChapterIndex,
      setTranslation,
      navigate,
      nextChapter,
      prevChapter,
      toggleParallel,
      setParallelMode,
      setSecondaryTranslation,
      setSecondaryPosition,
    }),
    [
      catalog, catalogLoaded, translationAbbr, bookIndex, chapterIndex, bookList,
      parallelEnabled, parallelMode, secondaryAbbr, secondaryBookIndex, secondaryChapterIndex,
      setTranslation, navigate, nextChapter, prevChapter, toggleParallel,
      setParallelMode, setSecondaryTranslation, setSecondaryPosition,
    ],
  );

  return <BibleContext.Provider value={value}>{children}</BibleContext.Provider>;
}

export function useBible(): BibleState {
  const ctx = useContext(BibleContext);
  if (!ctx) throw new Error('useBible must be used within BibleProvider');
  return ctx;
}