import React from 'react';
import { Link } from 'react-router-dom';
import { Bot, FileCheck2, GraduationCap, KanbanSquare, Link2, MessageSquare, Mic, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';
import { ThemeToggle } from '../components/ThemeToggle';
import { UserMenu } from '@/components/auth/UserMenu';

const FEATURES = [
  { icon: FileCheck2, title: 'Resume Builder & ATS analyzer', text: 'Upload once, tailor to any job with an explained ATS score — only your real experience.' },
  { icon: Link2, title: 'Single Job Apply', text: 'Paste a job link: it reads the JD, tailors your resume as “Role – Company” and applies.' },
  { icon: Bot, title: 'Auto Job Agent', text: 'Searches jobs by your resume or skills, tailors and applies within your limits while it is on.' },
  { icon: KanbanSquare, title: 'Application Tracker', text: 'From found to offer: stages, follow-up reminders, email drafts and response-rate stats.' },
  { icon: Mic, title: 'Interview Prep', text: 'Likely questions for each job and your resume, mock answers by voice or text, and coaching.' },
  { icon: GraduationCap, title: 'Skills & Learning', text: 'Skill gaps measured across real job descriptions, study plans and proof projects.' },
  { icon: MessageSquare, title: 'Career Assistant', text: 'Ask about your own records or tell it what to do — every action waits for your confirmation.' },
  { icon: ShieldCheck, title: 'Honest by design', text: 'No invented skills, metrics or employers. CAPTCHAs and unknown questions are left for you.' },
];

/** Landing page for signed-out visitors. */
const Index = () => (
  <div className="min-h-screen bg-gradient-to-b from-sky-50 to-background dark:from-slate-900 dark:to-background">
    <header className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-4">
      <div className="flex items-center gap-2 font-semibold">
        <span className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
          <Sparkles className="w-4 h-4" />
        </span>
        AI Career Assistant
      </div>
      <nav className="ml-auto flex items-center gap-1">
        <ThemeToggle compact />
        <UserMenu />
      </nav>
    </header>
    <main className="mx-auto max-w-6xl px-4 pb-16">
      <section className="py-12 md:py-20 text-center max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Your job search, on autopilot — truthfully.</h1>
        <p className="mt-4 text-lg text-muted-foreground">Tailor your resume to every job, apply from a single link or let the agent search and apply for you, then track, prepare and grow — all from one place on your own computer.</p>
        <div className="mt-8 flex justify-center">
          <Button size="lg" asChild>
            <Link to="/login">Sign in to start</Link>
          </Button>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

export default Index;
