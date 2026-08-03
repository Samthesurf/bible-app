interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number | undefined, className: string | undefined) => ({
  width: size ?? 20,
  height: size ?? 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
});

export const BookIcon = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

export const SearchIcon = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

export const ChevronDown = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ChevronLeft = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export const ChevronRight = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const SpeakerIcon = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

export const ColumnsIcon = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M12 3v18" />
  </svg>
);

export const PlayIcon = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
  </svg>
);

export const StopIcon = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect width="14" height="14" x="5" y="5" rx="2" fill="currentColor" stroke="none" />
  </svg>
);

export const UserIcon = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export const CheckIcon = ({ size, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
