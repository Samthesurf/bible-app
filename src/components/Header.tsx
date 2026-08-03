import React from 'react';
import { BookIcon, UserIcon } from './Icons';
import SearchBar from './SearchBar';
import './Header.css';

const TABS = [
  { id: 'bible', label: 'Bible', active: true },
  { id: 'plans', label: 'Plans', active: false },
  { id: 'videos', label: 'Videos', active: false },
];

export default function Header(): React.ReactElement {
  return (
    <header className="header">
      <div className="header__left">
        <div className="header__logo">
          <span className="header__logo-icon">
            <BookIcon size={20} />
          </span>
          <span className="header__logo-text">Bible App</span>
        </div>
        <nav className="header__nav" aria-label="Main">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`header__tab${tab.active ? ' header__tab--active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="header__center">
        <SearchBar />
      </div>

      <div className="header__right">
        <button type="button" className="header__cta">
          Get the app
        </button>
        <button type="button" className="header__avatar" aria-label="Profile">
          <UserIcon size={18} />
        </button>
      </div>
    </header>
  );
}
