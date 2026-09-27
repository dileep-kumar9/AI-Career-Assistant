import { CERTIFICATIONS, LEXICON, type LexiconTerm } from './lexicon.js';

/**
 * Keyword matching primitives shared by the JD analyzer and ATS scorer.
 * Everything here is deterministic so scores are reproducible.
 */

const CASE_SENSITIVE = new Set(['Go', 'Node', 'Spring', 'Swift', 'Chef', 'Puppet', 'Spark', 'Excel', 'Exchange', 'Express', 'Helm', 'Rust', 'Scala', 'Ruby', 'Oracle', 'Apache', 'Angular', 'Vue', 'R', 'C']);
/** Single-letter languages only count in list context ("C, C++, Python"). */
const LIST_ONLY = new Set(['C', 'R', 'Go']);

export const STOPWORDS = new Set(
  (
    'a an and are as at be been being but by can could did do does for from had has have he her his how i if in into is it its may me more most must my no not of on or our ' +
    'shall she should so such than that the their them then there these they this those to too up us was we were what when where which while who will with would you your ' +
    'about across all also any based both each etc including other over per using via within without work working ability able strong excellent good knowledge understanding ' +
    'experience experienced years year plus preferred required requirement requirements skills skill team teams role position candidate candidates job company new well'
  ).split(/\s+/),
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patternCache = new Map<string, RegExp>();

function termPattern(alias: string): RegExp {
  const key = alias;
  const cached = patternCache.get(key);
  if (cached) return cached;
  const caseSensitive = CASE_SENSITIVE.has(alias) || (alias.length <= 3 && /^[A-Z0-9+#/&.-]+$/.test(alias));
  const body = escapeRe(alias).replace(/\\?\s+/g, '[\\s-]+');
  let src = `(?<![A-Za-z0-9+#])${body}(?![A-Za-z0-9+#]|\\.[A-Za-z])`;
  // List context: "Python, R, SQL", "Python or R is a plus", "C and C++".
  if (LIST_ONLY.has(alias)) src = `(?:^|[,/(:;|]\\s*|\\b(?:and|or)\\s+)${body}(?=\\s*(?:[,/);|]|\\b(?:and|or|is)\\b|$))`;
  const re = new RegExp(src, caseSensitive ? 'm' : 'im');
  patternCache.set(key, re);
  return re;
}

const lookup = new Map<string, LexiconTerm>();
for (const term of [...LEXICON, ...CERTIFICATIONS]) {
  lookup.set(term.label.toLowerCase(), term);
  for (const a of term.aliases || []) if (!lookup.has(a.toLowerCase())) lookup.set(a.toLowerCase(), term);
}

/** Returns the lexicon entry for a keyword or alias (case-insensitive), if any. */
export function lexiconEntry(keyword: string): LexiconTerm | undefined {
  return lookup.get(keyword.trim().toLowerCase());
}

/** Every surface form that should count as the same keyword. */
export function keywordForms(keyword: string): string[] {
  const entry = lexiconEntry(keyword);
  const forms = entry ? [entry.label, ...(entry.aliases || [])] : [keyword.trim()];
  if (!forms.includes(keyword.trim())) forms.push(keyword.trim());
  return [...new Set(forms.filter(Boolean))];
}

/** Canonical label (lexicon label when known) for de-duplication. */
export function canonicalKeyword(keyword: string): string {
  return lexiconEntry(keyword)?.label || keyword.trim();
}

export function containsForm(text: string, form: string): boolean {
  if (!form || !text) return false;
  return termPattern(form).test(text);
}

export function findKeyword(text: string, keyword: string): { index: number; form: string } | null {
  for (const form of keywordForms(keyword)) {
    const m = termPattern(form).exec(text);
    if (m) return { index: m.index, form };
  }
  return null;
}

export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9+#]/g, '');
  if (w.length <= 4) return w;
  for (const suffix of ['ations', 'ation', 'ators', 'ator', 'ating', 'ated', 'ates', 'ate', 'ments', 'ment', 'ings', 'ing', 'ers', 'er', 'ed', 'es', 's', 'ly']) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

export function significantTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9+#][a-z0-9+#.-]*/g) || [])
    .map((t) => t.replace(/[.-]+$/, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export type MatchStatus = 'matched' | 'partial' | 'missing';

/**
 * matched: an exact form (label or alias) is present.
 * partial: a related word form is present (automate ~ automation) or at least
 *          half of a multi-word keyword's significant words are present.
 */
export function matchKeyword(text: string, keyword: string, stems?: Set<string>): MatchStatus {
  if (findKeyword(text, keyword)) return 'matched';
  const tokens = significantTokens(canonicalKeyword(keyword));
  if (!tokens.length) return 'missing';
  const textStems = stems || stemSet(text);
  const hits = tokens.filter((t) => textStems.has(stem(t))).length;
  if (tokens.length === 1) return hits === 1 ? 'partial' : 'missing';
  return hits / tokens.length >= 0.5 ? 'partial' : 'missing';
}

export function stemSet(text: string): Set<string> {
  return new Set(significantTokens(text).map(stem));
}

/** Snippet of text around a match for evidence display. */
export function snippetAround(text: string, index: number, radius = 70): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

/** All lexicon terms (skills + certifications) present in the text. */
export function extractLexiconTerms(text: string, source: LexiconTerm[] = LEXICON): LexiconTerm[] {
  return source.filter((term) => [term.label, ...(term.aliases || [])].some((f) => containsForm(text, f)));
}

export function uniqueKeywords(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const k = String(raw || '').trim();
    if (!k) continue;
    const c = canonicalKeyword(k);
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
