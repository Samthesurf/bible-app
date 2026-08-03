import React, { useEffect, useRef, useState } from 'react';
import { useBible } from '../context/BibleContext';
import { usePlayback } from '../context/PlaybackContext';
import { useChapter } from '../hooks/useChapter';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import ChapterView from './ChapterView';
import ParallelView from './ParallelView';
import NavArrow from './NavArrow';
import SelectionTTS from './SelectionTTS';
import './ReadingArea.css';

/**
 * The main reading surface: single or parallel chapter view, floating
 * prev/next arrows, keyboard navigation, and the per-verse TTS affordance.
 */
export default function ReadingArea(): React.ReactElement {
  const { translationAbbr, bookIndex, chapterIndex, bookList, parallelEnabled, nextChapter, prevChapter } =
    useBible();
  const playback = usePlayback();
  const { chapter, loading, error } = useChapter(translationAbbr, bookIndex, chapterIndex);

  const [ttsAvailable, setTtsAvailable] = useState(false);
  const readingRef = useRef<HTMLElement>(null);

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

  // Live highlight: only when the playback is for the chapter currently on screen.
  const isCurrentChapter =
    (playback.mode === 'chapter' || playback.mode === 'verse') &&
    playback.bookIndex === bookIndex &&
    playback.chapterIndex === chapterIndex;
  const playingVerse = isCurrentChapter ? playback.verseIndex : null;

  return (
    <main className="reading-area" ref={readingRef}>
      <SelectionTTS containerRef={readingRef} ttsAvailable={ttsAvailable} />
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
            onPlayVerse={(i, text) => void playback.playVerse(bookIndex, chapterIndex, i, text)}
            onStopVerse={() => void playback.stop()}
            playingVerse={playingVerse}
            selectionHighlight={
              playback.mode === 'selection' && playback.selection && playback.selection.column !== 'secondary'
                ? { start: playback.selection.start, end: playback.selection.end }
                : null
            }
          />
        )}

        {!loading && !error && chapter && parallelEnabled && (
          <ParallelView
            ttsAvailable={ttsAvailable}
            onPlayVerse={(i, text) => void playback.playVerse(bookIndex, chapterIndex, i, text)}
            onStopVerse={() => void playback.stop()}
            playingVerse={playingVerse}
            selection={playback.mode === 'selection' ? playback.selection : null}
          />
        )}
      </div>
    </main>
  );
}