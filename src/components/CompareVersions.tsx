import React, { useEffect, useRef } from 'react';
import type { CompareVerseEntry } from '../types/bible';
import type { CompareVerse } from '../context/CompareContext';
import { CloseIcon } from './Icons';
import './CompareVersions.css';

interface Props {
  verse: CompareVerse | null;
  entries: CompareVerseEntry[] | null;
  loading: boolean;
  onClose: () => void;
}

/**
 * Full-height, scrollable modal comparing one verse across every available
 * translation. The current translation is highlighted. Renders nothing until
 * a verse is opened via useCompare().openCompare().
 */
export default function CompareVersions({ verse, entries, loading, onClose }: Props): React.ReactElement | null {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on open so keyboard users land in the dialog.
  useEffect(() => {
    if (verse) closeRef.current?.focus();
  }, [verse]);

  if (!verse) return null;

  const loaded = entries !== null;
  const currentAbbr = verse.currentAbbr;

  return (
    <div className="compare-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="compare-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Compare ${verse.reference} across translations`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="compare-sheet__header">
          <div className="compare-sheet__title">
            <span className="compare-sheet__reference">{verse.reference}</span>
            <span className="compare-sheet__subtitle">in every translation</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="compare-sheet__close icon-btn"
            onClick={onClose}
            aria-label="Close comparison"
            title="Close (Esc)"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="compare-sheet__body">
          {!loaded && (
            <>
              {/* Instant row for the current translation. */}
              <article className="compare-sheet__entry compare-sheet__entry--current">
                <div className="compare-sheet__entry-head">
                  <span className="compare-sheet__badge compare-sheet__badge--current">{currentAbbr}</span>
                  <span className="compare-sheet__entry-name">Your translation</span>
                </div>
                <p className="compare-sheet__entry-text">{verse.currentText}</p>
              </article>

              <div className="compare-sheet__loading" aria-label="Loading translations">
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="compare-sheet__skeleton" style={{ width: `${88 - (i % 4) * 9}%` }} />
                ))}
              </div>
            </>
          )}

          {loaded &&
            entries.map((entry) => (
              <article
                key={entry.abbr}
                className={`compare-sheet__entry${
                  entry.abbr === currentAbbr ? ' compare-sheet__entry--current' : ''
                }`}
              >
                <div className="compare-sheet__entry-head">
                  <span
                    className={`compare-sheet__badge${
                      entry.abbr === currentAbbr ? ' compare-sheet__badge--current' : ''
                    }`}
                  >
                    {entry.abbr}
                  </span>
                  <span className="compare-sheet__entry-name">{entry.name || entry.abbr}</span>
                  {entry.abbr === currentAbbr && (
                    <span className="compare-sheet__you">You&apos;re reading</span>
                  )}
                </div>
                {entry.text ? (
                  <p className="compare-sheet__entry-text">{entry.text}</p>
                ) : (
                  <p className="compare-sheet__entry-text compare-sheet__entry-text--missing">
                    Not available in this translation.
                  </p>
                )}
                {entry.copyright && <footer className="compare-sheet__entry-copyright">{entry.copyright}</footer>}
              </article>
            ))}

          {loading && <div className="compare-sheet__status">Loading {entries ? '' : 'remaining '}translations&hellip;</div>}
        </div>
      </div>
    </div>
  );
}