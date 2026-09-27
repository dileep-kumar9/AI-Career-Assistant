import { describe, expect, it } from 'vitest';
import { parseResumeText } from '../../shared/heuristicParser.js';
import { analyzeJobDescriptionDeterministic, mergeJDAnalysis } from '../../shared/jdAnalyzer.js';
import { DEFAULT_WEIGHTS, experienceYears, normalizeWeights, scoreResume } from '../../shared/ats.js';
import { findKeyword, matchKeyword } from '../../shared/match.js';
import { diffResumes, wordDiff } from '../../shared/diff.js';
import { normalizeResume } from '../../shared/normalize.js';
import { humanizeLine, humanizeProse } from '../../shared/humanize.js';
import { improvementPlan, planToText } from '../../shared/improve.js';
import { sectionHeading } from '../../shared/templates.js';
import { applyEdit, assertedFacts, unsupportedNumbers, unsupportedTerms } from '../src/services/factGuard.js';
import { parseCommand } from '../src/services/commands.js';
import { extractJobDescription, stripReupload } from '../src/services/resumeService.js';
import { JD_TEXT, PASTED_RESUME } from './helpers.js';

const resume = parseResumeText(PASTED_RESUME);
const jd = analyzeJobDescriptionDeterministic(JD_TEXT);
const NOW = new Date('2026-01-01T00:00:00Z');

describe('keyword matching', () => {
  it('matches aliases and respects word boundaries', () => {
    expect(findKeyword('Worked with Amazon Web Services daily', 'AWS')).toBeTruthy();
    expect(findKeyword('Built with Node.js', 'Node.js')).toBeTruthy();
    expect(findKeyword('Knows C++ and C#', 'C#')).toBeTruthy();
    expect(findKeyword('Uses Java', 'JavaScript')).toBeNull();
    expect(findKeyword('Let us go to the store', 'Go')).toBeNull();
    expect(findKeyword('Languages: Python, Go, Rust', 'Go')).toBeTruthy();
    expect(findKeyword('Managed K8s clusters', 'Kubernetes')).toBeTruthy();
  });

  it('distinguishes matched, partial and missing', () => {
    expect(matchKeyword('Automated deployments', 'Automation')).toBe('partial');
    expect(matchKeyword('Led incident response for P1 outages', 'Incident Response')).toBe('matched');
    expect(matchKeyword('incident management and response', 'Incident Response')).toBe('partial');
    expect(matchKeyword('handled incidents daily', 'Incident Response')).toBe('partial');
    expect(matchKeyword('Python developer', 'Terraform')).toBe('missing');
  });
});

describe('job description analysis', () => {
  it('separates required and preferred skills and extracts requirements', () => {
    expect(jd.jobTitle).toBe('Cloud Support Engineer');
    expect(jd.company).toBe('Northwind Systems');
    expect(jd.requiredSkills).toEqual(expect.arrayContaining(['AWS', 'Linux', 'Python', 'SQL', 'REST API']));
    expect(jd.preferredSkills).toEqual(expect.arrayContaining(['Docker', 'Kubernetes', 'Terraform']));
    expect(jd.requiredSkills).not.toContain('Terraform');
    expect(jd.minYears).toBe(1);
    expect(jd.educationLevel).toBe(2);
    expect(jd.responsibilities.length).toBeGreaterThanOrEqual(4);
  });

  it('only merges AI keywords that literally appear in the JD', () => {
    const merged = mergeJDAnalysis(jd, { requiredSkills: ['Bash', 'Blockchain'], jobTitle: 'Cloud Support Engineer II' }, JD_TEXT);
    expect(merged.requiredSkills).toContain('Bash');
    expect(merged.requiredSkills).not.toContain('Blockchain');
    expect(merged.jobTitle).toBe('Cloud Support Engineer II');
  });
});

