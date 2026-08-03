import React, { useCallback, useEffect, useState } from 'react';
import { useBible } from '../context/BibleContext';
import { useChapter } from '../hooks/useChapter';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import ChapterView from './ChapterView';
import ParallelView from './ParallelView';
import NavArrow from './NavArrow';
import './ReadingArea.css';

/**
 * The main reading surface: single or parallel chapter view, floating
 * prev/next arrows, keyboard navigation, and the per-verse TTS affordance.
 */
export default function ReadingArea(): React.ReactElement {
  const { translationAbbr, bookIndex, chapterIndex, bookList, parallelEnabled, nextChapter, prevChapter } =
    useBible();
  const { chapter, loading, error } = useChapter(translationAbbr, bookIndex, chapterIndex);

  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [playingVerse, setPlayingVerse] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.tts.isAvailable().then((ok) => {
      if (!cancelled) setTtsAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useKeyboardNav(prevChapter, nextChapter, !loading);

  const book = bookList?.[bookIndex];
  const atStart = bookIndex === 0 && chapterIndex === 0;
  const atEnd = book ? chapterIndex >= book.chapterCount - 1 && bookIndex >= (bookList?.length ?? 1) - 1 : false;

  const playVerse = useCallback((verseIndex: number, verseText: string) => {
    setPlayingVerse(verseIndex);
    void window.electronAPI.tts
      .speak(verseText)
      .then(() => setPlayingVerse(null))
      .catch(() => setPlayingVerse(null));
  }, []);

  return (
    <main className="reading-area">
      <NavArrow direction="prev" onClick={prevChapter} disabled={atStart} />
      <NavArrow direction="next" onClick={nextChapter} disabled={atEnd} />

      <div className="reading-area__content">
        {loading && !chapter && (
          <div className="reading-area__loading" aria-label="Loading chapter">
            <div className="skeleton" style={{ width: '40%', height: 28, margin: '0 auto 32px' }} />
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="skeleton" style={{ width: `${88 - (i % 5) * 7}%`, height: 16, marginBottom: 14 }} />
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="reading-area__error">
            <p>Couldn&apos;t load this chapter.</p>
            <p className="reading-area__error-detail">{error}</p>
          </div>
        )}

        {!loading && !error && chapter && !parallelEnabled && (
          <ChapterView
            chapter={chapter}
            ttsAvailable={ttsAvailable}
            onPlayVerse={playVerse}
            onStopVerse={() => {
              void window.electronAPI.tts.stop();
              setPlayingVerse(null);
            }}
            playingVerse={playingVerse}
          />
        )}

        {!loading && !error && chapter && parallelEnabled && (
          <ParallelView
            ttsAvailable={ttsAvailable}
            onPlayVerse={playVerse}
            onStopVerse={() => {
              void window.electronAPI.tts.stop();
              setPlayingVerse(null);
            }}
            playingVerse={playingVerse}
          />
        )}
      </div>
    </main>
  );
}
