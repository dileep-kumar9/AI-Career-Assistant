import type { Education, Experience, Project, ResumeData, SkillCategory } from './resumeTypes.js';
import { blankResume, newId, skillList } from './normalize.js';
import { DEGREE_PATTERNS, LEXICON } from './lexicon.js';
import { extractLexiconTerms } from './match.js';

/** Drops an unmatched leading "(" or trailing ")" left over from splitting. */
function balanceParens(s: string): string {
  const open = (s.match(/\(/g) || []).length;
  const close = (s.match(/\)/g) || []).length;
  if (close > open) return s.replace(/\)+$/, '').trim();
  if (open > close && !/\)/.test(s)) return /^\(/.test(s) ? s.slice(1).trim() : `${s})`;
  return s;
}

/** A header part is a technology list when most comma-separated items are known technologies. */
function looksLikeTech(part: string): boolean {
  const items = part.split(/,\s*/).filter(Boolean);
  if (!items.length) return false;
  const known = items.filter((i) => extractLexiconTerms(i, LEXICON).length > 0).length;
  return known / items.length >= 0.5;
}

/**
 * Deterministic resume text parser. It never invents content: anything it
 * cannot place confidently goes into an "Additional Information" custom
 * section so the user can correct it on the review screen.
 */

type SectionKey = 'summary' | 'skills' | 'experience' | 'projects' | 'education' | 'certifications' | 'achievements' | 'other';

const SECTION_PATTERNS: Array<[SectionKey, RegExp]> = [
  ['summary', /^(professional summary|summary|career summary|profile|professional profile|about me|objective|career objective|summary of qualifications)$/i],
  ['skills', /^(skills|technical skills|core skills|key skills|core competencies|competencies|technologies|tech stack|tools( and| &) technologies|areas of expertise|expertise|skills( and| &) tools)$/i],
  ['experience', /^(experience|work experience|professional experience|employment( history)?|work history|career history|internship experience|internships?|relevant experience)$/i],
  ['projects', /^(projects|key projects|personal projects|academic projects|project experience|selected projects)$/i],
  ['education', /^(education|academic background|education( and| &) training|academics|qualifications)$/i],
  ['certifications', /^(certifications?|certificates|licenses( and| &) certifications|certifications( and| &) training|training( and| &) certifications|courses)$/i],
  ['achievements', /^(achievements|accomplishments|awards|honou?rs( and| &) awards|awards( and| &) achievements|key achievements)$/i],
  ['other', /^(languages|interests|hobbies|strengths|soft skills|key strengths|personal strengths|volunteer(ing)?( experience)?|publications|activities|extracurricular activities|references|additional information|personal details)$/i],
];

const BULLET_RE = /^\s*([•·▪◦‣●○■□➢➤►\-–*]|\d+[.)])\s*/;
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_TOKEN = `(?:\\d{4}-\\d{2}|${MONTH}\\.?\\s*,?\\s*\\d{4}|\\d{1,2}[/.-]\\d{4}|\\d{4})`;
const RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|until)\\s*(${DATE_TOKEN}|present|current|now|ongoing|till date|date)`, 'i');
const SINGLE_DATE_RE = new RegExp(`\\b(${DATE_TOKEN})\\b`, 'i');

function headingOf(line: string): SectionKey | null {
  const clean = line.replace(/[:|]+$/, '').replace(/^[#*\s]+|[#*\s]+$/g, '').trim();
  if (!clean || clean.length > 45) return null;
  for (const [key, re] of SECTION_PATTERNS) if (re.test(clean)) return key;
  return null;
}

export function toIsoMonth(raw: string): string {
  const v = raw.trim().toLowerCase().replace(/\./g, '');
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let m = v.match(new RegExp(`^(${MONTH})\\s*,?\\s*(\\d{4})$`, 'i'));
  if (m) return `${m[2]}-${String(months.indexOf(m[1].slice(0, 3)) + 1).padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = v.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = v.match(/^(\d{4})$/);
  if (m) return m[1];
  return '';
}

