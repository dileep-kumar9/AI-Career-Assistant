import { CERTIFICATIONS, DEGREE_PATTERNS, LEXICON } from './lexicon.js';
import { STOPWORDS, containsForm, extractLexiconTerms, findKeyword, uniqueKeywords } from './match.js';

export interface JDAnalysis {
  jobTitle: string;
  company: string;
  requiredSkills: string[];
  preferredSkills: string[];
  tools: string[];
  experienceRequirements: string[];
  minYears: number | null;
  education: string[];
  /** 0 = none stated, 1 = associate/diploma, 2 = bachelor, 3 = master, 4 = doctorate. */
  educationLevel: number;
  certifications: string[];
  responsibilities: string[];
  industryKeywords: string[];
  atsKeywords: string[];
  source: 'deterministic' | 'ai+deterministic';
  userEdited?: boolean;
}

type Zone = 'intro' | 'required' | 'preferred' | 'responsibilities' | 'benefits' | 'about';

const HEADINGS: Array<[Zone, RegExp]> = [
  ['preferred', /^(preferred|nice[- ]to[- ]have|bonus|desired|desirable|good to have|pluses|preferred (qualifications|skills|experience))\b/i],
  ['required', /^(requirements?|required|qualifications?|minimum qualifications|basic qualifications|must[- ]haves?|what you('ll)? (bring|need)|who you are|you have|skills( and| &) (experience|qualifications)|required (skills|qualifications|experience)|key skills|technical skills|experience)\b/i],
  ['responsibilities', /^(responsibilities|key responsibilities|roles?\s*(&|and)\s*responsibilities|job responsibilities|what you('ll)? do|duties|the role|role overview|day[- ]to[- ]day|your impact|in this role|about the role)\b/i],
  ['benefits', /^(benefits|perks|what we offer|compensation|salary|why join)\b/i],
  ['about', /^(about (us|the company|the team)|who we are|our company)\b/i],
];

const PREFERRED_CUE = /\b(preferred|nice to have|bonus|a plus|is a plus|desirable|advantageous|ideally|good to have)\b/i;
const REQUIRED_CUE = /\b(required|must|minimum|proficien|expert|strong|solid|hands[- ]on|experience (with|in)|knowledge of|familiarity with|ability to)\b/i;

function isHeading(line: string): Zone | null {
  const clean = line.replace(/^[#*\s-]+/, '').replace(/[:*]+\s*$/, '').trim();
  if (clean.length > 60) return null;
  for (const [zone, re] of HEADINGS) if (re.test(clean)) return zone;
  return null;
}

function lineIsBullet(line: string) {
  return /^\s*([-*•·▪◦‣]|\d+[.)])\s+/.test(line);
}

function stripBullet(line: string) {
  return line.replace(/^\s*([-*•·▪◦‣]|\d+[.)])\s+/, '').trim();
}

/**
 * Job boards often paste keyword chips glued together ("DockerKubernetesJenkinsTerraform").
 * Returns the line with a split copy appended so both forms can match.
 */
export function unglue(line: string): string {
  if (!/[a-z)][A-Z]|[A-Z]{2}[a-z]/.test(line)) return line;
  // Protect genuine camel-case names (JavaScript, PostgreSQL, GitHub, PowerShell…).
  const saved: string[] = [];
  let s = line;
  for (const term of CAMEL_TERMS) {
    s = s.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), () => `, §${saved.push(term) - 1}§, `);
  }
  // Nothing glued once real names are protected ("Uses JavaScript daily") → leave the line alone.
  if (!/[a-z)][A-Z]|[A-Z]{2}[a-z]/.test(s)) return line;
  s = s
    .replace(/([a-z)])(?=[A-Z])/g, '$1, ') // "ExcelPython" → "Excel, Python"; "Tables)MS" → "Tables), MS"
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1, ') // "SQLExcel" → "SQL, Excel"; "BIPivot" → "BI, Pivot"
    .replace(/§(\d+)§/g, (_, i) => saved[Number(i)])
    .replace(/(\s*,\s*)+/g, ', ')
    .replace(/^,\s*|,\s*$/g, '');
  return s === line ? line : `${line} | ${s}`;
}

/** Lexicon names containing internal capitals, longest first, so they survive unglue(). */
const CAMEL_TERMS = [...new Set([...LEXICON, ...CERTIFICATIONS].flatMap((t) => [t.label, ...(t.aliases || [])]).filter((f) => /[a-z][A-Z]|[A-Z]{2,}[a-z]/.test(f) && !/\s/.test(f)))].sort((a, b) => b.length - a.length);

/** Words that carry no hiring signal on their own (job-board boilerplate, generic verbs). */
const GENERIC_WORD = /^(will|including|provide|ensure|support|help|opportunity|environment|business|customers?|benefits|salary|apply|location|remote|hybrid|time|full|part|equal|employer|join|looking|high|level|best|across|within|related|relevant|responsible|responsibilities|qualifications|preferred|degree|field|computer|science|information|technology|data|implement|implementing|maintain|maintaining|design|designing|develop|development|software|consulting|services?|manage|managing|deploy|deploying|monitor|configure|create|participate|collaborate|optimi[sz]e|automate|engineering|engineer|department|industry|type|category|permanent|position|role|roles|employment|experience|skills?|key|highlighted|keyskills|graduate|postgraduate|any|ug|pg|teams?|tools?|including|solutions?|initiatives|issues|across|application|applications)$/;

/** True when every word of a phrase is generic (e.g. "IT Services", "Implement"). */
export function isGenericPhrase(phrase: string): boolean {
  const words = phrase.toLowerCase().split(/[\s&/,-]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => GENERIC_WORD.test(w) || STOPWORDS.has(w) || w.length <= 2);
}

export function analyzeJobDescriptionDeterministic(jdRaw: string): JDAnalysis {
  const jd = String(jdRaw || '').replace(/\r/g, '');
  const lines = jd.split('\n').map((l) => l.trim()).filter(Boolean);

  // Zone every line so a skill's context (required vs preferred) is known.
  const zoned: Array<{ line: string; zone: Zone }> = [];
  let zone: Zone = 'intro';
  for (const raw of lines) {
    const line = unglue(raw);
    const heading = isHeading(raw);
    const inlineValue = raw.split(':').slice(1).join(':').trim();
    // Only a standalone heading starts a new zone. "Experience: 2 to 5 years"
    // is a labelled value, not the start of a requirements section.
    if (heading && !lineIsBullet(raw) && !inlineValue) {
      zone = heading;
      continue;
    }
    zoned.push({ line, zone });
  }
  const hasRequiredZone = zoned.some((z) => z.zone === 'required');

  const required: string[] = [];
  const preferred: string[] = [];
  const tools: string[] = [];
  const mentioned: string[] = [];

  for (const term of LEXICON) {
    const forms = [term.label, ...(term.aliases || [])];
    const hits = zoned.filter((z) => z.zone !== 'benefits' && z.zone !== 'about' && forms.some((f) => containsForm(z.line, f)));
    if (!hits.length) continue;
    mentioned.push(term.label);
    if (!['soft', 'practice'].includes(term.category)) tools.push(term.label);
    const isPreferred = hits.every((h) => h.zone === 'preferred' || PREFERRED_CUE.test(h.line));
    const technical = !['soft', 'practice'].includes(term.category);
    const isRequired =
      hits.some((h) => h.zone === 'required' && !PREFERRED_CUE.test(h.line)) ||
      hits.some((h) => REQUIRED_CUE.test(h.line) && !PREFERRED_CUE.test(h.line)) ||
      // Technologies named in the day-to-day responsibilities are effectively required.
      (technical && hits.some((h) => h.zone === 'responsibilities' && !PREFERRED_CUE.test(h.line)));
    if (isPreferred) preferred.push(term.label);
    else if (isRequired || !hasRequiredZone) {
      if (term.category !== 'soft') required.push(term.label);
    }
  }

  const certifications = extractLexiconTerms(jd, CERTIFICATIONS).map((c) => c.label);

  // Years of experience ("3+ years", "2-4 years", "minimum of 5 years").
  const years: number[] = [];
  const experienceRequirements: string[] = [];
  for (const { line } of zoned) {
    const m = line.match(/(\d{1,2})\s*(?:\+|plus)?\s*(?:[-–to]+\s*\d{1,2}\s*)?\s*(?:\+\s*)?years?/i);
    if (m && /experience|background|working|professional|industry|hands/i.test(line)) {
      years.push(Number(m[1]));
      experienceRequirements.push(stripBullet(line));
    }
  }

  const education: string[] = [];
  let educationLevel = 0;
  for (const { line } of zoned) {
    if (!/degree|bachelor|master|ph\.?d|diploma|b\.?tech|m\.?tech|b\.?s\.?c?|m\.?s\.?c?|graduate|education/i.test(line)) continue;
    // "UG: Any Graduate" / "PG: Any Postgraduate" means no specific degree is required.
    if (/\bany\s+(post)?graduate\b|\bany (degree|discipline|stream)\b|\bnot required\b/i.test(line)) continue;
    for (const d of DEGREE_PATTERNS) {
      if (d.re.test(line)) {
        const optional = /\bor equivalent (experience|work)|preferred|nice to have|a plus\b/i.test(line);
        if (!optional || d.level <= 2) educationLevel = Math.max(educationLevel, optional ? Math.min(d.level, 1) : d.level);
        education.push(stripBullet(line));
        break;
      }
    }
  }

  const responsibilities = zoned
    .filter((z) => z.zone === 'responsibilities' || (z.zone === 'intro' && lineIsBullet(z.line)))
    .map((z) => stripBullet(z.line))
    .filter((l) => l.length > 15 && l.length < 300)
    .slice(0, 15);

  const jobTitle = detectTitle(lines);
  const company = detectCompany(lines, jd);
  const industryKeywords = detectIndustryKeywords(jd, mentioned);

  const atsKeywords = uniqueKeywords([...required, ...preferred, ...certifications, ...mentioned.filter((m) => !preferred.includes(m)), ...industryKeywords.slice(0, 6)]).slice(0, 40);

  return {
    jobTitle,
    company,
    requiredSkills: uniqueKeywords(required),
    preferredSkills: uniqueKeywords(preferred.filter((p) => !required.includes(p))),
    tools: uniqueKeywords(tools),
    experienceRequirements: [...new Set(experienceRequirements)].slice(0, 6),
    minYears: years.length ? Math.min(...years) : null,
    education: [...new Set(education)].slice(0, 4),
    educationLevel,
    certifications: uniqueKeywords(certifications),
    responsibilities,
    industryKeywords,
    atsKeywords,
    source: 'deterministic',
  };
}

function detectTitle(lines: string[]): string {
  for (const line of lines.slice(0, 15)) {
    const m = line.match(/^(?:job\s*title|position|role|title)\s*[:：-]\s*(.+)$/i);
    if (m) return m[1].replace(/[*_#]/g, '').trim().slice(0, 120);
  }
  const hiring = lines.join(' ').match(/\b(?:hiring|looking for|seeking)\s+(?:an?|our next)\s+((?:[A-Z][\w/+#.-]*\s?){1,6})/);
  if (hiring) return hiring[1].trim();
  const first = lines[0]?.replace(/[*_#]/g, '').trim() || '';
  if (first && first.length <= 80 && !/[.!?]$/.test(first) && !isHeading(first)) return first;
  return '';
}

function detectCompany(lines: string[], jd: string): string {
  for (const line of lines.slice(0, 20)) {
    const m = line.match(/^(?:company|organization|employer)\s*[:：-]\s*(.+)$/i);
    if (m) return m[1].replace(/[*_#]/g, '').trim().slice(0, 120);
  }
  const about = jd.match(/\bAbout\s+((?!us\b|the\b|you\b|this\b|our\b)[A-Z][\w&.,'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/);
  if (about) return about[1].replace(/[,.]$/, '').trim();
  const at = jd.match(/\bat\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,3}),?\s+(?:we|you|our)\b/);
  return at ? at[1].trim() : '';
}

/** Frequent domain phrases that are not already lexicon skills. */
function detectIndustryKeywords(jd: string, known: string[]): string[] {
  const knownLower = new Set(known.map((k) => k.toLowerCase()));
  // Keep every token (so bigrams are only formed from words that are really adjacent).
  const tokens = jd.toLowerCase().match(/[a-z][a-z+#-]*|[^a-z\s]+/g) || [];
  const keep = (w: string) => /^[a-z][a-z+#-]{2,}$/.test(w) && !STOPWORDS.has(w);
  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    if (!keep(tokens[i])) continue;
    counts.set(tokens[i], (counts.get(tokens[i]) || 0) + 1);
    if (i + 1 < tokens.length && keep(tokens[i + 1])) {
      const bi = `${tokens[i]} ${tokens[i + 1]}`;
      counts.set(bi, (counts.get(bi) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([k, c]) => c >= (k.includes(' ') ? 2 : 3) && !knownLower.has(k) && !k.split(' ').some((w) => GENERIC_WORD.test(w)) && !known.some((kn) => findKeyword(k, kn)))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([k]) => k.replace(/\b\w/g, (ch) => ch.toUpperCase()))
    .filter((k, i, arr) => !arr.slice(0, i).some((prev) => prev.toLowerCase().includes(k.toLowerCase())))
    .slice(0, 10);
}

/**
 * Merges an AI-produced analysis with the deterministic one. AI keywords are
 * only accepted if they literally occur in the job description, so a model
 * cannot inject requirements that the employer never stated.
 */
export function mergeJDAnalysis(base: JDAnalysis, ai: Partial<JDAnalysis> | null | undefined, jd: string): JDAnalysis {
  if (!ai) return base;
  const jdText = jd.split('\n').map(unglue).join('\n');
  const grounded = (list: unknown) => (Array.isArray(list) ? list.map(String).filter((k) => k.trim() && findKeyword(jdText, k)) : []);
  const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 160) : fallback);
  // Drop AI phrases that merely wrap a keyword we already have ("CI/CD pipelines", "AWS services").
  const known = [...base.requiredSkills, ...base.preferredSkills, ...base.tools];
  const novel = (list: string[]) => list.filter((k) => !known.some((b) => b.toLowerCase() !== k.toLowerCase() && findKeyword(k, b)));
  const required = uniqueKeywords([...base.requiredSkills, ...novel(grounded(ai.requiredSkills))]);
  const preferred = uniqueKeywords([...base.preferredSkills, ...novel(grounded(ai.preferredSkills))]).filter((p) => !required.some((r) => r.toLowerCase() === p.toLowerCase()));
  const industry = uniqueKeywords([...grounded(ai.industryKeywords), ...base.industryKeywords]).filter((k) => !isGenericPhrase(k)).slice(0, 12);
  return {
    ...base,
    jobTitle: text(ai.jobTitle, base.jobTitle),
    company: base.company || (text(ai.company, '') && findKeyword(jd, String(ai.company)) ? text(ai.company, '') : ''),
    requiredSkills: required,
    preferredSkills: preferred,
    tools: uniqueKeywords([...base.tools, ...grounded(ai.tools)]),
    certifications: uniqueKeywords([...base.certifications, ...grounded(ai.certifications)]),
    responsibilities: base.responsibilities.length ? base.responsibilities : (Array.isArray(ai.responsibilities) ? ai.responsibilities.map(String).slice(0, 15) : []),
    experienceRequirements: base.experienceRequirements.length ? base.experienceRequirements : (Array.isArray(ai.experienceRequirements) ? ai.experienceRequirements.map(String).slice(0, 6) : []),
    industryKeywords: industry,
    atsKeywords: uniqueKeywords([...required, ...preferred, ...base.certifications, ...base.atsKeywords, ...novel(grounded(ai.atsKeywords)).filter((k) => !isGenericPhrase(k)), ...industry.slice(0, 6)]).slice(0, 45),
    source: 'ai+deterministic',
  };
}
