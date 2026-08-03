import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayback, type SelectionRange } from '../context/PlaybackContext';
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
  range: SelectionRange | null;
}

/**
 * Floating TTS control for highlighted text. When the user selects verses in
 * the reading area, a small "play" pill appears under the selection; clicking
 * it speaks exactly the highlighted text (any range: one verse, several, or a
 * partial verse). The affected verses are highlighted while it plays.
 */
export default function SelectionTTS({ containerRef, ttsAvailable }: Props): React.ReactElement {
  const { speaking, playSelection } = usePlayback();
  const [sel, setSel] = useState<SelState | null>(null);
  const interacting = useRef(false);

  /** Map the current selection to a verse index range + which column it's in. */
  const computeRange = useCallback((): SelectionRange | null => {
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || !selection.rangeCount) return null;
    const selRange = selection.getRangeAt(0);
    const verses = Array.from(container.querySelectorAll<HTMLElement>('.verse'));
    const indices: number[] = [];
    for (const v of verses) {
      if (selRange.intersectsNode(v)) {
        const di = v.dataset.verseIndex;
        if (di != null) indices.push(parseInt(di, 10));
      }
    }
    if (indices.length === 0) return null;

    const columns = Array.from(container.querySelectorAll('.parallel-column'));
    const anchor = selection.anchorNode;
    const colEl = anchor instanceof Node ? anchor.parentElement?.closest('.parallel-column') : null;
    const colIndex = colEl ? columns.indexOf(colEl) : -1;
    const column: SelectionRange['column'] = colIndex === 0 ? 'primary' : colIndex > 0 ? 'secondary' : null;

    return {
      column,
      start: Math.min(...indices),
      end: Math.max(...indices),
    };
  }, [containerRef]);

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

    const width = 150;
    const x = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
    const y = rect.bottom + 10;
    setSel({ text, x, y, range: computeRange() });
  }, [containerRef, ttsAvailable, computeRange]);

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

  useEffect(() => {
    if (!ttsAvailable) setSel(null);
  }, [ttsAvailable]);

  if (!sel || !ttsAvailable) return <></>;

  const onPlay = () => {
    if (speaking) {
      void window.electronAPI.tts.stop();
    } else {
      void playSelection(sel.text, sel.range);
    }
  };

  return (
    <button
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
        setTimeout(() => {
          interacting.current = false;
        }, 100);
      }}
      title={speaking ? 'Stop' : 'Play selection'}
    >
      {speaking ? <StopIcon size={15} /> : <SpeakerIcon size={15} />}
      <span>{speaking ? 'Stop' : 'Play selection'}</span>
    </button>
  );
}