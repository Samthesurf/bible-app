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

  const showTTS = ttsAvailable && (hovered || isPlaying);
  const displayText = cleanVerseText(text);

  return (
    <p
      className={`verse${isPlaying ? ' verse--playing' : ''}${
        isSelection ? ' verse--selection' : ''
      }`}
      data-verse-index={number - 1}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {showTTS && (
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
          {isPlaying ? <StopIcon size={14} /> : <PlayIcon size={14} />}
        </button>
      )}
      {onCompare && hovered && (
        <button
          type="button"
          className="verse__compare"
          title="Compare in all translations"
          aria-label={`Compare ${number} in all translations`}
          onClick={onCompare}
        >
          <CompareIcon size={14} />
        </button>
      )}
      <span className="verse__number">{number}</span>
      <span className="verse__text">{displayText}</span>
    </p>
  );
}
