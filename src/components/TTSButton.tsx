import React, { useEffect, useState } from 'react';
import { useBible } from '../context/BibleContext';
import { usePlayback } from '../context/PlaybackContext';
import { SpeakerIcon, StopIcon } from './Icons';
import './TTSButton.css';

/**
 * Toolbar TTS button. Plays the current chapter verse-by-verse (with a live
 * per-verse highlight in the reading area). Clicking again stops playback.
 */
export default function TTSButton(): React.ReactElement {
  const { translationAbbr, bookIndex, chapterIndex } = useBible();
  const { speaking, playChapter, stop } = usePlayback();
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.tts.isAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onClick = () => {
    if (speaking) {
      void stop();
      return;
    }
    if (available === false) {
      return; // disabled; nothing to do
    }
    void (async () => {
      try {
        const chapter = await window.electronAPI.bible.getChapter(translationAbbr, bookIndex, chapterIndex);
        await playChapter(bookIndex, chapterIndex, chapter.verses);
      } catch (err) {
        // Playback errors surface as toasts from the PlaybackProvider.
        console.error('Chapter playback failed:', err);
      }
    })();
  };

  return (
    <button
      type="button"
      className={`icon-btn tts-btn${available === false ? ' tts-btn--disabled' : ''}${
        speaking ? ' icon-btn--active tts-btn--speaking' : ''
      }`}
      onClick={onClick}
      disabled={available === false}
      title={available === false ? 'Text-to-speech not configured' : speaking ? 'Stop' : 'Play chapter audio'}
      aria-label={speaking ? 'Stop chapter audio' : 'Play chapter audio'}
    >
      {speaking ? <StopIcon size={19} /> : <SpeakerIcon size={19} />}
    </button>
  );
}