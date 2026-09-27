import React from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { ArrowLeft, Code, FileText, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';

export const About: React.FC = () => (
  <div className="min-h-screen bg-gradient-secondary">
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <Link to="/resume-maker" className="inline-flex items-center gap-2 text-primary hover:text-primary-hover transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Resume Agent
          </Link>
          <ThemeToggle />
        </div>

        <div className="text-center mb-10">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl font-bold text-gradient mb-3">Resume Agent</h1>
          <p className="text-lg text-text-secondary">
            An AI-assisted resume workspace for tailoring, editing, templating and exporting resumes.
          </p>
        </div>

        <Card className="mb-6 resume-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> What it does</CardTitle>
          </CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-5 text-sm text-text-secondary leading-relaxed">
            <div><strong className="text-foreground">Resume import</strong><br />Import PDF, DOCX or JSON resumes and turn their content into editable resume data.</div>
            <div><strong className="text-foreground">AI tailoring</strong><br />Tailor supported resume evidence to a job description while keeping factual-protection rules enabled.</div>
            <div><strong className="text-foreground">Templates</strong><br />Switch between professional resume layouts without replacing the underlying resume content.</div>
            <div><strong className="text-foreground">Export</strong><br />Export the current editable resume to PDF or DOCX, including supported personal hyperlinks.</div>
          </CardContent>
        </Card>

        <Card className="resume-shadow">
          <CardContent className="pt-6 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <Code className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Built for resume work</h2>
            <p className="text-sm text-text-secondary leading-relaxed mb-5">
              The workspace keeps the editable resume state separate from the chat experience so template,
              customization and local edits can be changed without recreating the resume.
            </p>
            <Button asChild><Link to="/resume-maker">Open Resume Agent</Link></Button>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
);
