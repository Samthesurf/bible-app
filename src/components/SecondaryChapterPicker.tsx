import React, { useEffect, useRef, useState } from 'react';
import { useBible } from '../context/BibleContext';
import { ChevronDown, ChevronLeft, ChevronRight } from './Icons';
import './SecondaryChapterPicker.css';

/** Compact inline book+chapter picker for the secondary column in Mode 2. */
export default function SecondaryChapterPicker(): React.ReactElement {
  const {
    bookList,
    secondaryBookIndex,
    secondaryChapterIndex,
    setSecondaryPosition,
  } = useBible();
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const book = bookList?.[secondaryBookIndex];
  const label = book ? `${book.name} ${secondaryChapterIndex + 1}` : '…';

  const prev = () => {
    if (!bookList) return;
    if (secondaryChapterIndex > 0) {
      setSecondaryPosition(secondaryBookIndex, secondaryChapterIndex - 1);
    } else if (secondaryBookIndex - 1 >= 0) {
      const prevBook = bookList[secondaryBookIndex - 1];
      setSecondaryPosition(secondaryBookIndex - 1, (prevBook?.chapterCount ?? 1) - 1);
    }
  };

  const next = () => {
    if (!bookList) return;
    const curBook = bookList[secondaryBookIndex];
    if (curBook && secondaryChapterIndex + 1 < curBook.chapterCount) {
      setSecondaryPosition(secondaryBookIndex, secondaryChapterIndex + 1);
    } else if (secondaryBookIndex + 1 < bookList.length) {
      setSecondaryPosition(secondaryBookIndex + 1, 0);
    }
  };

  // Outside click close
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  return (
    <div className="sec-picker" ref={rootRef}>
      <button
        type="button"
        className="sec-picker__arrow"
        onClick={prev}
        aria-label="Previous chapter"
      >
        <ChevronLeft size={14} />
      </button>
      <button
        type="button"
        className="sec-picker__label"
        onClick={() => setPickerOpen((o) => !o)}
        aria-expanded={pickerOpen}
      >
        {label}
        <ChevronDown size={12} />
      </button>
      <button
        type="button"
        className="sec-picker__arrow"
        onClick={next}
        aria-label="Next chapter"
      >
        <ChevronRight size={14} />
      </button>

      {pickerOpen && bookList && (
        <SecondaryBookChapterDropdown
          bookList={bookList}
          bookIndex={secondaryBookIndex}
          chapterIndex={secondaryChapterIndex}
          onSelect={(b, c) => {
            setSecondaryPosition(b, c);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mini book + chapter dropdown (inlined to avoid circular imports)   */
/* ------------------------------------------------------------------ */
interface DropdownProps {
  bookList: { name: string; chapterCount: number }[];
  bookIndex: number;
  chapterIndex: number;
  onSelect: (bookIndex: number, chapterIndex: number) => void;
  onClose: () => void;
}

function SecondaryBookChapterDropdown({ bookList, bookIndex, chapterIndex, onSelect, onClose }: DropdownProps) {
  const [selectedBook, setSelectedBook] = useState(bookIndex);
  const ddRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const activeBook = bookList[selectedBook] ?? bookList[0];

  return (
    <div className="sec-picker__dropdown" ref={ddRef} role="dialog" aria-label="Choose secondary chapter">
      <div className="sec-picker__books">
        {bookList.map((b, i) => (
          <button
            key={b.name}
            type="button"
            className={`sec-picker__book${i === selectedBook ? ' sec-picker__book--active' : ''}`}
            onClick={() => setSelectedBook(i)}
          >
            {b.name}
          </button>
        ))}
      </div>
      <div className="sec-picker__chapters">
        {Array.from({ length: activeBook.chapterCount }, (_, i) => i).map((c) => (
          <button
            key={c}
            type="button"
            className={`sec-picker__chapter${
              selectedBook === bookIndex && c === chapterIndex ? ' sec-picker__chapter--current' : ''
            }`}
            onClick={() => onSelect(selectedBook, c)}
          >
            {c + 1}
          </button>
        ))}
      </div>
    </div>
  );
}