/**
 * Experience requirements of a job, read from its description (or a portal
 * card such as Naukri's "5-7 Yrs"), and whether they fit the candidate's range.
 *
 * Rule: a job fits when its minimum required years ≤ your maximum.
 *   fresher (0-0) → jobs asking 0 years / freshers / entry level (or not saying)
 *   2-3           → jobs asking 0, 1, 2 or 3 years ("5-7 years" is skipped)
 *   2             → jobs asking 0, 1 or 2 years
 * "Preferred / nice to have / a plus" lines are ignored; when several required
 * lines mention years, the highest minimum counts (a "7+ years Python" line
 * makes the job senior even if another line says "2 years SQL").
 */

export interface ExperienceRequirement {
  /** Minimum years required (0 = freshers / entry level). */
  min: number;
  /** Upper end when the job gives a range ("2-4 years" → 4). */
  max: number | null;
  /** The job explicitly welcomes freshers / entry level / 0 years. */
  fresherOk: boolean;
  /** The sentence the numbers came from. */
  evidence: string;
}

export interface ExperienceRange {
  min: number;
  max: number;
}

const YR = '(?:years?|yrs?)';
const RANGE = new RegExp(`(\\d{1,2})\\s*(?:-|–|—|to)\\s*(\\d{1,2})\\s*\\+?\\s*${YR}`, 'i');
const PLUS = new RegExp(`(\\d{1,2})\\s*\\+?\\s*(?:\\+\\s*)?${YR}`, 'i');
const MINIMUM = /\b(?:minimum|min\.?|at least|atleast)\s*(?:of\s*)?(\d{1,2})\b/i;
const EXPERIENCE_CONTEXT = /experience|exp\b|background|working|professional|industry|hands[- ]on|track record/i;
const OPTIONAL_CONTEXT = /preferred|nice[- ]to[- ]have|\bbonus\b|a plus|is a plus|desirable|advantage|ideally/i;
const FRESHER = /\bfreshers?\b|\bentry[- ]level\b|\bno (?:prior )?experience (?:is )?(?:required|needed)\b|\b0\s*(?:-|–|to)\s*\d{1,2}\s*(?:years?|yrs?)\b|\bgraduates? (?:are )?(?:welcome|can apply|encouraged)\b|\b(?:recent|new) graduates?\b/i;

export function experienceRequirement(text: string): ExperienceRequirement | null {
  if (!text) return null;
  const fresherOk = FRESHER.test(text);
  const lines = text
    .split(/\n|(?<=[.;])\s+(?=[A-Z•\-*])/)
    .map((l) => l.trim())
    .filter(Boolean);
  const shortCard = text.length <= 40; // e.g. a Naukri card "5-7 Yrs"
  let best: ExperienceRequirement | null = null;
  for (const line of lines) {
    if (!shortCard && !EXPERIENCE_CONTEXT.test(line)) continue;
    if (OPTIONAL_CONTEXT.test(line)) continue;
    let min: number | null = null;
    let max: number | null = null;
    const r = line.match(RANGE);
    if (r) {
      min = Number(r[1]);
      max = Number(r[2]);
      if (max < min) [min, max] = [max, min];
    } else {
      const p = line.match(PLUS) || line.match(MINIMUM);
      if (p) min = Number(p[1]);
    }
    if (min === null || min > 40) continue;
    if (!best || min > best.min) best = { min, max, fresherOk, evidence: line.slice(0, 200) };
  }
  if (!best && fresherOk) return { min: 0, max: null, fresherOk, evidence: (text.match(FRESHER) || [''])[0] };
  return best;
}

/** Does the job fit the candidate's experience range? Unknown requirements fit. */
export function fitsExperience(req: ExperienceRequirement | null, range: ExperienceRange | null): boolean {
  if (!range || !req) return true;
  if (range.max === 0) return req.min === 0 || (req.fresherOk && req.min <= 1);
  return req.min <= range.max;
}

export function describeRange(r: ExperienceRange | null): string {
  if (!r) return 'any experience';
  if (r.max === 0) return 'fresher (0 years)';
  if (r.min === r.max) return `${r.max} year${r.max === 1 ? '' : 's'}`;
  return `${r.min}-${r.max} years`;
}

/** LinkedIn experience-level filter (f_E) for a range: 1 internship, 2 entry, 3 associate, 4 mid-senior. */
export function linkedinLevels(r: ExperienceRange | null): string {
  if (!r) return '';
  if (r.max === 0) return '1,2';
  if (r.max <= 2) return '2,3';
  if (r.max <= 5) return '3,4';
  return '4';
}
