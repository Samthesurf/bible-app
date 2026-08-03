import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBible } from '../context/BibleContext';
import { CheckIcon } from './Icons';
import './VersionPicker.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Filterable dropdown listing all available translations. */
export default function VersionPicker({ isOpen, onClose }: Props): React.ReactElement {
  const { catalog, translationAbbr, setTranslation } = useBible();
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setFilter('');
      // Focus the filter input on open (after mount animation frame)
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (t) => t.abbr.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
    );
  }, [catalog, filter]);

  const select = (abbr: string) => {
    setTranslation(abbr);
    onClose();
  };

  return (
    <div className="versionpicker" ref={rootRef} role="dialog" aria-label="Choose translation">
      <input
        ref={inputRef}
        type="text"
        className="versionpicker__filter"
        placeholder="Search translations..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className="versionpicker__list">
        {filtered.length === 0 && <div className="versionpicker__empty">No translations found.</div>}
        {filtered.map((t) => (
          <button
            type="button"
            key={t.abbr}
            className={`versionpicker__item${
              t.abbr === translationAbbr ? ' versionpicker__item--active' : ''
            }`}
            onClick={() => select(t.abbr)}
          >
            <span className="versionpicker__abbr">{t.abbr}</span>
            <span className="versionpicker__name">{t.name}</span>
            {t.abbr === translationAbbr && (
              <CheckIcon size={16} className="versionpicker__check" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
