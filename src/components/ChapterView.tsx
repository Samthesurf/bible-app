import React from 'react';
import type { ChapterData } from '../types/bible';
import Verse from './Verse';
import './ChapterView.css';

interface Props {
  chapter: ChapterData;
  ttsAvailable: boolean;
  onPlayVerse?: (verseIndex: number, verseText: string) => void;
  onStopVerse?: () => void;
  playingVerse?: number | null;
  selectionHighlight?: { start: number; end: number } | null;
  className?: string;
  renderTitle?: boolean;
}

export default function ChapterView({
  chapter,
  ttsAvailable,
  onPlayVerse,
  onStopVerse,
  playingVerse,
  selectionHighlight,
  className = '',
  renderTitle = true,
}: Props): React.ReactElement {
  return (
    <article className={`chapter-view ${className}`}>
      {renderTitle && (
        <header className="chapter-view__title">
          <h1>
            {chapter.bookName} {chapter.chapterNumber}
          </h1>
        </header>
      )}
      <div className="chapter-view__verses">
        {chapter.verses.map((verseText, i) => (
          <Verse
            key={i}
            number={i + 1}
            text={verseText}
            ttsAvailable={ttsAvailable}
            onPlayTTS={onPlayVerse ? () => onPlayVerse(i, verseText) : undefined}
            onStopTTS={onStopVerse}
            isPlaying={playingVerse === i}
            isSelection={selectionHighlight ? i >= selectionHighlight.start && i <= selectionHighlight.end : false}
          />
        ))}
      </div>
    </article>
  );
}
