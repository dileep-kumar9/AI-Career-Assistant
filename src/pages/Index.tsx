import React from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, FileCheck2, History, MessageSquare, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';
import { ThemeToggle } from '../components/ThemeToggle';
import { UserMenu } from '@/components/auth/UserMenu';
import { sessionStore } from '../lib/sessions';

const FEATURES = [
  { icon: FileCheck2, title: 'Upload once', text: 'PDF, DOCX or pasted text. Your original resume is stored as the source of truth for the whole session.' },
  { icon: Sparkles, title: 'Tailored to the job', text: 'Paste a job description and get an ATS-friendly resume built only from your real experience.' },
  { icon: MessageSquare, title: 'Edit by chatting', text: '“Make my summary shorter”, “Highlight my AWS work”, “Undo” — as many times as you need.' },
  { icon: BarChart3, title: 'Explained ATS score', text: 'A transparent 0–100 compatibility estimate with matched and missing keywords and evidence.' },
  { icon: History, title: 'Every version kept', text: 'Preview, compare, restore, undo and redo. Nothing is ever lost.' },
  { icon: ShieldCheck, title: 'No invented facts', text: 'Unsupported skills, metrics and employers are blocked and reported as skill gaps instead.' },
];

const Index = () => {
  const last = sessionStore.last();
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-background dark:from-slate-900 dark:to-background">
      <header className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </span>
          Resume Creator AI
        </div>
        <nav className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/resumes">My resumes</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/about">About</Link>
          </Button>
          <ThemeToggle compact />
          <UserMenu />
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16">
        <section className="py-12 md:py-20 text-center max-w-3xl mx-auto">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">Resume Creator AI · free AI resume builder</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Tailor your resume to every job — truthfully.</h1>
          <p className="mt-4 text-lg text-muted-foreground">Upload your resume once, paste a job description, and refine an ATS-friendly version through conversation until it is exactly right.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" asChild>
              <Link to="/builder">Build an ATS resume</Link>
            </Button>
            {last && (
              <Button size="lg" variant="outline" asChild>
                <Link to={`/builder/${last.id}`}>Continue “{last.title.length > 28 ? `${last.title.slice(0, 28)}…` : last.title}”</Link>
              </Button>
            )}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Prefer free-form design? The <Link to="/resume-maker" className="underline">classic editor</Link> is still available.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border bg-background p-5">
              <Icon className="w-5 h-5 text-primary mb-3" />
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
};

export default Index;
