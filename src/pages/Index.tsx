import React from 'react';
import { Link } from 'react-router-dom';
import { Bot, FileCheck2, GraduationCap, KanbanSquare, Link2, MessageSquare, Mic, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';
import { ThemeToggle } from '../components/ThemeToggle';
import { UserMenu } from '@/components/auth/UserMenu';
import landing from '@/content/landing.json';

// Shared with the build's search-engine snapshot (scripts/seo.mjs).
const ICONS: Record<string, typeof Bot> = { resume: FileCheck2, link: Link2, agent: Bot, tracker: KanbanSquare, interview: Mic, skills: GraduationCap, chat: MessageSquare, honest: ShieldCheck };
const FEATURES = landing.features.map((f) => ({ ...f, icon: ICONS[f.icon] || Sparkles }));

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
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{landing.headline}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{landing.intro}</p>
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
