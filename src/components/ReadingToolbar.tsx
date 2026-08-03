import React, { useEffect, useState } from 'react';
import { useBible } from '../context/BibleContext';
import BookChapterPicker from './BookChapterPicker';
import VersionPicker from './VersionPicker';
import TTSButton from './TTSButton';
import TextSettingsPopover from './TextSettingsPopover';
import ParallelModeSelector from './ParallelModeSelector';
import type { ViewMode } from './ParallelModeSelector';
import { ChevronDown } from './Icons';
import './ReadingToolbar.css';

export default function ReadingToolbar(): React.ReactElement {
  const {
    catalog,
    bookList,
    translationAbbr,
    bookIndex,
    chapterIndex,
    parallelEnabled,
    parallelMode,
    toggleParallel,
    setParallelMode,
  } = useBible();

  const [bookPickerOpen, setBookPickerOpen] = useState(false);
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.tts.isAvailable().then((ok) => {
      if (!cancelled) setTtsAvailable(ok);
    });
    return () => { cancelled = true; };
  }, []);

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

  const translation = catalog.find((t) => t.abbr === translationAbbr);
  const book = bookList?.[bookIndex];

  const onModeChange = (mode: ViewMode) => {
    if (mode === 'single') {
      if (parallelEnabled) toggleParallel();
    } else {
      if (!parallelEnabled) toggleParallel();
      setParallelMode(mode === 'translations' ? 'translations' : 'chapters');
    }
  };
  const currentMode: ViewMode = !parallelEnabled ? 'single' : parallelMode;

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

        <ParallelModeSelector mode={currentMode} onChange={onModeChange} />
      </div>

      <div className="toolbar__right">
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
          {settingsOpen && (
            <TextSettingsPopover onClose={() => setSettingsOpen(false)} ttsAvailable={ttsAvailable} />
          )}
        </div>
      </div>
    </div>
  );
}