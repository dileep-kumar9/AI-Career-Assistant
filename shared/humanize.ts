/**
 * Plain-language clean-up for AI-written resume text. Recruiters spot
 * machine-written resumes by their vocabulary ("leveraged", "seamless",
 * "spearheaded", "Seeking to…", em-dashes everywhere), so rewrites are passed
 * through this deterministic filter. It only swaps or drops filler words — it
 * never adds claims.
 */

const SWAPS: Array<[RegExp, string]> = [
  [/\butilize\b/gi, "use"],
  [/\butilizes\b/gi, "uses"],
  [/\butilized\b/gi, "used"],
  [/\butilizing\b/gi, "using"],
  [/\butilization\b/gi, "use"],
  [/\butilise\b/gi, "use"],
  [/\butilises\b/gi, "uses"],
  [/\butilised\b/gi, "used"],
  [/\butilising\b/gi, "using"],
  [/\bleverage\b/gi, "use"],
  [/\bleverages\b/gi, "uses"],
  [/\bleveraged\b/gi, "used"],
  [/\bleveraging\b/gi, "using"],
  [/\bharness\b/gi, "use"],
  [/\bharnesses\b/gi, "uses"],
  [/\bharnessed\b/gi, "used"],
  [/\bharnessing\b/gi, "using"],
  [/\bspearhead\b/gi, "lead"],
  [/\bspearheads\b/gi, "leads"],
  [/\bspearheaded\b/gi, "led"],
  [/\bspearheading\b/gi, "leading"],
  [/\bfacilitate\b/gi, "support"],
  [/\bfacilitates\b/gi, "supports"],
  [/\bfacilitated\b/gi, "supported"],
  [/\bfacilitating\b/gi, "supporting"],
  [/\bfoster\b/gi, "build"],
  [/\bfosters\b/gi, "builds"],
  [/\bfostered\b/gi, "built"],
  [/\bfostering\b/gi, "building"],
  [/\bdelve into\b/gi, "examine"],
  [/\bdelves into\b/gi, "examines"],
  [/\bdelved into\b/gi, "examined"],
  [/\bdelving into\b/gi, "examining"],
  [/\bin order to\b/gi, "to"],
  [/\bactionable insights\b/gi, "insights"],
  [/\bdata-driven decision-making\b/gi, "decision-making"],
  [/\bdata-driven decision making\b/gi, "decision-making"],
  [/\bplethora of\b/gi, "many"],
  [/\bmyriad of\b/gi, "many"],
  [/\ba myriad of\b/gi, "many"],
];

// Filler adjectives/adverbs dropped outright (with the article fixed up).
const FILLER = [
  'seamless', 'seamlessly', 'cutting-edge', 'state-of-the-art', 'robust', 'innovative', 'synergistic',
  'best-in-class', 'world-class', 'meticulous', 'meticulously', 'results-driven', 'highly motivated',
  'highly', 'holistic', 'transformative', 'impactful', 'game-changing', 'unparalleled', 'pivotal',
];
const FILLER_RE = new RegExp(`\\b(an?\\s+)?(?:${FILLER.map((w) => w.replace(/[-]/g, '\\-')).join('|')})\\s+(?=[A-Za-z])`, 'gi');

const OPENERS = /^(additionally|furthermore|moreover|notably|importantly|overall|in addition),\s*/i;
// Summary sentences that sound generated and state nothing checkable.
const HOLLOW_SENTENCE = /^(seeking|eager|looking|committed|passionate|excited|aspiring|dedicated)\b|\b(to leverage|to contribute (my|to)|thrive in|fast-paced environment|make a (meaningful|significant) impact)\b/i;

function article(nextWord: string, original: string): string {
  const an = /^[aeio]/i.test(nextWord) || /^(hour|honest)/i.test(nextWord);
  const a = an ? 'an ' : 'a ';
  return /^[A]/.test(original) ? a[0].toUpperCase() + a.slice(1) : a;
}

function cleanSentence(s: string): string {
  let t = s;
  for (const [re, to] of SWAPS) t = t.replace(re, (m) => matchCase(m, to));
  t = t.replace(FILLER_RE, (m, art, offset: number, whole: string) => {
    if (!art) return '';
    const next = whole.slice(offset + m.length).match(/^[A-Za-z]+/)?.[0] || '';
    return article(next, art);
  });
  t = t.replace(OPENERS, '');
  t = t.replace(/\s*—\s*/g, ', ').replace(/\s+–\s+/g, ', ');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/,\s*,/g, ',').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function matchCase(source: string, replacement: string): string {
  if (!replacement) return replacement;
  if (source[0] === source[0].toUpperCase() && /[a-z]/i.test(source[0])) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/** One line (bullet or project point). */
export function humanizeLine(text: string): string {
  return cleanSentence(text);
}

/** Paragraph text such as the summary: also drops hollow "Seeking to…" sentences. */
export function humanizeProse(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).filter((s) => s.trim());
  const cleaned = sentences.map(cleanSentence).filter(Boolean);
  const solid = cleaned.filter((s) => !HOLLOW_SENTENCE.test(s));
  return (solid.length ? solid : cleaned).join(' ');
}
