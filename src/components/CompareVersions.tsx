import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBible } from '../context/BibleContext';
import { useCompare } from '../context/CompareContext';
import type { CompareVerseEntry } from '../types/bible';
import type { CompareVerse } from '../context/CompareContext';
import { CloseIcon, ChevronDown } from './Icons';
import CompareTranslationPicker from './CompareTranslationPicker';
import './CompareVersions.css';

interface Props {
  verse: CompareVerse | null;
  entries: CompareVerseEntry[] | null;
  loading: boolean;
  onClose: () => void;
}

/**
 * Full-height, scrollable modal comparing one verse across translations.
 * Entries stream in top-to-bottom as each translation resolves (worker pool
 * in the main process), so the list fills progressively. A header control
 * lets the user pick which translations to show; the selection persists.
 * The current translation is highlighted.
 * Renders nothing until a verse is opened via useCompare().openCompare().
 */
export default function CompareVersions({ verse, entries, loading, onClose }: Props): React.ReactElement | null {
  const { catalog } = useBible();
  const { compareAbbrs, setCompareAbbrs } = useCompare();
  const [pickerOpen, setPickerOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on open so keyboard users land in the dialog.
  useEffect(() => {
    if (verse) closeRef.current?.focus();
  }, [verse]);

  // Close the picker when the dialog closes.
  useEffect(() => {
    if (!verse) setPickerOpen(false);
  }, [verse]);

  const selected = useMemo(() => {
    const set = new Set(compareAbbrs ?? catalog.map((t) => t.abbr));
    // Always keep the entry we have loaded data for in range.
    return set;
  }, [compareAbbrs, catalog]);

  const toggle = (abbr: string) => {
    const next = new Set(selected);
    if (next.has(abbr)) next.delete(abbr);
    else next.add(abbr);
    setCompareAbbrs(next.size === catalog.length ? null : [...next]);
  };

  const showAll = () => setCompareAbbrs(null);
  const clear = () => setCompareAbbrs([]);

  // Filter the streamed slots by the selected translations. Pending slots
  // remain for selected-but-not-yet-loaded translations (shimmer cards).
  // NOTE: computed before the early return so hook order is stable.
  const visibleSlots = useMemo(() => {
    if (!entries) return null;
    return entries
      .map((entry, i) => ({ entry, abbr: catalog[i]?.abbr ?? '' }))
      .filter(({ abbr }) => selected.has(abbr))
      .map(({ entry }) => entry);
  }, [entries, catalog, selected]);

  if (!verse) return null;

  const currentAbbr = verse.currentAbbr;
  const loadedCount = entries ? entries.filter((e) => e !== null).length : 0;
  const totalCount = entries ? entries.length : 0;

  const renderCard = (entry: CompareVerseEntry | null, index: number) => {
    if (!entry) {
      return (
        <div key={index} className="compare-sheet__entry compare-sheet__entry--pending" aria-hidden="true">
          <div className="compare-sheet__entry-head">
            <span className="compare-sheet__badge compare-sheet__badge--pending" />
            <span className="compare-sheet__pending-name" />
          </div>
          <div className="compare-sheet__pending-text" />
        </div>
      );
    }
    return (
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
    );
  };

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

          <div className="compare-sheet__header-actions">
            <div className="compare-picker-anchor">
              <button
                type="button"
                className={`compare-sheet__picker${pickerOpen ? ' compare-sheet__picker--open' : ''}`}
                onClick={() => setPickerOpen((o) => !o)}
                aria-expanded={pickerOpen}
                aria-haspopup="dialog"
                title="Choose translations to compare"
              >
                <span className="compare-sheet__picker-count">{selected.size}</span>
                <span className="compare-sheet__picker-label">
                  {selected.size === catalog.length ? 'versions' : 'selected'}
                </span>
                <ChevronDown size={14} className="compare-sheet__picker-chevron" />
              </button>
              {pickerOpen && (
                <CompareTranslationPicker
                  catalog={catalog}
                  selected={selected}
                  onToggle={toggle}
                  onShowAll={showAll}
                  onClear={clear}
                  onClose={() => setPickerOpen(false)}
                />
              )}
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
          </div>
        </header>

        <div className="compare-sheet__body">
          {!visibleSlots ? (
            <div className="compare-sheet__loading" aria-label="Loading translations">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="compare-sheet__skeleton" style={{ width: `${88 - (i % 4) * 9}%` }} />
              ))}
            </div>
          ) : visibleSlots.length === 0 ? (
            <div className="compare-sheet__empty" role="status">
              No translations selected. Open the picker above and choose some to compare.
            </div>
          ) : (
            visibleSlots.map((entry, i) => renderCard(entry, i))
          )}

          {loading && (
            <div className="compare-sheet__status">
              Loading translations&hellip; {loadedCount}/{totalCount}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}