export type ViewMode = 'single' | 'translations' | 'chapters';

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const OPTIONS: { id: ViewMode; label: string }[] = [
  { id: 'single', label: 'Single' },
  { id: 'translations', label: 'Translations' },
  { id: 'chapters', label: 'Chapters' },
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
          <span className="mode-selector__dot" aria-hidden="true" />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
