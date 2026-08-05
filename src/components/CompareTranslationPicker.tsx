import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TranslationMeta } from '../types/bible';
import { CheckIcon } from './Icons';

interface Props {
  catalog: TranslationMeta[];
  selected: Set<string>;
  onToggle: (abbr: string) => void;
  onShowAll: () => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * Filterable multi-select for choosing which translations appear in the
 * compare popup. Same search pattern as VersionPicker, but toggles instead
 * of radio selection, plus Show-all / Clear actions.
 */
export default function CompareTranslationPicker({
  catalog,
  selected,
  onToggle,
  onShowAll,
  onClear,
  onClose,
}: Props): React.ReactElement {
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (t) => t.abbr.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
    );
  }, [catalog, filter]);

  return (
    <div className="compare-picker" ref={rootRef} role="dialog" aria-label="Choose translations to compare">
      <input
        ref={inputRef}
        type="text"
        className="compare-picker__filter"
        placeholder="Search translations..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="compare-picker__list">
        {filtered.length === 0 && (
          <div className="compare-picker__empty">No translations found.</div>
        )}
        {filtered.map((t) => (
          <button
            type="button"
            key={t.abbr}
            className={`compare-picker__item${
              selected.has(t.abbr) ? ' compare-picker__item--selected' : ''
            }`}
            onClick={() => onToggle(t.abbr)}
            aria-pressed={selected.has(t.abbr)}
          >
            <span className="compare-picker__abbr">{t.abbr}</span>
            <span className="compare-picker__name">{t.name}</span>
            {selected.has(t.abbr) && <CheckIcon size={16} className="compare-picker__check" />}
          </button>
        ))}
      </div>
      <div className="compare-picker__footer">
        <span className="compare-picker__count">
          {selected.size} of {catalog.length} selected
        </span>
        <div className="compare-picker__actions">
          <button type="button" className="compare-picker__action" onClick={onShowAll}>
            Show all
          </button>
          <button type="button" className="compare-picker__action" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}