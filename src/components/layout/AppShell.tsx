import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, Briefcase, FileText, GraduationCap, KanbanSquare, LayoutDashboard, Link2, Menu, MessageSquare, Mic, Settings, Sparkles, UserRound } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UserMenu } from '@/components/auth/UserMenu';
import { career } from '@/lib/careerApi';
import { cn } from '@/lib/utils';

const NAV: Array<{ to: string; label: string; icon: React.ElementType; badge?: 'attention' | 'ready' }> = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/builder', label: 'Resume Builder', icon: FileText },
  { to: '/resumes', label: 'My resumes', icon: Briefcase },
  { to: '/apply', label: 'Single Job Apply', icon: Link2, badge: 'ready' },
  { to: '/agent', label: 'Auto Job Agent', icon: Bot },
  { to: '/tracker', label: 'Application Tracker', icon: KanbanSquare, badge: 'attention' },
  { to: '/interview', label: 'Interview Prep', icon: Mic },
  { to: '/skills', label: 'Skills & Learning', icon: GraduationCap },
  { to: '/assistant', label: 'Career Assistant', icon: MessageSquare },
  { to: '/profile', label: 'Career Profile', icon: UserRound },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useQuery({ queryKey: ['tracker'], queryFn: career.tracker, refetchInterval: 30_000, retry: false });
  const counts = { attention: data?.reminders.needsAttention || 0, ready: data?.reminders.readyForReview || 0 };
  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
      {NAV.map(({ to, label, icon: Icon, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
        >
          <Icon className="w-4 h-4 shrink-0" />
          <span className="flex-1 truncate">{label}</span>
          {badge && counts[badge] > 0 && (
            <span className={cn('rounded-full px-1.5 text-[11px] font-semibold', badge === 'attention' ? 'bg-amber-500 text-white' : 'bg-sky-500 text-white')} title={badge === 'attention' ? 'Need your attention' : 'Ready for your review'}>
              {counts[badge]}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold">
      <span className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
        <Sparkles className="w-4 h-4" />
      </span>
      AI Career Assistant
    </Link>
  );
}

/** Sidebar layout for every app page (the resume builder keeps its own full-screen layout). */
export const AppShell: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; wide?: boolean }> = ({ title, subtitle, actions, children, wide }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-muted/30 flex">
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r bg-background sticky top-0 h-screen">
        <div className="px-4 py-4 border-b">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">
          <Nav />
        </div>
        <p className="px-4 py-3 text-[11px] text-muted-foreground border-t">Runs on your computer · never invents resume facts</p>
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="px-4 py-4 border-b">
            <SheetTitle className="text-left">
              <Brand />
            </SheetTitle>
          </SheetHeader>
          <Nav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/90 backdrop-blur px-4 py-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight truncate">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-1.5">
            {actions}
            <ThemeToggle compact />
            <UserMenu />
          </div>
        </header>
        <main className={cn('flex-1 w-full mx-auto p-4 md:p-6', wide ? 'max-w-7xl' : 'max-w-5xl')}>{children}</main>
      </div>
    </div>
  );
};