describe('ATS scoring', () => {
  it('is deterministic and uses the documented weights', () => {
    const a = scoreResume(resume, jd, { original: resume, now: NOW });
    const b = scoreResume(resume, jd, { original: resume, now: NOW });
    expect(a.total).toBe(b.total);
    expect(a.weights).toEqual(DEFAULT_WEIGHTS);
    expect(a.total).toBeGreaterThan(30);
    expect(a.total).toBeLessThanOrEqual(100);
    expect(a.requiredMissing).toContain('SQL');
    expect(a.requiredMatched).toEqual(expect.arrayContaining(['AWS', 'Linux', 'Python']));
  });

  it('flags lab-only evidence and recommends only supported keywords', () => {
    const a = scoreResume(resume, jd, { original: resume, now: NOW });
    const k8s = a.keywords.find((k) => k.keyword === 'Kubernetes')!;
    expect(k8s.evidence.labOnly).toBe(true);
    expect(k8s.recommendation).toMatch(/lab\/training experience/);
    const sql = a.keywords.find((k) => k.keyword === 'SQL')!;
    expect(sql.evidence.inOriginal).toBe(false);
    expect(sql.recommendation).toMatch(/skill gap/i);
  });

  it('raises the score when a supported keyword is surfaced, and weights are configurable', () => {
    const hidden = normalizeResume({ ...resume, skills: { mode: 'simple', simple: ['Git'], categorized: [] }, summary: '' });
    const low = scoreResume(hidden, jd, { original: resume, now: NOW });
    const high = scoreResume(resume, jd, { original: resume, now: NOW });
    expect(high.total).toBeGreaterThan(low.total);
    const onlyStructure = scoreResume(resume, jd, { original: resume, now: NOW, weights: { keywords: 0, requiredSkills: 0, experience: 0, structure: 1, education: 0 } });
    expect(onlyStructure.weights.structure).toBe(100);
    expect(normalizeWeights({ keywords: 60, requiredSkills: 20, experience: 10, structure: 5, education: 5 }).keywords).toBe(60);
  });

  it('computes years of experience with overlaps merged', () => {
    expect(experienceYears(resume, NOW)).toBeCloseTo(5.6, 0);
  });
});

describe('factual guard', () => {
  it('detects unsupported technologies and numbers', () => {
    expect(unsupportedTerms('Deployed Kubernetes and AWS', 'Used AWS')).toEqual(['Kubernetes']);
    expect(unsupportedNumbers('Cut costs by 30% for 120 servers', 'Administered 120 servers')).toEqual(['30']);
  });

  it('treats only first-person statements as evidence', () => {
    expect(assertedFacts('Add Terraform')).toBe('');
    expect(assertedFacts('I have used Terraform at work')).not.toBe('');
  });

  it('locks employers, dates and contact details during AI edits', () => {
    const edited = applyEdit(
      resume,
      resume,
      {
        message: '',
        changes: [],
        clarifyingQuestion: '',
        skillGaps: [],
        updates: { experience: resume.experience.map((e) => ({ id: e.id, jobTitle: 'CEO', company: 'Google', location: '', startDate: '2010', endDate: '', current: true, description: '', bullets: e.bulletPoints })) },
      },
      'rewrite',
    ).resume;
    expect(edited.experience.map((e) => [e.jobTitle, e.company, e.startDate])).toEqual(resume.experience.map((e) => [e.jobTitle, e.company, e.startDate]));
    expect(edited.personalInfo).toEqual(resume.personalInfo);
  });

  it('refuses unrequested deletions', () => {
    const r = applyEdit(resume, resume, { message: '', changes: [], clarifyingQuestion: '', skillGaps: [], updates: { experience: [] } }, 'polish my wording');
    expect(r.resume.experience).toHaveLength(2);
    expect(r.warnings.join(' ')).toMatch(/did not ask to remove/);
  });
});

describe('chat command router', () => {
  it('recognises deterministic commands', () => {
    expect(parseCommand('Undo the last change.')).toEqual({ type: 'undo' });
    expect(parseCommand('redo')).toEqual({ type: 'redo' });
    expect(parseCommand('Restore the previous version.')).toEqual({ type: 'restore-previous' });
    expect(parseCommand('go back to version 3')).toEqual({ type: 'restore-number', number: 3 });
    expect(parseCommand('Show me what changed in the latest version.')).toEqual({ type: 'show-diff' });
    expect(parseCommand('Change the resume template to a clean professional design.')).toEqual({ type: 'template', template: 'modern-professional' });
    expect(parseCommand('Make my professional summary shorter.')).toBeNull();
    expect(parseCommand('Improve the ATS score without adding fake skills.')).toBeNull();
  });

  it('strips any request to re-upload the resume', () => {
    expect(stripReupload('Done. Please re-upload your resume to continue.')).toBe('Done.');
  });
});

describe('diff', () => {
  it('reports section-level and word-level changes', () => {
    const next = structuredClone(resume);
    next.summary = 'Short summary.';
    next.experience = next.experience.slice(0, 1);
    const changes = diffResumes(resume, next);
    expect(changes.map((c) => `${c.section}:${c.type}`)).toEqual(['summary:modified', 'experience:removed']);
    expect(wordDiff('a b c', 'a x c').filter((t) => t.type !== 'same').map((t) => t.text.trim())).toEqual(['b', 'x']);
  });
});

