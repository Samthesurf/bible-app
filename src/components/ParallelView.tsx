import React, { useRef } from 'react';
import { useBible } from '../context/BibleContext';
import { useChapter } from '../hooks/useChapter';
import type { SelectionRange } from '../context/PlaybackContext';
import ChapterView from './ChapterView';
import SecondaryChapterPicker from './SecondaryChapterPicker';
import './ParallelView.css';

interface Props {
  ttsAvailable: boolean;
  onPlayVerse?: (verseIndex: number, verseText: string) => void;
  onStopVerse?: () => void;
  playingVerse?: number | null;
  selection?: SelectionRange | null;
}

/**
 * Two-column reading surface, aware of the parallel mode:
 *  - 'translations': same book+chapter, two translations (secondary has a
 *    version selector)
 *  - 'chapters':     same translation, two different chapters (secondary has
 *    its own chapter picker)
 * Scrolling is synchronized between columns.
 */
export default function ParallelView({
  ttsAvailable,
  onPlayVerse,
  onStopVerse,
  playingVerse,
  selection,
}: Props): React.ReactElement {
  const {
    translationAbbr,
    secondaryAbbr,
    bookIndex,
    chapterIndex,
    parallelMode,
    secondaryBookIndex,
    secondaryChapterIndex,
  } = useBible();

  const primary = useChapter(translationAbbr, bookIndex, chapterIndex);

  const secondaryAbbrEffective = parallelMode === 'translations' ? (secondaryAbbr ?? 'NKJV') : translationAbbr;
  const secondaryBook = parallelMode === 'translations' ? bookIndex : secondaryBookIndex;
  const secondaryChapter = parallelMode === 'translations' ? chapterIndex : secondaryChapterIndex;
  const secondary = useChapter(secondaryAbbrEffective, secondaryBook, secondaryChapter);

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

  const primaryLabel =
    parallelMode === 'translations'
      ? primary.chapter?.translationName ?? translationAbbr
      : primary.chapter
        ? `${primary.chapter.bookName} ${primary.chapter.chapterNumber}`
        : '…';
  const secondaryLabel =
    parallelMode === 'translations'
      ? secondary.chapter?.translationName ?? secondaryAbbrEffective
      : secondary.chapter
        ? `${secondary.chapter.bookName} ${secondary.chapter.chapterNumber}`
        : '…';

  return (
    <div className="parallel-view">
      {/* PRIMARY COLUMN */}
      <div className="parallel-column" ref={primaryScrollRef} onScroll={sync('primary')}>
        <div className="parallel-column__header">
          <span className="parallel-column__label">{primaryLabel}</span>
          <span className="parallel-column__badge">Primary</span>
        </div>
        {primary.error && <div className="parallel-view__error">{primary.error}</div>}
        {!primary.error && primary.chapter && (
          <ChapterView
            chapter={primary.chapter}
            ttsAvailable={ttsAvailable}
            onPlayVerse={onPlayVerse}
            onStopVerse={onStopVerse}
            playingVerse={playingVerse}
            selectionHighlight={selection && selection.column !== 'secondary' ? { start: selection.start, end: selection.end } : null}
          />
        )}
      </div>

      <div className="parallel-column" ref={secondaryScrollRef} onScroll={sync('secondary')}>
        <div className="parallel-column__header">
          <span className="parallel-column__label">{secondaryLabel}</span>
          {parallelMode === 'translations' ? (
            <ParallelVersionSelector currentAbbr={secondaryAbbrEffective} />
          ) : (
            <SecondaryChapterPicker />
          )}
        </div>
        {secondary.error && <div className="parallel-view__error">{secondary.error}</div>}
        {!secondary.error && secondary.chapter && (
          <ChapterView
            chapter={secondary.chapter}
            ttsAvailable={ttsAvailable}
            onPlayVerse={onPlayVerse}
            onStopVerse={onStopVerse}
            selectionHighlight={selection && selection.column === 'secondary' ? { start: selection.start, end: selection.end } : null}
          />
        )}
        <div className="parallel-column__footer">{secondary.chapter?.copyright}</div>
      </div>
    </div>
  );
}

/** Compact version selector for the secondary column (Mode 1). */
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
          {t.abbr} <span className="parallel-selector__item-name">{t.name}</span>
        </button>
      ))}
    </div>
  );
}