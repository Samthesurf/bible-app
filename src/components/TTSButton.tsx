import React, { useEffect, useState } from 'react';
import type { TTSState } from '../types/tts';
import { SpeakerIcon } from './Icons';
import './TTSButton.css';

/**
 * Toolbar TTS button. The engine is stubbed (see electron/tts-stub.ts);
 * when unavailable the button shows a subtle disabled state and clicking it
 * explains why. Once a real engine is wired, per-verse playback appears.
 */
export default function TTSButton(): React.ReactElement {
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
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onClick = () => {
    if (available === false) {
      setToast('Text-to-speech is not configured yet. Coming soon.');
      return;
    }
    if (speaking) {
      void window.electronAPI.tts.stop();
    } else {
      setToast('TTS engine not configured yet.');
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
        aria-label="Text-to-speech"
      >
        <SpeakerIcon size={19} />
      </button>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
