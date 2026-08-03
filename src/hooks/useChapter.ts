import { useEffect, useState } from 'react';
import type { ChapterData } from '../types/bible';

interface UseChapterResult {
  chapter: ChapterData | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads a chapter over IPC. Re-fetches whenever abbr/book/chapter change.
 */
export function useChapter(abbr: string, bookIndex: number, chapterIndex: number): UseChapterResult {
  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.electronAPI.bible
      .getChapter(abbr, bookIndex, chapterIndex)
      .then((data) => {
        if (!cancelled) setChapter(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [abbr, bookIndex, chapterIndex]);

  return { chapter, loading, error };
}