function parseRange(line: string): { start: string; end: string; current: boolean; rest: string } | null {
  const m = line.match(RANGE_RE);
  if (m) {
    const current = /present|current|now|ongoing|till date|date/i.test(m[2]);
    return { start: toIsoMonth(m[1]), end: current ? '' : toIsoMonth(m[2]), current, rest: (line.slice(0, m.index) + ' ' + line.slice((m.index || 0) + m[0].length)).trim() };
  }
  return null;
}

const splitParts = (s: string) =>
  s
    .split(/\s*[|•·]\s*|\s{3,}|\t+|\s+[–—-]\s+/)
    .map((x) => balanceParens(x.replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim()))
    .filter(Boolean);

const LOCATION_RE = /^(remote|hybrid|on-?site|[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+)$/;

function assignHeader(entry: Experience, parts: string[]) {
  const loc = parts.find((p) => LOCATION_RE.test(p));
  const rest = parts.filter((p) => p !== loc);
  if (loc && !entry.location) entry.location = loc;
  for (const p of rest) {
    const at = p.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (at && !entry.jobTitle && !entry.company) {
      entry.jobTitle = at[1].trim();
      entry.company = at[2].trim();
    } else if (!entry.jobTitle) entry.jobTitle = p;
    else if (!entry.company) entry.company = p;
    else if (!entry.location) entry.location = p;
  }
}

export function parseResumeText(input: string): ResumeData {
  const data = blankResume();
  const text = String(input || '').replace(/\r/g, '').replace(/\u00a0/g, ' ');
  const lines = text.split('\n').map((l) => l.replace(/\s+$/g, '')).filter((l) => l.trim());

  // Split into blocks by heading.
  const blocks: Array<{ key: SectionKey; title: string; lines: string[] }> = [{ key: 'other', title: '__header__', lines: [] }];
  for (const line of lines) {
    const key = headingOf(line.trim());
    if (key) blocks.push({ key, title: line.trim().replace(/[:]+$/, ''), lines: [] });
    else blocks[blocks.length - 1].lines.push(line.trim());
  }

  parseHeader(blocks[0].lines, data, text);

  for (const block of blocks.slice(1)) {
    switch (block.key) {
      case 'summary':
        data.summary = [data.summary, block.lines.map((l) => l.replace(BULLET_RE, '')).join(' ')].filter(Boolean).join(' ').trim();
        break;
      case 'skills':
        parseSkills(block.lines, data);
        break;
      case 'experience':
        data.experience.push(...parseExperience(block.lines));
        break;
      case 'projects':
        data.projects.push(...parseProjects(block.lines));
        break;
      case 'education':
        data.education.push(...parseEducation(block.lines));
        break;
      case 'certifications':
        for (const l of block.lines) {
          const parts = splitParts(l.replace(BULLET_RE, ''));
          if (!parts.length) continue;
          const dateIdx = parts.findIndex((p) => SINGLE_DATE_RE.test(p) && p.length < 20);
          const date = dateIdx >= 0 ? toIsoMonth(parts[dateIdx].match(SINGLE_DATE_RE)![1]) || parts[dateIdx] : '';
          const others = parts.filter((_, i) => i !== dateIdx);
          data.certifications!.push({ id: newId('cert'), name: others[0] || parts[0], issuer: others.slice(1).join(', '), date });
        }
        break;
      case 'achievements':
        for (const l of joinContinuations(block.lines)) data.achievements!.push({ id: newId('ach'), text: l });
        break;
      default:
        if (block.lines.length) {
          const bullets = block.lines.some((l) => BULLET_RE.test(l));
          data.customSections.push({
            id: newId('custom'),
            title: block.title.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase()),
            content: joinContinuations(block.lines).join('\n'),
            type: bullets ? 'bullets' : 'paragraph',
            visible: true,
            order: data.customSections.length,
          });
        }
    }
  }
  return data;
}