describe('header parsing', () => {
  it('finds a portfolio written without https and skips degree/status lines as headline', () => {
    const r = parseResumeText(
      'BADHAM DILEEP KUMAR\nB.Tech — Information Technology | Fresher\ndileep@example.com | 9542167927 | Eluru, Andhra Pradesh\nLinkedIn: linkedin.com/in/dileep-kumar-badham | Portfolio: dileep-kumar9.github.io\nPROFESSIONAL SUMMARY\nGraduate with Python experience.',
    );
    expect(r.personalInfo.website).toBe('dileep-kumar9.github.io');
    expect(r.personalInfo.linkedin).toBe('linkedin.com/in/dileep-kumar-badham');
    expect(r.personalInfo.jobTitle).toBe('');
  });

  it('detects a job description pasted into the chat', () => {
    expect(extractJobDescription(`Tailor my resume to this JD:\n${JD_TEXT}`)?.startsWith('Job Title: Cloud Support Engineer')).toBe(true);
    expect(extractJobDescription('Make my summary shorter')).toBeNull();
  });

  it('routes headline removal to a local command', () => {
    expect(parseCommand('Remove the line below my name')).toEqual({ type: 'remove-headline' });
    expect(parseCommand('delete the headline')).toEqual({ type: 'remove-headline' });
    expect(parseCommand('Remove the objective section')).toBeNull();
  });
});

describe('bullet safety net', () => {
  it('restores specific details the rewrite dropped, without duplicating', async () => {
    const { restoreLostBullets } = await import('../src/services/factGuard.js');
    const source = ['Perform Log4j vulnerability remediation, including JAR replacement and OpenJDK upgrades.', 'Manage Amazon S3 buckets for file storage.'];
    const rewritten = ['Perform vulnerability remediation, including JAR replacement and OpenJDK upgrades.', 'Manage Amazon S3 buckets for application file storage.'];
    const r = restoreLostBullets(source, rewritten);
    expect(r.bullets).toEqual([source[0], rewritten[1]]);
    expect(r.restored).toBe(1);
  });

  it('removes a role description that repeats a bullet and collapses equal dates', async () => {
    const { formatDateRange } = await import('../../shared/normalize.js');
    const r = normalizeResume({ experience: [{ jobTitle: 'Admin', company: 'X', description: 'Did A.', bulletPoints: ['Did A.', 'Did B.', 'did b'] }] });
    expect(r.experience[0].description).toBe('');
    expect(r.experience[0].bulletPoints).toEqual(['Did A.', 'Did B.']);
    expect(formatDateRange('2024-11', '2024-11')).toBe('Nov 2024');
  });
});

describe('contact and style commands', () => {
  it('parses direct contact changes', () => {
    expect(parseCommand('change my location to Hyderabad, India')).toEqual({ type: 'contact', field: 'location', value: 'Hyderabad, India' });
    expect(parseCommand('update portfolio link to dileep-kumar9.github.io')).toEqual({ type: 'contact', field: 'website', value: 'dileep-kumar9.github.io' });
    expect(parseCommand('set headline to "Associate Technical Support Engineer | Global Voice Support & AI Automation"')).toMatchObject({ type: 'contact', field: 'jobTitle' });
    expect(parseCommand('change font to Georgia')).toMatchObject({ type: 'style' });
  });
});

describe('embellishment check', () => {
  it('flags rewrites that add claims, but allows honest rewording', async () => {
    const { novelWords } = await import('../src/services/factGuard.js');
    const source = 'Developing a first-person shooter game project with gesture-based controls and keyboard alternatives for accessible gameplay. Project design includes PC and Android support, multiplayer team rooms, and communication features such as voice signaling and pings.';
    const inflated = novelWords('Designed real-time communication protocols and structured data synchronization for multiplayer team rooms.', source);
    expect(inflated.fresh.length).toBeGreaterThanOrEqual(4);
    const honest = novelWords('Designed multiplayer team rooms with communication features such as voice signaling and pings.', source);
    expect(honest.fresh.length).toBeLessThan(4);
  });
});

describe('human-sounding output', () => {
  it('replaces AI vocabulary without changing facts', () => {
    expect(humanizeLine('Utilized Python in order to build a robust ETL pipeline — leveraging Pandas.')).toBe('Used Python to build an ETL pipeline, using Pandas.');
    const summary = humanizeProse('Seeking to leverage my skills in a fast-paced environment. Data Analyst with 2 years of SQL and Excel reporting.');
    expect(summary).toBe('Data Analyst with 2 years of SQL and Excel reporting.');
  });

  it('prints custom sections under their own title-cased heading', () => {
    expect(sectionHeading('STRENGTHS')).toBe('Strengths');
    expect(sectionHeading('LANGUAGES AND INTERESTS')).toBe('Languages and Interests');
    const r = normalizeResume({ customSections: [{ title: 'Additional Information', content: 'Strengths: Quick learner, Team player' }] });
    expect(r.customSections[0].title).toBe('Strengths');
    expect(r.customSections[0].content).toBe('Quick learner, Team player');
  });
});

