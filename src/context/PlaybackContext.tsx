import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type PlaybackMode = 'idle' | 'chapter' | 'selection' | 'verse';

export interface SelectionRange {
  /** Which parallel column the selection came from (null = single view). */
  column: 'primary' | 'secondary' | null;
  start: number;
  end: number;
}

interface PlaybackValue {
  mode: PlaybackMode;
  speaking: boolean;
  /** Location of the currently playing text (for verse highlights). */
  bookIndex: number | null;
  chapterIndex: number | null;
  verseIndex: number | null;
  selection: SelectionRange | null;
  playChapter: (bookIndex: number, chapterIndex: number, verses: string[]) => Promise<void>;
  playSelection: (text: string, range: SelectionRange | null) => Promise<void>;
  playVerse: (bookIndex: number, chapterIndex: number, verseIndex: number, text: string) => Promise<void>;
  stop: () => Promise<void>;
}

const PlaybackContext = createContext<PlaybackValue | null>(null);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry a transient network/API failure once after a short pause. */
const describeError = (err: unknown): string => {
  if (err instanceof Error) {
    if (err.message.includes('fetch failed')) return 'network error reaching the TTS service';
    if (err.message.includes('TTS_STOPPED')) return 'stopped';
    return err.message;
  }
  return String(err);
};

export function PlaybackProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<PlaybackMode>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [bookIndex, setBookIndex] = useState<number | null>(null);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [verseIndex, setVerseIndex] = useState<number | null>(null);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopFlag = useRef(false);
  const errorTimer = useRef<number | null>(null);

  const showError = useCallback((message: string) => {
    setError(message);
    if (errorTimer.current) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimer.current) window.clearTimeout(errorTimer.current);
    };
  }, []);

  const resetPos = useCallback(() => {
    setBookIndex(null);
    setChapterIndex(null);
    setVerseIndex(null);
    setSelection(null);
  }, []);

  const stop = useCallback(async () => {
    stopFlag.current = true;
    await window.electronAPI.tts.stop();
    setMode('idle');
    setSpeaking(false);
    resetPos();
  }, [resetPos]);

  const speakWithRetry = useCallback(async (text: string): Promise<void> => {
    try {
      await window.electronAPI.tts.speak(text);
    } catch (err) {
      if (stopFlag.current) throw err; // user-initiated stop, not a real failure
      await sleep(1200);
      await window.electronAPI.tts.speak(text); // one retry
    }
  }, []);

  const playChapter = useCallback(
    async (bi: number, ci: number, verses: string[]) => {
      stopFlag.current = false;
      await window.electronAPI.tts.stop();
      setError(null);
      setMode('chapter');
      setSpeaking(true);
      setBookIndex(bi);
      setChapterIndex(ci);
      setVerseIndex(0);
      setSelection(null);

      for (let i = 0; i < verses.length; i += 1) {
        if (stopFlag.current) break;
        setVerseIndex(i);
        try {
          await speakWithRetry(verses[i]);
        } catch (err) {
          if (stopFlag.current) break;
          setMode('idle');
          setSpeaking(false);
          setVerseIndex(null);
          showError(`Audio stopped at verse ${i + 1}: ${describeError(err)}`);
          return;
        }
      }

      if (!stopFlag.current) {
        setMode('idle');
        setSpeaking(false);
        setVerseIndex(null);
      }
    },
    [showError, speakWithRetry],
  );

  const playSelection = useCallback(
    async (text: string, range: SelectionRange | null) => {
      stopFlag.current = false;
      await window.electronAPI.tts.stop();
      setError(null);
      setMode('selection');
      setSpeaking(true);
      setBookIndex(null);
      setChapterIndex(null);
      setVerseIndex(null);
      setSelection(range);

      try {
        await speakWithRetry(text);
      } catch (err) {
        if (!stopFlag.current) {
          showError(`Could not play selection: ${describeError(err)}`);
        }
      } finally {
        if (!stopFlag.current) {
          setMode('idle');
          setSpeaking(false);
        }
        setSelection(null);
      }
    },
    [showError, speakWithRetry],
  );

  const playVerse = useCallback(
    async (bi: number, ci: number, vi: number, text: string) => {
      stopFlag.current = false;
      await window.electronAPI.tts.stop();
      setError(null);
      setMode('verse');
      setSpeaking(true);
      setBookIndex(bi);
      setChapterIndex(ci);
      setVerseIndex(vi);
      setSelection(null);

      try {
        await speakWithRetry(text);
      } catch (err) {
        if (!stopFlag.current) {
          showError(`Could not play verse: ${describeError(err)}`);
        }
      } finally {
        if (!stopFlag.current) {
          setMode('idle');
          setSpeaking(false);
          setVerseIndex(null);
        }
      }
    },
    [showError, speakWithRetry],
  );

  const value = useMemo<PlaybackValue>(
    () => ({
      mode,
      speaking,
      bookIndex,
      chapterIndex,
      verseIndex,
      selection,
      playChapter,
      playSelection,
      playVerse,
      stop,
    }),
    [mode, speaking, bookIndex, chapterIndex, verseIndex, selection, playChapter, playSelection, playVerse, stop],
  );

  return (
    <PlaybackContext.Provider value={value}>
      {children}
      {error && (
        <div className="toast" role="status">
          {error}
        </div>
      )}
    </PlaybackContext.Provider>
  );
}

export function usePlayback(): PlaybackValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error('usePlayback must be used within PlaybackProvider');
  return ctx;
}
