import React, { useState } from 'react';
import { PlayIcon, StopIcon } from './Icons';
import './Verse.css';

interface Props {
  number: number;
  text: string;
  ttsAvailable: boolean;
  onPlayTTS?: (verseText: string) => void;
  onStopTTS?: () => void;
  isPlaying?: boolean;
  isSelection?: boolean;
}

export default function Verse({
  number,
  text,
  ttsAvailable,
  onPlayTTS,
  onStopTTS,
  isPlaying,
  isSelection,
}: Props): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  const showTTS = ttsAvailable && (hovered || isPlaying);

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
      <span className="verse__number">{number}</span>
      <span className="verse__text">{text}</span>
    </p>
  );
}