describe('score improvement plan', () => {
  it('measures each step by re-scoring and never lowers the score', () => {
    const resume = normalizeResume(parseResumeText(PASTED_RESUME));
    resume.experience[0].startDate = '';
    resume.experience[0].bulletPoints.push('Responsible for weekly reports.');
    const jd = analyzeJobDescriptionDeterministic(JD_TEXT);
    const ats = scoreResume(resume, jd, { original: resume });
    const plan = improvementPlan(resume, jd, ats, { original: resume })!;
    expect(plan.current).toBe(ats.total);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.every((s) => s.gain >= 0)).toBe(true);
    expect(plan.potential).toBeGreaterThanOrEqual(plan.safePotential);
    expect(plan.safePotential).toBeGreaterThanOrEqual(plan.current);
    expect(plan.steps.map((s) => s.id)).toEqual(expect.arrayContaining(['dates', 'action-verbs']));
    // gap skills are only ever offered, never applied
    expect(plan.steps.find((s) => s.id === 'confirm-gaps')?.kind ?? 'confirm').toBe('confirm');
    expect(planToText(plan)).toMatch(/could take it to about/);
  });
});

describe('page layout', () => {
  it('moves a section that would split to the next page and evens out the gap', async () => {
    const { planPages } = await import('../../shared/pagination.js');
    const plan = planPages(100, [{ height: 300, topGap: 10 }, { height: 350, topGap: 10 }, { height: 200, topGap: 10 }], 800);
    expect(plan.pages).toBe(2);
    expect([...plan.breaks]).toEqual([2]); // 100+300+350 = 750 leaves 50 < 200
    expect(plan.leftover).toBeCloseTo(50);
    expect((plan.gaps.get(0) || 0) + (plan.gaps.get(1) || 0)).toBeCloseTo(32); // capped at 16 each
  });

  it('lets a section taller than a page flow instead of leaving a blank page', async () => {
    const { planPages } = await import('../../shared/pagination.js');
    const plan = planPages(100, [{ height: 1200, topGap: 10 }], 800);
    expect(plan.breaks.size).toBe(0);
    expect(plan.pages).toBe(2);
  });

  it('recognises "make it one page" requests', async () => {
    const { pageFitTarget } = await import('../src/services/resumeService.js');
    expect(pageFitTarget('I need it in one page')).toBe(1);
    expect(pageFitTarget('make my resume fit on 1 page please')).toBe(1);
    expect(pageFitTarget('reduce this resume to two pages')).toBe(2);
    expect(pageFitTarget('add a projects section')).toBeNull();
  });
});

describe('job description from a link', () => {
  it('recognises job links and the intent', async () => {
    const { jobLinkRequest } = await import('../src/services/resumeService.js');
    expect(jobLinkRequest('https://www.naukri.com/job-listings-data-engineer-123')).toEqual({ url: 'https://www.naukri.com/job-listings-data-engineer-123', analyseOnly: false });
    expect(jobLinkRequest('tailor my resume for https://jobs.example.com/de-1')?.analyseOnly).toBe(false);
    expect(jobLinkRequest('check how well I match https://jobs.example.com/de-1')?.analyseOnly).toBe(true);
    expect(jobLinkRequest('update my portfolio link to https://me.github.io')).toBeNull();
    expect(jobLinkRequest('no links here')).toBeNull();
  });

  it('refuses private and local addresses', async () => {
    const { fetchJobPosting } = await import('../src/services/fetchJob.js');
    await expect(fetchJobPosting('http://localhost:8787/api/health')).rejects.toThrow(/private|standard web ports/);
    await expect(fetchJobPosting('http://localhost/admin')).rejects.toThrow(/private/);
    await expect(fetchJobPosting('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/private/);
    await expect(fetchJobPosting('http://10.0.0.5/')).rejects.toThrow(/private/);
    await expect(fetchJobPosting('ftp://example.com/job')).rejects.toThrow(/http/);
  });

  it('reads schema.org JobPosting data embedded in job pages', async () => {
    const { jobPostingFromJsonLd } = await import('../src/services/fetchJob.js');
    const html = `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Data Engineer', hiringOrganization: { name: 'Acme' }, description: '<p>Build <b>web scraping</b> tools with Selenium and Scrapy.</p><ul><li>Python, Pandas, NumPy</li><li>MySQL and MongoDB</li></ul>' })}</script></html>`;
    const job = jobPostingFromJsonLd(html)!;
    expect(job.title).toBe('Data Engineer');
    expect(job.company).toBe('Acme');
    expect(job.text).toMatch(/Selenium and Scrapy/);
    expect(job.text).toMatch(/- Python, Pandas, NumPy/);
  });
});
