import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadConfig, type AppConfig } from '../src/config.js';
import { SqliteStore } from '../src/db/sqliteStore.js';
import { AIChain, type AIJsonRequest, type AIProvider } from '../src/ai/provider.js';
import { createApp } from '../src/app.js';

export const FIXTURES = path.resolve(__dirname, 'fixtures');
export const LOCAL_FIXTURES = path.resolve(__dirname, 'fixtures');
export const JD_TEXT = fs.readFileSync(path.join(LOCAL_FIXTURES, 'job-description.txt'), 'utf8');
export const PASTED_RESUME = fs.readFileSync(path.join(LOCAL_FIXTURES, 'pasted-resume.txt'), 'utf8');

function between(prompt: string, tag: string): string {
  const m = prompt.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`));
  return m ? m[1] : '';
}

/**
 * Deterministic stand-in for Claude. It behaves like a reasonable model but
 * also deliberately misbehaves (inventing a skill and a metric) so the tests
 * prove that the factual guard catches it.
 */
export class FakeAI implements AIProvider {
  readonly name = 'fake';
  calls: AIJsonRequest[] = [];
  failNext = false;

  async generateJSON(req: AIJsonRequest): Promise<unknown> {
    this.calls.push(req);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated provider outage');
    }
    switch (req.task) {
      case 'parse':
        throw new Error('parse not supported by fake; use rule-based parser');
      case 'jd':
        return { jobTitle: 'Cloud Support Engineer', company: 'Northwind Systems', requiredSkills: ['AWS', 'Linux', 'Python', 'SQL', 'Quantum Computing'], preferredSkills: ['Docker', 'Terraform'], tools: ['CloudWatch'], experienceRequirements: [], educationRequirements: [], certifications: [], responsibilities: [], industryKeywords: [], atsKeywords: ['Troubleshooting', 'REST API'] };
      case 'entry': {
        // Echoes the source faithfully, plus one invented point that the guard must drop.
        const src = between(req.prompt, 'source');
        const intern = /intern/i.test(src);
        const lines = src.split(/\n+/).map((l) => l.replace(/^[-•*\s]+/, '').trim()).filter((l) => l.length > 25);
        const empty = { title: '', technologies: [], points: [], githubUrl: '', liveUrl: '', startDate: '', endDate: '' };
        return intern
          ? { kind: 'experience', project: empty, experience: { jobTitle: 'Data Engineering Intern', company: 'Acme Analytics', location: '', startDate: '2024-01', endDate: '2024-04', current: false, points: lines.slice(0, 3) }, certification: { name: '', issuer: '', date: '' }, skillsUsed: ['Python', 'Selenium'], question: '' }
          : { kind: 'project', project: { title: 'Job Listings Scraper', technologies: ['Python', 'Selenium', 'BeautifulSoup', 'Kubernetes'], points: [...lines.slice(0, 3), 'Scaled the platform to serve 2 million users with a Kubernetes cluster across 5 regions.'], githubUrl: '', liveUrl: '', startDate: '', endDate: '' }, experience: { jobTitle: '', company: '', location: '', startDate: '', endDate: '', current: false, points: [] }, certification: { name: '', issuer: '', date: '' }, skillsUsed: ['Selenium', 'BeautifulSoup', 'Kubernetes'], question: '' };
      }
      case 'semantic':
        return { score: 70, rationale: 'Relevant support experience.' };
      case 'generate': {
        const r = JSON.parse(between(req.prompt, 'original_resume'));
        return {
          headline: 'Cloud Support Engineer',
          summary: 'Technical support engineer with hands-on AWS, Linux and Python experience troubleshooting production issues. Improved uptime by 99% across 500 servers. Expert in SQL query tuning.',
          skills: [
            { name: 'Cloud & Infrastructure', skills: ['AWS', 'Kubernetes'] },
            { name: 'Programming', skills: ['Python', 'SQL', 'REST APIs'] },
          ],
          experience: r.experience.map((e: any) => ({ id: e.id, description: '', bullets: e.bullets.map((b: string, i: number) => (i === 0 ? `${b.replace(/\.$/, '')}, reducing incidents by 40%.` : `Resolved: ${b}`)) })),
          projects: r.projects.map((p: any) => ({ id: p.id, description: `${p.description} (tailored)` })),
          achievements: [],
          sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications'],
          skillGaps: ['CloudWatch'],
          notes: [],
        };
      }
      case 'edit': {
        const instruction = between(req.prompt, 'user_instruction').toLowerCase();
        const resume = JSON.parse(between(req.prompt, 'resume'));
        const nulls = { headline: null, summary: null, skills: null, experience: null, projects: null, education: null, certifications: null, achievements: null, sections: null, customSections: null, template: null, layout: null };
        if (instruction.includes('summary shorter')) {
          const words = String(resume.summary).split(/\s+/);
          const first = words.length > 8 ? `${words.slice(0, Math.ceil(words.length / 2)).join(' ').replace(/[,.]$/, '')}.` : String(resume.summary).split(/(?<=\.)\s/)[0];
          return { message: 'I shortened your summary. Please re-upload your resume if anything looks wrong.', changes: ['Shortened summary'], clarifyingQuestion: '', skillGaps: [], updates: { ...nulls, summary: first } };
        }
        if (instruction.includes('linux and aws')) {
          return {
            message: 'Highlighted AWS work in your experience.',
            changes: ['Reworded experience bullets to emphasise AWS'],
            clarifyingQuestion: '',
            skillGaps: [],
            updates: { ...nulls, experience: resume.experience.map((e: any) => ({ ...e, jobTitle: 'CTO', company: 'Fake Corp', bullets: e.bullets.map((b: string) => `Leveraged AWS: ${b}`) })) },
          };
        }
        if (instruction.includes('add terraform')) {
          return { message: 'Added Terraform.', changes: ['Added Terraform to skills'], clarifyingQuestion: '', skillGaps: [], updates: { ...nulls, skills: [...resume.skills, { name: 'IaC', skills: ['Terraform'] }] } };
        }
        if (instruction.includes('garbage')) return 'this is not json';
        if (instruction.includes('suggest')) {
          return {
            message: '1. Log Parser CLI\n2. CloudWatch Alerting Dashboard\nWhich would you like me to add?',
            changes: [],
            clarifyingQuestion: '',
            skillGaps: [],
            offer: { skills: [], projects: [{ title: 'Log Parser CLI', description: 'Python CLI that parses server logs.', technologies: ['Python'] }, { title: 'CloudWatch Alerting Dashboard', description: 'Dashboard of CloudWatch alarms for EC2 hosts.', technologies: ['AWS', 'CloudWatch'] }] },
            updates: nulls,
          };
        }
        if (instruction.includes('claim only')) return { message: 'I standardized all headings.', changes: ['Standardized headings'], clarifyingQuestion: '', skillGaps: [], updates: nulls };
        if (instruction.includes('analy')) {
          return { message: 'Strengths:\n- Clear Linux administration experience\n- Relevant scripting\nWeaknesses:\n- No metrics in the college role', changes: [], clarifyingQuestion: '', skillGaps: [], updates: nulls };
        }
        if (instruction.includes('question')) return { message: '', changes: [], clarifyingQuestion: 'What technologies did the new project use?', skillGaps: [], updates: nulls };
        return { message: 'No changes needed.', changes: [], clarifyingQuestion: '', skillGaps: [], updates: nulls };
      }
      case 'interview':
        return {
          questions: Array.from({ length: 6 }, (_, i) => ({ question: `Fake question ${i + 1} about AWS troubleshooting?`, category: i < 3 ? 'technical' : 'behavioral', skill: 'AWS', why: 'Required skill.', idealPoints: ['Concrete example', 'Tools used'] })),
        };
      case 'interview_turn': {
        const props = (req.schema as { properties?: Record<string, unknown> }).properties || {};
        if ('hint' in props) return { hint: 'Think about the tools you used and the first thing you checked.', modelAnswer: 'In my support role I used CloudWatch to find the failing instance, then restarted the service.' };
        const answer = between(req.prompt, 'candidate_answer');
        const isFollowUpAnswer = req.prompt.includes('Follow-up being answered:');
        const good = isFollowUpAnswer || /cloudwatch/i.test(answer);
        return good
          ? { verdict: 'correct', score: 8, clarity: 'clear', confidence: 'confident', strengths: ['Concrete example'], gaps: [], followUp: '', clarification: '', acknowledgement: 'Okay, that makes sense.', suggestion: 'Add the result.', suggestedAnswer: 'I used CloudWatch to find the failing instance and restarted it.' }
          : { verdict: 'partially_correct', score: 5, clarity: 'somewhat_clear', confidence: 'hesitant', strengths: ['Right direction'], gaps: ['No tool named'], followUp: 'Which tool would you check first?', clarification: 'You would start with the monitoring dashboards.', acknowledgement: 'Okay.', suggestion: 'Name the tool.', suggestedAnswer: 'I would check CloudWatch first.' };
      }
      case 'interview_summary':
        return { overallScore: 7, readiness: 'almost', strengths: ['Concrete examples'], improve: ['Name tools earlier'] };
      case 'chat':
        // Misbehaves on purpose: proposes applying to a link the user never typed (as an injected page might ask).
        return { answer: 'You have applications in your records.', citations: ['apps-summary'], action: { type: 'single_apply', url: 'https://evil.example/apply', applicationId: '', stage: '', skill: '' } };
    }
    throw new Error('unknown task');
  }
}

export async function makeApp(opts: { dbFile?: string; ai?: AIProvider | null; config?: Partial<AppConfig> } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
  const config: AppConfig = { ...loadConfig({ DATA_DIR: dataDir, ATS_SEMANTIC_ANALYSIS: 'false' } as any), ...opts.config };
  config.rateLimit = { windowMs: 60_000, general: 10_000, ai: 10_000 };
  const store = new SqliteStore(opts.dbFile || ':memory:');
  await store.migrate();
  const fake = opts.ai === undefined ? new FakeAI() : opts.ai;
  const ai = new AIChain(fake ? [fake] : []);
  // Test sign-in: the "ID token" is "user:<uid>".
  const verifyIdToken = async (t: string) => {
    if (!t.startsWith('user:')) throw new Error('bad token');
    return { uid: t.slice(5) };
  };
  const { app, service, career } = await createApp({ config, store, ai, verifyIdToken });
  return { app, service, career, store, fake: fake as FakeAI | null, config, dataDir };
}

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

export async function createPasted(t: TestApp, text = PASTED_RESUME) {
  const res = await request(t.app).post('/api/resumes/paste').send({ text }).expect(201);
  return { id: res.body.session.id as string, token: res.body.token as string, body: res.body };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
