import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TTSState } from '../types/tts';
import { SpeakerIcon, StopIcon } from './Icons';
import './SelectionTTS.css';

interface Props {
  /** The scrollable reading container; selections outside it are ignored. */
  containerRef: React.RefObject<HTMLElement | null>;
  ttsAvailable: boolean;
}

interface SelState {
  text: string;
  x: number;
  y: number;
}

/**
 * Floating TTS control for highlighted text. When the user selects verses in
 * the reading area, a small "play" pill appears under the selection; clicking
 * it speaks exactly the highlighted text (any range: one verse, several, or a
 * partial verse).
 */
export default function SelectionTTS({ containerRef, ttsAvailable }: Props): React.ReactElement {
  const [sel, setSel] = useState<SelState | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);

  // Track whether the pill itself is being interacted with, so interacting
  // with it doesn't immediately dismiss it.
  const interacting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = window.electronAPI.tts.onStateChange((state: TTSState) => {
      if (cancelled) return;
      setSpeaking(state.status === 'speaking');
      if (state.status === 'idle' || state.status === 'error') {
        setSel((s) => (s ? { ...s } : s)); // keep the pill visible for re-play
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const readSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container || !ttsAvailable) return;
    if (interacting.current) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setSel(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setSel(null);
      return;
    }

    // Ignore selections that start outside the reading container (toolbar,
    // search bar, dropdowns).
    const anchor = selection.anchorNode;
    if (!anchor || (anchor.nodeType === Node.TEXT_NODE ? !container.contains(anchor.parentNode) : !container.contains(anchor))) {
      setSel(null);
      return;
    }

    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSel(null);
      return;
    }

    // Position the pill just below the selection.
    const width = 150;
    const x = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
    const y = rect.bottom + 10;
    setSel({ text, x, y });
  }, [containerRef, ttsAvailable]);

  // Update pill position while the selection is being extended (drag). We
  // listen on the container for mouseup only; scrolling clears it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerEl = container;

    const onMouseUp = () => {
      requestAnimationFrame(readSelection);
    };
    const onScroll = () => setSel(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null);
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sel) setSel(null);
    };

    containerEl.addEventListener('mouseup', onMouseUp);
    containerEl.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      containerEl.removeEventListener('mouseup', onMouseUp);
      containerEl.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [containerRef, readSelection, sel]);

  // If TTS becomes unavailable, drop the pill.
  useEffect(() => {
    if (!ttsAvailable) setSel(null);
  }, [ttsAvailable]);

  if (!sel || !ttsAvailable) return <></>;

  const onPlay = () => {
    if (speaking) {
      void window.electronAPI.tts.stop();
    } else {
      void window.electronAPI.tts.speak(sel.text);
    }
  };

  return (
    <button
      ref={pillRef}
      type="button"
      className={`seltts${speaking ? ' seltts--speaking' : ''}`}
      style={{ left: sel.x, top: sel.y }}
      onMouseDown={(e) => {
        interacting.current = true;
        e.stopPropagation();
      }}
      onMouseUp={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onPlay();
      }}
      onMouseLeave={() => {
        // Re-arm after leaving so the next selection can dismiss normally.
        setTimeout(() => { interacting.current = false; }, 100);
      }}
      title={speaking ? 'Stop' : 'Play selection'}
    >
      {speaking ? <StopIcon size={15} /> : <SpeakerIcon size={15} />}
      <span>{speaking ? 'Stop' : 'Play selection'}</span>
    </button>
  );
}
