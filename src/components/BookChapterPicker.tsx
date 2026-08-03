import React, { useEffect, useRef, useState } from 'react';
import { useBible } from '../context/BibleContext';
import './BookChapterPicker.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Two-panel dropdown: books on the left, chapter grid on the right. */
export default function BookChapterPicker({ isOpen, onClose }: Props): React.ReactElement {
  const { bookList, bookIndex, chapterIndex, navigate } = useBible();
  const [selectedBook, setSelectedBook] = useState(bookIndex);
  const rootRef = useRef<HTMLDivElement>(null);

  // Follow external navigation while open
  useEffect(() => {
    setSelectedBook(bookIndex);
  }, [bookIndex]);

  // Outside click close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!bookList) return <div className="bookpicker" ref={rootRef} />;

  const activeBook = bookList[selectedBook] ?? bookList[0];

  return (
    <div className="bookpicker" ref={rootRef} role="dialog" aria-label="Choose book and chapter">
      <div className="bookpicker__books">
        {bookList.map((b, i) => (
          <button
            type="button"
            key={b.name}
            className={`bookpicker__book${i === selectedBook ? ' bookpicker__book--active' : ''}`}
            onClick={() => setSelectedBook(i)}
          >
            {b.name}
          </button>
        ))}
      </div>
      <div className="bookpicker__chapters">
        <div className="bookpicker__chapters-title">{activeBook.name}</div>
        <div className="bookpicker__chapters-grid">
          {Array.from({ length: activeBook.chapterCount }, (_, i) => i).map((c) => (
            <button
              type="button"
              key={c}
              className={`bookpicker__chapter${
                selectedBook === bookIndex && c === chapterIndex
                  ? ' bookpicker__chapter--current'
                  : ''
              }`}
              onClick={() => {
                navigate(selectedBook, c);
                onClose();
              }}
            >
              {c + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
