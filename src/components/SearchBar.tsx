import React, { useEffect, useRef, useState } from 'react';
import { useBible } from '../context/BibleContext';
import type { SearchResult } from '../types/bible';
import { SearchIcon } from './Icons';
import { cleanVerseText } from '../utils/verseText';
import './SearchBar.css';

export default function SearchBar(): React.ReactElement {
  const { translationAbbr, navigate } = useBible();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setOpen(false);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(() => {
      void window.electronAPI.bible.search(translationAbbr, q, 50).then((r) => {
        setResults(r);
        setSearching(false);
        setOpen(true);
        setActiveIndex(-1);
      });
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, translationAbbr]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const jumpTo = (r: SearchResult) => {
    navigate(r.bookIndex, r.chapterIndex);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (target) jumpTo(target);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="searchbar" ref={rootRef}>
      <SearchIcon size={16} className="searchbar__icon" />
      <input
        type="search"
        className="searchbar__input"
        placeholder="Search verses, topics, and questions..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        aria-label="Search the Bible"
      />
      {open && (
        <div className="searchbar__dropdown" role="listbox">
          {searching ? (
            <div className="searchbar__status">Searching…</div>
          ) : results.length === 0 ? (
            <div className="searchbar__status">No results found.</div>
          ) : (
            results.map((r, i) => (
              <button
                type="button"
                key={`${r.reference}-${i}`}
                className={`searchbar__result${i === activeIndex ? ' searchbar__result--active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => jumpTo(r)}
                role="option"
                aria-selected={i === activeIndex}
              >
                <span className="searchbar__ref">{r.reference}</span>
                <span className="searchbar__text">{cleanVerseText(r.text)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
