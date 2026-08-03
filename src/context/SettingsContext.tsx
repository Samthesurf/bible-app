import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type Theme = 'light' | 'sepia' | 'dark';

interface SettingsState {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  ttsVoice: string;
  ttsSpeed: number;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setTTSVoice: (voice: string) => void;
  setTTSSpeed: (speed: number) => void;
}

const SettingsContext = createContext<SettingsState | null>(null);

const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_DEFAULT = 18;
const LINE_HEIGHT_MIN = 1.4;
const LINE_HEIGHT_MAX = 2.2;
const LINE_HEIGHT_DEFAULT = 1.7;
const TTS_VOICE_DEFAULT = 'af_heart';
const TTS_SPEED_DEFAULT = 1.0;

export { FONT_SIZE_MIN, FONT_SIZE_MAX, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX };

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [fontSize, setFontSizeState] = useState(FONT_SIZE_DEFAULT);
  const [lineHeight, setLineHeightState] = useState(LINE_HEIGHT_DEFAULT);
  const [ttsVoice, setTTSVoiceState] = useState(TTS_VOICE_DEFAULT);
  const [ttsSpeed, setTTSSpeedState] = useState(TTS_SPEED_DEFAULT);
  const hydrated = useRef(false);

  // Restore settings
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.electronAPI.store.get<Theme>('theme'),
      window.electronAPI.store.get<number>('fontSize'),
      window.electronAPI.store.get<number>('lineHeight'),
      window.electronAPI.store.get<string>('ttsVoice'),
      window.electronAPI.store.get<number>('ttsSpeed'),
    ]).then(([t, fs, lh, voice, speed]) => {
      if (cancelled) return;
      if (t === 'light' || t === 'sepia' || t === 'dark') setThemeState(t);
      if (typeof fs === 'number') setFontSizeState(fs);
      if (typeof lh === 'number') setLineHeightState(lh);
      if (voice) setTTSVoiceState(voice);
      if (typeof speed === 'number') setTTSSpeedState(speed);
      hydrated.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  // Apply CSS variables + theme attribute
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.setProperty('--font-size-body', `${fontSize}px`);
    root.style.setProperty('--line-height-body', String(lineHeight));
  }, [theme, fontSize, lineHeight]);

  // Persist
  useEffect(() => {
    if (hydrated.current) void window.electronAPI.store.set('theme', theme);
  }, [theme]);
  useEffect(() => {
    if (hydrated.current) void window.electronAPI.store.set('fontSize', fontSize);
  }, [fontSize]);
  useEffect(() => {
    if (hydrated.current) void window.electronAPI.store.set('lineHeight', lineHeight);
  }, [lineHeight]);
  useEffect(() => {
    if (hydrated.current) void window.electronAPI.store.set('ttsVoice', ttsVoice);
  }, [ttsVoice]);
  useEffect(() => {
    if (hydrated.current) void window.electronAPI.store.set('ttsSpeed', ttsSpeed);
  }, [ttsSpeed]);

  // Sync voice/speed to the main process engine
  useEffect(() => {
    if (hydrated.current) {
      void window.electronAPI.tts.updateConfig(ttsVoice, ttsSpeed);
    }
  }, [ttsVoice, ttsSpeed]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const setFontSize = useCallback((s: number) => setFontSizeState(s), []);
  const setLineHeight = useCallback((h: number) => setLineHeightState(h), []);
  const setTTSVoice = useCallback((v: string) => setTTSVoiceState(v), []);
  const setTTSSpeed = useCallback((s: number) => setTTSSpeedState(s), []);

  const value = useMemo<SettingsState>(
    () => ({ theme, fontSize, lineHeight, ttsVoice, ttsSpeed, setTheme, setFontSize, setLineHeight, setTTSVoice, setTTSSpeed }),
    [theme, fontSize, lineHeight, ttsVoice, ttsSpeed, setTheme, setFontSize, setLineHeight, setTTSVoice, setTTSSpeed],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}