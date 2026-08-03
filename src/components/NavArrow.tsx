import React from 'react';
import { ChevronLeft, ChevronRight } from './Icons';
import './NavArrow.css';

interface Props {
  direction: 'prev' | 'next';
  onClick: () => void;
  disabled?: boolean;
}

export default function NavArrow({ direction, onClick, disabled }: Props): React.ReactElement {
  const isPrev = direction === 'prev';
  return (
    <button
      type="button"
      className={`nav-arrow nav-arrow--${direction}`}
      onClick={onClick}
      disabled={disabled}
      title={isPrev ? 'Previous chapter' : 'Next chapter'}
      aria-label={isPrev ? 'Previous chapter' : 'Next chapter'}
    >
      {isPrev ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  );
}
