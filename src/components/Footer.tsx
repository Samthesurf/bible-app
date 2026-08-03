import React from 'react';
import { useBible } from '../context/BibleContext';
import { useChapter } from '../hooks/useChapter';
import './Footer.css';

export default function Footer(): React.ReactElement {
  const { translationAbbr, bookIndex, chapterIndex } = useBible();
  const { chapter } = useChapter(translationAbbr, bookIndex, chapterIndex);

  return (
    <footer className="footer">
      {chapter?.copyright && <span className="footer__text">{chapter.copyright}</span>}
      {!chapter?.copyright && <span className="footer__text">Bible App — offline</span>}
    </footer>
  );
}
