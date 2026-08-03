import React from 'react';
import { SinglePageIcon, ColumnsIcon, SplitChaptersIcon } from './Icons';
import './ParallelModeSelector.css';

export type ViewMode = 'single' | 'translations' | 'chapters';

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const OPTIONS: { id: ViewMode; label: string; icon: React.ReactElement }[] = [
  { id: 'single', label: 'Single', icon: <SinglePageIcon size={14} /> },
  { id: 'translations', label: 'Translations', icon: <ColumnsIcon size={14} /> },
  { id: 'chapters', label: 'Chapters', icon: <SplitChaptersIcon size={14} /> },
];

/** Segmented control: Single / Parallel Translations / Parallel Chapters. */
export default function ParallelModeSelector({ mode, onChange }: Props) {
  return (
    <div className="mode-selector" role="group" aria-label="View mode">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`mode-selector__option${mode === opt.id ? ' mode-selector__option--active' : ''}`}
          onClick={() => onChange(opt.id)}
          aria-pressed={mode === opt.id}
          title={`${opt.label} view`}
        >
          <span className="mode-selector__icon" aria-hidden="true">
            {opt.icon}
          </span>
          <span className="mode-selector__label">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
