import React, { useEffect, useRef, useState } from 'react';
import { useSettings, FONT_SIZE_MIN, FONT_SIZE_MAX, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX } from '../context/SettingsContext';
import type { Theme } from '../context/SettingsContext';
import { CheckIcon } from './Icons';
import './TextSettingsPopover.css';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' },
];

const VOICE_GROUPS = [
  {
    label: 'American Female',
    voices: [
      { id: 'af_heart', name: 'Heart' },
      { id: 'af_bella', name: 'Bella' },
      { id: 'af_nicole', name: 'Nicole' },
      { id: 'af_sarah', name: 'Sarah' },
      { id: 'af_sky', name: 'Sky' },
    ],
  },
  {
    label: 'American Male',
    voices: [
      { id: 'am_adam', name: 'Adam' },
      { id: 'am_michael', name: 'Michael' },
      { id: 'am_liam', name: 'Liam' },
      { id: 'am_echo', name: 'Echo' },
    ],
  },
  {
    label: 'British Female',
    voices: [
      { id: 'bf_emma', name: 'Emma' },
      { id: 'bf_isabella', name: 'Isabella' },
    ],
  },
  {
    label: 'British Male',
    voices: [
      { id: 'bm_george', name: 'George' },
      { id: 'bm_fable', name: 'Fable' },
      { id: 'bm_lewis', name: 'Lewis' },
    ],
  },
];

interface Props {
  onClose: () => void;
  ttsAvailable?: boolean;
}

export default function TextSettingsPopover({ onClose, ttsAvailable }: Props): React.ReactElement {
  const {
    theme,
    fontSize,
    lineHeight,
    ttsVoice,
    ttsSpeed,
    setTheme,
    setFontSize,
    setLineHeight,
    setTTSVoice,
    setTTSSpeed,
  } = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [ttsStats, setTtsStats] = useState<{ cached: number; lastSource: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void window.electronAPI.tts.getStats().then((s) => {
        if (!cancelled) setTtsStats(s);
      });
    };
    refresh();
    // Refresh periodically while the popover is open so the cache count
    // updates live as background warming runs.
    const iv = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, []);

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

      {ttsAvailable && (
        <>
          <div className="tts-popover__group">
            <label className="tts-popover__label" htmlFor="voice-select">
              Voice
            </label>
            <select
              id="voice-select"
              className="tts-popover__select"
              value={ttsVoice}
              onChange={(e) => setTTSVoice(e.target.value)}
            >
              {VOICE_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="tts-popover__group">
            <label className="tts-popover__label" htmlFor="speed-slider">
              Speed <span className="tts-popover__value">{ttsSpeed.toFixed(1)}×</span>
            </label>
            <input
              id="speed-slider"
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={ttsSpeed}
              onChange={(e) => setTTSSpeed(Number(e.target.value))}
              className="tts-popover__slider"
            />
          </div>

          <div className="tts-popover__group">
            <span className="tts-popover__label">Cache</span>
            {ttsStats ? (
              <div className="tts-popover__cache">
                <span className={`tts-popover__badge tts-popover__badge--${ttsStats.lastSource}`}>
                  {ttsStats.lastSource === 'local' ? '● Local' : ttsStats.lastSource === 'openrouter' ? '● OpenRouter' : '—'}
                </span>
                <span className="tts-popover__cached">{ttsStats.cached} verse{ttsStats.cached === 1 ? '' : 's'} cached locally</span>
              </div>
            ) : (
              <span className="tts-popover__cached">…</span>
            )}
          </div>
        </>
      )}

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