/** Degree / graduation-status lines such as "B.Tech — Information Technology | Fresher". */
export function isStatusLine(line: string): boolean {
  return /\b(fresher|graduate|undergraduate|student|seeking|looking for|final[- ]year|pursuing)\b/i.test(line) || DEGREE_PATTERNS.some((d) => d.re.test(line));
}

/**
 * Portfolio / personal website. Accepts full URLs, labelled bare domains
 * ("Portfolio: name.github.io") and common hosting domains without a scheme.
 */
export function findWebsite(full: string, email = ''): string {
  const skip = (u: string) => /linkedin\.com|github\.com\/?$|github\.com\/[^/\s]+\/?$/i.test(u) || (email && email.toLowerCase().includes(u.toLowerCase().replace(/^https?:\/\//, '')));
  const clean = (u: string) => u.replace(/[).,;|]+$/, '');
  const labelled = full.match(/\b(?:portfolio|website|web\s*site|personal\s*site|blog|site)\s*[:\-–]\s*((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s|,]*)?)/i);
  if (labelled && !skip(labelled[1])) return clean(labelled[1]);
  const withScheme = (full.match(/https?:\/\/[^\s|,)]+/gi) || []).map(clean).find((u) => !skip(u));
  if (withScheme) return withScheme;
  const hosted = full.match(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:github\.io|vercel\.app|netlify\.app|pages\.dev|web\.app|firebaseapp\.com|herokuapp\.com|wixsite\.com|carrd\.co|notion\.site)(?:\/[^\s|,]*)?/i);
  if (hosted) return clean(hosted[0]);
  const www = full.match(/\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s|,]*)?/i);
  return www && !skip(www[0]) ? clean(www[0]) : '';
}

