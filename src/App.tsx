import React from 'react';
import { BibleProvider } from './context/BibleContext';
import { SettingsProvider } from './context/SettingsContext';
import { PlaybackProvider } from './context/PlaybackContext';
import Header from './components/Header';
import ReadingToolbar from './components/ReadingToolbar';
import ReadingArea from './components/ReadingArea';
import Footer from './components/Footer';

export default function App(): React.ReactElement {
  return (
    <SettingsProvider>
      <BibleProvider>
        <PlaybackProvider>
          <div className="app-shell">
            <Header />
            <ReadingToolbar />
            <ReadingArea />
            <Footer />
          </div>
        </PlaybackProvider>
      </BibleProvider>
    </SettingsProvider>
  );
}
