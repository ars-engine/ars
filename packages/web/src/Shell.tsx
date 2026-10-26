import { Link, Outlet } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useApi } from './api';
import { JobTray } from './jobs';
import { Badge } from './ui';

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('ars-theme') ?? 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ars-theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')] as const;
}

export function Shell() {
  const [theme, toggle] = useTheme();
  const health = useApi<{ llm: boolean; dataDir: string }>('/health');
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">A</span> ARS <small>engineering signature engine</small>
        </Link>
        <div className="spacer" />
        {health.data && (
          <Badge tone={health.data.llm ? 'ok' : 'warn'} title={health.data.llm ? 'Claude API credentials found' : 'Set ANTHROPIC_API_KEY and restart to enable deep-read, judging and agent runs'}>
            {health.data.llm ? '● Claude connected' : '○ Claude not configured'}
          </Badge>
        )}
        <button className="btn ghost sm" onClick={toggle}>{theme === 'dark' ? '☀ Light' : '☾ Dark'}</button>
      </header>
      <div className="main"><Outlet /></div>
      <JobTray />
    </div>
  );
}
