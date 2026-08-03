import React, { useEffect, useRef } from 'react';
import { useSettings, FONT_SIZE_MIN, FONT_SIZE_MAX, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX } from '../context/SettingsContext';
import type { Theme } from '../context/SettingsContext';
import { CheckIcon } from './Icons';
import './TextSettingsPopover.css';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' },
];

export default function TextSettingsPopover({ onClose }: { onClose: () => void }): React.ReactElement {
  const { theme, fontSize, lineHeight, setTheme, setFontSize, setLineHeight } = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="tts-popover" ref={rootRef} role="dialog" aria-label="Text settings">
      <div className="tts-popover__group">
        <label className="tts-popover__label" htmlFor="font-size-slider">
          Font size <span className="tts-popover__value">{fontSize}px</span>
        </label>
        <input
          id="font-size-slider"
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          className="tts-popover__slider"
        />
      </div>

      <div className="tts-popover__group">
        <label className="tts-popover__label" htmlFor="line-height-slider">
          Line spacing <span className="tts-popover__value">{lineHeight.toFixed(2)}</span>
        </label>
        <input
          id="line-height-slider"
          type="range"
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={0.05}
          value={lineHeight}
          onChange={(e) => setLineHeight(Number(e.target.value))}
          className="tts-popover__slider"
        />
      </div>

      <div className="tts-popover__group">
        <span className="tts-popover__label">Theme</span>
        <div className="tts-popover__themes">
          {THEMES.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`tts-popover__theme tts-popover__theme--${t.id}${
                theme === t.id ? ' tts-popover__theme--active' : ''
              }`}
              onClick={() => setTheme(t.id)}
              title={t.label}
              aria-label={`${t.label} theme`}
              aria-pressed={theme === t.id}
            >
              {theme === t.id && <CheckIcon size={14} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
