import React, { useRef } from 'react';
import { useBible } from '../context/BibleContext';
import { useChapter } from '../hooks/useChapter';
import ChapterView from './ChapterView';
import './ParallelView.css';

interface Props {
  ttsAvailable: boolean;
  onPlayVerse?: (verseIndex: number, verseText: string) => void;
  onStopVerse?: () => void;
  playingVerse?: number | null;
}

/**
 * Two translations of the same chapter side by side, with synced scrolling.
 */
export default function ParallelView({
  ttsAvailable,
  onPlayVerse,
  onStopVerse,
  playingVerse,
}: Props): React.ReactElement {
  const { translationAbbr, secondaryAbbr, bookIndex, chapterIndex } = useBible();
  const primary = useChapter(translationAbbr, bookIndex, chapterIndex);
  const secondaryAbbrEffective = secondaryAbbr ?? 'NKJV';
  const secondary = useChapter(secondaryAbbrEffective, bookIndex, chapterIndex);

  const primaryScrollRef = useRef<HTMLDivElement>(null);
  const secondaryScrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const sync = (source: 'primary' | 'secondary') => (e: React.UIEvent<HTMLDivElement>) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const target = source === 'primary' ? secondaryScrollRef.current : primaryScrollRef.current;
    if (target) target.scrollTop = e.currentTarget.scrollTop;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  const secondaryName = secondary.chapter?.translationName ?? '';

  return (
    <div className="parallel-view">
      <div className="parallel-column" ref={primaryScrollRef} onScroll={sync('primary')}>
        {primary.error && <div className="parallel-view__error">{primary.error}</div>}
        {!primary.error && primary.chapter && (
          <ChapterView
            chapter={primary.chapter}
            ttsAvailable={ttsAvailable}
            onPlayVerse={onPlayVerse}
            onStopVerse={onStopVerse}
            playingVerse={playingVerse}
          />
        )}
      </div>
      <div className="parallel-divider" aria-hidden="true" />
      <div className="parallel-column" ref={secondaryScrollRef} onScroll={sync('secondary')}>
        <div className="parallel-column__header">
          <span className="parallel-column__name">{secondaryName}</span>
          <ParallelVersionSelector currentAbbr={secondaryAbbrEffective} />
        </div>
        {secondary.error && <div className="parallel-view__error">{secondary.error}</div>}
        {!secondary.error && secondary.chapter && (
          <ChapterView
            chapter={secondary.chapter}
            ttsAvailable={ttsAvailable}
            onPlayVerse={onPlayVerse}
            onStopVerse={onStopVerse}
            playingVerse={playingVerse}
          />
        )}
        <div className="parallel-column__footer">{secondary.chapter?.copyright}</div>
      </div>
    </div>
  );
}

/** Small compact version selector for the secondary column. */
function ParallelVersionSelector({ currentAbbr }: { currentAbbr: string }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="parallel-selector">
      <button
        type="button"
        className="parallel-selector__button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {currentAbbr}
      </button>
      {open && <VersionSelectorPopover currentAbbr={currentAbbr} onClose={() => setOpen(false)} />}
    </div>
  );
}

function VersionSelectorPopover({
  currentAbbr,
  onClose,
}: {
  currentAbbr: string;
  onClose: () => void;
}): React.ReactElement {
  const { catalog, setSecondaryTranslation } = useBible();
  const rootRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="parallel-selector__popover" ref={rootRef}>
      {catalog.map((t) => (
        <button
          type="button"
          key={t.abbr}
          className={`parallel-selector__item${
            t.abbr === currentAbbr ? ' parallel-selector__item--active' : ''
          }`}
          onClick={() => {
            setSecondaryTranslation(t.abbr);
            onClose();
          }}
        >
          {t.abbr}
        </button>
      ))}
    </div>
  );
}
