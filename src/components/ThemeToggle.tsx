import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';

const STORAGE_KEY = 'resume-agent-theme';

export const ThemeToggle: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const nextDark = saved ? saved === 'dark' : prefersDark;
    setDark(nextDark);
    document.documentElement.classList.toggle('dark', nextDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
  };

  return (
    <Button
      type="button"
      size={compact ? 'icon' : 'sm'}
      variant="ghost"
      onClick={toggle}
      title={dark ? 'Switch to bright theme' : 'Switch to dark theme'}
      aria-label={dark ? 'Switch to bright theme' : 'Switch to dark theme'}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      {!compact && <span className="ml-2">{dark ? 'Bright' : 'Dark'}</span>}
    </Button>
  );
};
