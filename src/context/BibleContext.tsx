import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { BookMeta, TranslationMeta } from '../types/bible';

interface BibleState {
  catalog: TranslationMeta[];
  catalogLoaded: boolean;
  translationAbbr: string;
  bookIndex: number;
  chapterIndex: number;
  bookList: BookMeta[] | null;
  parallelEnabled: boolean;
  secondaryAbbr: string | null;
  setTranslation: (abbr: string) => void;
  navigate: (bookIndex: number, chapterIndex: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  toggleParallel: () => void;
  setSecondaryTranslation: (abbr: string) => void;
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
  const [secondaryAbbr, setSecondaryAbbr] = useState<string | null>('NKJV');

  // Load catalog once
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.bible.getCatalog().then((c) => {
      if (!cancelled) {
        setCatalog(c);
        setCatalogLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load book list for the current translation
  useEffect(() => {
    let cancelled = false;
    setBookList(null);
    void window.electronAPI.bible.getBookList(translationAbbr).then((books) => {
      if (!cancelled) setBookList(books);
    });
    return () => {
      cancelled = true;
    };
  }, [translationAbbr]);

  // Clamp position when the book list changes (e.g. switching translation)
  useEffect(() => {
    if (!bookList) return;
    if (bookIndex >= bookList.length) setBookIndex(0);
    const book = bookList[bookIndex];
    if (book && chapterIndex >= book.chapterCount) setChapterIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookList]);

  // Restore last position
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.electronAPI.store.get<string>('translationAbbr'),
      window.electronAPI.store.get<number>('bookIndex'),
      window.electronAPI.store.get<number>('chapterIndex'),
    ]).then(([abbr, book, chapter]) => {
      if (cancelled) return;
      if (abbr) setTranslationAbbr(abbr);
      if (typeof book === 'number') setBookIndex(book);
      if (typeof chapter === 'number') setChapterIndex(chapter);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist position on change
  useEffect(() => {
    void window.electronAPI.store.set('translationAbbr', translationAbbr);
  }, [translationAbbr]);
  useEffect(() => {
    void window.electronAPI.store.set('bookIndex', bookIndex);
  }, [bookIndex]);
  useEffect(() => {
    void window.electronAPI.store.set('chapterIndex', chapterIndex);
  }, [chapterIndex]);

  const setTranslation = useCallback((abbr: string) => {
    // Keep the current book/chapter; the clamp effect fixes out-of-range
    // positions after the new translation's book list loads.
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
      // Move to the next book, chapter 0
      if (bookIndex + 1 < bookList.length) {
        setBookIndex(bookIndex + 1);
        return 0;
      }
      return c; // already at the very end
    });
  }, [bookIndex, bookList]);

  const prevChapter = useCallback(() => {
    setChapterIndex((c) => {
      if (c > 0) return c - 1;
      if (!bookList) return 0;
      // Move to the previous book, last chapter
      if (bookIndex - 1 >= 0) {
        const prevBook = bookList[bookIndex - 1];
        setBookIndex(bookIndex - 1);
        return prevBook ? prevBook.chapterCount - 1 : 0;
      }
      return 0; // already at the very start
    });
  }, [bookIndex, bookList]);

  const toggleParallel = useCallback(() => {
    setParallelEnabled((enabled) => !enabled);
  }, []);

  const setSecondaryTranslation = useCallback((abbr: string) => {
    setSecondaryAbbr(abbr);
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
      secondaryAbbr,
      setTranslation,
      navigate,
      nextChapter,
      prevChapter,
      toggleParallel,
      setSecondaryTranslation,
    }),
    [
      catalog,
      catalogLoaded,
      translationAbbr,
      bookIndex,
      chapterIndex,
      bookList,
      parallelEnabled,
      secondaryAbbr,
      setTranslation,
      navigate,
      nextChapter,
      prevChapter,
      toggleParallel,
      setSecondaryTranslation,
    ],
  );

  return <BibleContext.Provider value={value}>{children}</BibleContext.Provider>;
}

export function useBible(): BibleState {
  const ctx = useContext(BibleContext);
  if (!ctx) throw new Error('useBible must be used within BibleProvider');
  return ctx;
}
