import React, { useState } from 'react';
import { PlayIcon, StopIcon, CompareIcon } from './Icons';
import { cleanVerseText } from '../utils/verseText';
import './Verse.css';

interface Props {
  number: number;
  text: string;
  ttsAvailable: boolean;
  onPlayTTS?: (verseText: string) => void;
  onStopTTS?: () => void;
  isPlaying?: boolean;
  isSelection?: boolean;
  onCompare?: () => void;
}

export default function Verse({
  number,
  text,
  ttsAvailable,
  onPlayTTS,
  onStopTTS,
  isPlaying,
  isSelection,
  onCompare,
}: Props): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  // The row is a flex line: a reserved action rail plus the verse text. The
  // buttons live IN the rail (real in-flow children), so the text -> gutter
  // -> button journey is one continuous hover surface. No gap, no vanish.
  const active = hovered || isPlaying;
  const canPlay = ttsAvailable && Boolean(onPlayTTS);

  return (
    <div
      className={`verse-row${active ? ' verse-row--active' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="verse-actions" aria-hidden={!active ? true : undefined}>
        {canPlay && (
          <button
            type="button"
            className="verse__play"
            title={isPlaying ? 'Stop' : 'Play verse'}
            aria-label={isPlaying ? 'Stop reading this verse' : 'Read this verse aloud'}
            onClick={() => {
              if (isPlaying) onStopTTS?.();
              else onPlayTTS?.(text);
            }}
          >
            {isPlaying ? <StopIcon size={13} /> : <PlayIcon size={13} />}
          </button>
        )}
        {onCompare && (
          <button
            type="button"
            className="verse__compare"
            title="Compare in all translations"
            aria-label={`Compare verse ${number} in all translations`}
            onClick={onCompare}
          >
            <CompareIcon size={13} />
          </button>
        )}
      </div>
      <p
        className={`verse${isPlaying ? ' verse--playing' : ''}${
          isSelection ? ' verse--selection' : ''
        }`}
        data-verse-index={number - 1}
      >
        <span className="verse__number">{number}</span>
        <span className="verse__text">{cleanVerseText(text)}</span>
      </p>
    </div>
  );
}