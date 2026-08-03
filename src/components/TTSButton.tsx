import React, { useCallback, useEffect, useState } from 'react';
import type { TTSState } from '../types/tts';
import { useBible } from '../context/BibleContext';
import { SpeakerIcon, StopIcon } from './Icons';
import './TTSButton.css';

/**
 * Toolbar TTS button. Plays the current chapter through the configured
 * engine (Kokoro via OpenRouter). Clicking again stops playback.
 */
export default function TTSButton(): React.ReactElement {
  const { translationAbbr, bookIndex, chapterIndex } = useBible();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.tts.isAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    const unsubscribe = window.electronAPI.tts.onStateChange((state: TTSState) => {
      if (cancelled) return;
      setSpeaking(state.status === 'speaking');
      if (state.status === 'error' && 'message' in state) {
        setToast(state.message);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const playChapter = useCallback(async () => {
    if (available === false) {
      setToast('Text-to-speech is not configured. Add an OpenRouter API key to enable it.');
      return;
    }
    try {
      const chapter = await window.electronAPI.bible.getChapter(translationAbbr, bookIndex, chapterIndex);
      const verses = chapter.verses.map((v, i) => `${i + 1}. ${v}`);
      setToast(`Playing ${chapter.bookName} ${chapter.chapterNumber}…`);
      // Chunk into ~2800-char groups (Kokoro caps requests around 4096 chars)
      // and speak them sequentially so long chapters play end to end.
      let chunk: string[] = [];
      let chunkLen = 0;
      for (const verse of verses) {
        if (chunkLen + verse.length > 2800 && chunk.length > 0) {
          await window.electronAPI.tts.speak(chunk.join(' '));
          chunk = [];
          chunkLen = 0;
        }
        chunk.push(verse);
        chunkLen += verse.length;
      }
      if (chunk.length > 0) await window.electronAPI.tts.speak(chunk.join(' '));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToast(`TTS error: ${message}`);
    }
  }, [available, translationAbbr, bookIndex, chapterIndex]);

  const onClick = () => {
    if (speaking) {
      void window.electronAPI.tts.stop();
      setToast('Stopped.');
    } else {
      void playChapter();
    }
  };

  return (
    <>
      <button
        type="button"
        className={`icon-btn tts-btn${available === false ? ' tts-btn--disabled' : ''}${
          speaking ? ' icon-btn--active tts-btn--speaking' : ''
        }`}
        onClick={onClick}
        title={available === false ? 'Text-to-speech not configured' : 'Play chapter audio'}
        aria-label="Play chapter audio"
      >
        {speaking ? <StopIcon size={19} /> : <SpeakerIcon size={19} />}
      </button>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}