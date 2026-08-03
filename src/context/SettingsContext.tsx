import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'sepia' | 'dark';

interface SettingsState {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
}

const SettingsContext = createContext<SettingsState | null>(null);

const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_DEFAULT = 18;
const LINE_HEIGHT_MIN = 1.4;
const LINE_HEIGHT_MAX = 2.2;
const LINE_HEIGHT_DEFAULT = 1.75;

export { FONT_SIZE_MIN, FONT_SIZE_MAX, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX };

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [fontSize, setFontSizeState] = useState(FONT_SIZE_DEFAULT);
  const [lineHeight, setLineHeightState] = useState(LINE_HEIGHT_DEFAULT);
  const [hydrated, setHydrated] = useState(false);

  // Restore settings
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.electronAPI.store.get<Theme>('theme'),
      window.electronAPI.store.get<number>('fontSize'),
      window.electronAPI.store.get<number>('lineHeight'),
    ]).then(([t, fs, lh]) => {
      if (cancelled) return;
      if (t === 'light' || t === 'sepia' || t === 'dark') setThemeState(t);
      if (typeof fs === 'number') setFontSizeState(fs);
      if (typeof lh === 'number') setLineHeightState(lh);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
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
    if (hydrated) void window.electronAPI.store.set('theme', theme);
  }, [theme, hydrated]);
  useEffect(() => {
    if (hydrated) void window.electronAPI.store.set('fontSize', fontSize);
  }, [fontSize, hydrated]);
  useEffect(() => {
    if (hydrated) void window.electronAPI.store.set('lineHeight', lineHeight);
  }, [lineHeight, hydrated]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const setFontSize = useCallback((s: number) => setFontSizeState(s), []);
  const setLineHeight = useCallback((h: number) => setLineHeightState(h), []);

  const value = useMemo<SettingsState>(
    () => ({ theme, fontSize, lineHeight, setTheme, setFontSize, setLineHeight }),
    [theme, fontSize, lineHeight, setTheme, setFontSize, setLineHeight],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