function parseHeader(lines: string[], data: ResumeData, full: string) {
  const email = full.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const phone = full.match(/(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d[\d\s-]{7,}\d/)?.[0]?.trim() || '';
  const linkedin = full.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?/i)?.[0] || '';
  const github = full.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i)?.[0] || '';
  const website = findWebsite(full, email);
  data.personalInfo.email = email;
  data.personalInfo.phone = phone;
  data.personalInfo.linkedin = linkedin;
  data.personalInfo.github = github;
  data.personalInfo.website = website;

  const isContact = (l: string) => /@|linkedin|github|portfolio|website|https?:|www\.|\.(io|app|dev)\b|\+?\d[\d\s()-]{7,}/i.test(l);
  const name = lines.slice(0, 4).find((l) => /^[A-Za-z][A-Za-z0-9 .'-]{1,60}$/.test(l) && /[a-z]{2}|[A-Z]{2}/.test(l) && l.split(/\s+/).length <= 5 && !/resume|curriculum|vitae/i.test(l));
  data.personalInfo.fullName = name ? name.replace(/\s+/g, ' ').trim() : '';

  const leftovers: string[] = [];
  for (const l of lines) {
    if (l === name) continue;
    if (isContact(l)) {
      for (const part of l.split(/\s*[|•·]\s*/)) {
        const loc = part.trim();
        if (!data.personalInfo.location && /^[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+$/.test(loc) && !/@/.test(loc)) data.personalInfo.location = loc;
      }
      continue;
    }
    if (!data.personalInfo.location && /^[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+$/.test(l)) {
      data.personalInfo.location = l;
      continue;
    }
    leftovers.push(l);
  }
  // A degree / graduation-status line ("B.Tech — IT | Fresher") is not a professional headline.
  const headline = leftovers.find((l) => l.length <= 80 && !/[.]$/.test(l) && !isStatusLine(l));
  if (headline) data.personalInfo.jobTitle = headline;
  const rest = leftovers.filter((l) => l !== headline);
  // Long prose above the first heading is usually an untitled summary.
  if (rest.join(' ').length > 120) data.summary = rest.join(' ');
}

function joinContinuations(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const isBullet = BULLET_RE.test(raw);
    const line = raw.replace(BULLET_RE, '').trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    if (!isBullet && prev && /^[a-z(]/.test(line) && !/[.!?:]$/.test(prev)) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

function parseSkills(lines: string[], data: ResumeData) {
  const categorized: SkillCategory[] = [...data.skills.categorized];
  const simple: string[] = [...data.skills.simple];
  for (const raw of lines) {
    const line = raw.replace(BULLET_RE, '').trim();
    const colon = line.indexOf(':');
    if (colon > 0 && colon < 45) {
      const skills = skillList(line.slice(colon + 1).split(/[,;|•·]/));
      if (skills.length) categorized.push({ id: newId('skills'), name: line.slice(0, colon).trim(), skills });
    } else simple.push(...skillList(line.split(/[,;|•·]|\s{2,}/)));
  }
  data.skills = categorized.length
    ? { mode: 'categorized', simple: [], categorized: simple.length ? [...categorized, { id: newId('skills'), name: 'Other', skills: skillList(simple) }] : categorized }
    : { mode: 'simple', simple: skillList(simple), categorized: [] };
}

function parseExperience(lines: string[]): Experience[] {
  const out: Experience[] = [];
  let cur: Experience | null = null;
  let pendingHeader: string[] = [];
  const blank = (): Experience => ({ id: newId('exp'), jobTitle: '', company: '', location: '', startDate: '', endDate: '', current: false, description: '', bulletPoints: [] });
  const flush = () => {
    if (cur && (cur.jobTitle || cur.company || cur.bulletPoints.length)) out.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    const isBullet = BULLET_RE.test(raw);
    const line = raw.replace(BULLET_RE, '').trim();
    const range = !isBullet ? parseRange(line) : null;
    if (range) {
      const startsNew = !cur || cur.bulletPoints.length > 0 || !!cur.startDate;
      if (startsNew) {
        flush();
        cur = blank();
      }
      const c = cur!;
      c.startDate = range.start;
      c.endDate = range.end;
      c.current = range.current;
      assignHeader(c, [...pendingHeader.flatMap(splitParts), ...splitParts(range.rest)]);
      pendingHeader = [];
      continue;
    }
    if (isBullet) {
      if (!cur) {
        cur = blank();
        assignHeader(cur, pendingHeader.flatMap(splitParts));
        pendingHeader = [];
      }
      cur.bulletPoints.push(line);
      continue;
    }
    // Plain line: a continuation of the previous bullet, a new header, or description.
    const lastBullet = cur?.bulletPoints[cur.bulletPoints.length - 1];
    if (cur && lastBullet && /^[a-z(]/.test(line) && !/[.!?]$/.test(lastBullet)) {
      cur.bulletPoints[cur.bulletPoints.length - 1] = `${lastBullet} ${line}`;
    } else if (cur && !cur.bulletPoints.length && cur.startDate && line.length > 90) {
      cur.description = [cur.description, line].filter(Boolean).join(' ');
    } else if (cur && cur.startDate && !cur.bulletPoints.length && line.length <= 90 && (!cur.company || !cur.jobTitle || !cur.location)) {
      assignHeader(cur, splitParts(line));
    } else if (cur && cur.bulletPoints.length && line.length > 90) {
      cur.bulletPoints.push(line);
    } else {
      if (cur && (cur.bulletPoints.length || cur.startDate)) flush();
      pendingHeader.push(line);
    }
  }
  if (pendingHeader.length && cur) assignHeader(cur, pendingHeader.flatMap(splitParts));
  flush();
  return out;
}

function parseProjects(lines: string[]): Project[] {
  const out: Project[] = [];
  let cur: Project | null = null;
  const flush = () => {
    if (cur && cur.title) out.push({ ...cur, description: cur.description.trim() });
    cur = null;
  };
  for (const raw of lines) {
    const isBullet = BULLET_RE.test(raw);
    const line = raw.replace(BULLET_RE, '').trim();
    const tech = line.match(/^(?:tech(?:nologies)?|tech stack|stack|tools|built with)\s*[:-]\s*(.+)$/i);
    if (tech && cur) {
      cur.technologies = skillList([...cur.technologies, ...tech[1].split(/[,;|]/)]);
      continue;
    }
    const url = line.match(/https?:\/\/\S+/)?.[0];
    const isHeader = !isBullet && line.length <= 110 && (!cur || cur.description.length > 0 || /\|/.test(line)) && !/^[a-z]/.test(line);
    if (isHeader) {
      flush();
      const range = parseRange(line);
      const parts = splitParts(range ? range.rest : line);
      // "Title — Subtitle | Python, SQL": known technologies become the tech list, anything else stays in the title.
      const extra = parts.slice(1).filter((p) => !/https?:/.test(p));
      const techParts = extra.filter(looksLikeTech);
      const subtitle = extra.filter((p) => !looksLikeTech(p));
      cur = { id: newId('proj'), title: [parts[0] || line, ...subtitle].join(' — '), description: '', technologies: skillList(techParts.flatMap((p) => p.split(/,\s*/))), liveUrl: '', githubUrl: '', startDate: range?.start || '', endDate: range?.current ? '' : range?.end || '' };
      if (url && /github\.com/i.test(url)) cur.githubUrl = url;
      else if (url) cur.liveUrl = url;
      continue;
    }
    if (!cur) cur = { id: newId('proj'), title: line.slice(0, 80), description: '', technologies: [], liveUrl: '', githubUrl: '', startDate: '', endDate: '' };
    if (url && !cur.githubUrl && /github\.com/i.test(url)) cur.githubUrl = url;
    cur.description = cur.description ? `${cur.description}${isBullet ? '\n' : ' '}${line}` : line;
  }
  flush();
  return out;
}

function parseEducation(lines: string[]): Education[] {
  const out: Education[] = [];
  let cur: Education | null = null;
  const INSTITUTION = /\b(university|college|institute|school|academy|polytechnic|iit|nit|vidyalaya)\b/i;
  const flush = () => {
    if (cur && (cur.degree || cur.institution)) out.push(cur);
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.replace(BULLET_RE, '').trim();
    const isDegree = DEGREE_PATTERNS.some((d) => d.re.test(line)) || /\b(degree|major|10th|12th|ssc|hsc|intermediate|secondary)\b/i.test(line);
    const parts = splitParts(line);
    const gpa = line.match(/\b(?:c?gpa|cpi|percentage|grade)\s*[:-]?\s*([0-9.]+\s*(?:\/\s*[0-9.]+|%)?)/i)?.[1]?.trim() || '';
    const years = line.match(/\b((?:19|20)\d{2})\s*(?:-|–|to)\s*((?:19|20)\d{2}|present)\b/i);
    const year = years ? (/present/i.test(years[2]) ? years[2] : years[2]) : line.match(/\b((?:19|20)\d{2})\b/)?.[1] || '';
    if (isDegree && (!cur || cur.degree)) {
      flush();
      cur = { id: newId('edu'), degree: '', institution: '', location: '', graduationYear: '', gpa: '', honors: '' };
    }
    if (!cur) cur = { id: newId('edu'), degree: '', institution: '', location: '', graduationYear: '', gpa: '', honors: '' };
    for (const p of parts) {
      if (/\b(?:c?gpa|cpi|percentage|grade)\b/i.test(p) || /^\d{4}(\s*[-–]\s*(\d{4}|present))?$/i.test(p)) continue;
      if (!cur.degree && (DEGREE_PATTERNS.some((d) => d.re.test(p)) || /\b(degree|10th|12th|ssc|hsc|intermediate)\b/i.test(p))) cur.degree = p;
      else if (!cur.institution && (INSTITUTION.test(p) || cur.degree)) cur.institution = p.replace(new RegExp(`\\b${year}\\b`), '').trim();
      else if (!cur.location && LOCATION_RE.test(p)) cur.location = p;
      else if (cur.degree && cur.institution) cur.honors = [cur.honors, p].filter(Boolean).join('; ');
    }
    if (gpa && !cur.gpa) cur.gpa = gpa;
    if (year && !cur.graduationYear) cur.graduationYear = year;
  }
  flush();
  return out;
}
