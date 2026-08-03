import React, { useEffect, useState } from 'react';
import { useBible } from '../context/BibleContext';
import BookChapterPicker from './BookChapterPicker';
import VersionPicker from './VersionPicker';
import TTSButton from './TTSButton';
import TextSettingsPopover from './TextSettingsPopover';
import { ChevronDown, ColumnsIcon } from './Icons';
import './ReadingToolbar.css';

export default function ReadingToolbar(): React.ReactElement {
  const {
    catalog,
    bookList,
    translationAbbr,
    bookIndex,
    chapterIndex,
    parallelEnabled,
    toggleParallel,
  } = useBible();

  const [bookPickerOpen, setBookPickerOpen] = useState(false);
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const translation = catalog.find((t) => t.abbr === translationAbbr);
  const book = bookList?.[bookIndex];

  // Close dropdowns on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBookPickerOpen(false);
        setVersionPickerOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="toolbar">
      <div className="toolbar__left">
        <div className="toolbar__anchor">
          <button
            type="button"
            className="toolbar__select"
            onClick={() => setBookPickerOpen((o) => !o)}
            aria-expanded={bookPickerOpen}
            aria-haspopup="dialog"
          >
            <span className="toolbar__select-label">
              {book ? book.name : '…'} {book ? chapterIndex + 1 : ''}
            </span>
            <ChevronDown size={16} className="toolbar__chevron" />
          </button>
          {bookPickerOpen && (
            <BookChapterPicker isOpen={bookPickerOpen} onClose={() => setBookPickerOpen(false)} />
          )}
        </div>

        <div className="toolbar__anchor">
          <button
            type="button"
            className="toolbar__select"
            onClick={() => setVersionPickerOpen((o) => !o)}
            aria-expanded={versionPickerOpen}
            aria-haspopup="dialog"
          >
            <span className="toolbar__select-label">{translation?.abbr ?? translationAbbr}</span>
            <ChevronDown size={16} className="toolbar__chevron" />
          </button>
          {versionPickerOpen && (
            <VersionPicker isOpen={versionPickerOpen} onClose={() => setVersionPickerOpen(false)} />
          )}
        </div>
      </div>

      <div className="toolbar__right">
        <button
          type="button"
          className={`icon-btn${parallelEnabled ? ' icon-btn--active' : ''}`}
          onClick={toggleParallel}
          title="Parallel view"
          aria-label="Toggle parallel view"
          aria-pressed={parallelEnabled}
        >
          <ColumnsIcon size={19} />
        </button>
        <TTSButton />
        <div className="toolbar__anchor">
          <button
            type="button"
            className={`icon-btn${settingsOpen ? ' icon-btn--active' : ''}`}
            onClick={() => setSettingsOpen((o) => !o)}
            title="Text settings"
            aria-label="Text settings"
            aria-expanded={settingsOpen}
          >
            <span className="toolbar__aa">A</span>
            <span className="toolbar__aa" style={{ fontSize: 12 }}>
              A
            </span>
          </button>
          {settingsOpen && <TextSettingsPopover onClose={() => setSettingsOpen(false)} />}
        </div>
      </div>
    </div>
  );
}
