import type { AtsTemplateType, ResumeData } from '../../../shared/resumeTypes.js';
import { normalizeSections } from '../../../shared/normalize.js';
import { FONT_OPTIONS, TEMPLATE_STYLES } from '../../../shared/templates.js';

/**
 * Chat commands that are handled deterministically, without an AI call:
 * undo/redo, version restore, "what changed", template switches and score
 * recalculation. Everything else goes to the AI editor.
 */
export type LocalCommand =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'restore-previous' }
  | { type: 'restore-number'; number: number }
  | { type: 'show-diff' }
  | { type: 'template'; template: AtsTemplateType }
  | { type: 'recalculate' }
  | { type: 'remove-headline' }
  | { type: 'contact'; field: 'fullName' | 'jobTitle' | 'email' | 'phone' | 'location' | 'linkedin' | 'website' | 'github'; value: string }
  | { type: 'style'; style: Record<string, unknown> | null; summary: string[] };

export const COLOUR_NAMES: Record<string, string> = {
  black: '#111111', 'dark grey': '#333333', 'dark gray': '#333333', grey: '#555555', gray: '#555555', charcoal: '#36454f',
  navy: '#1f3a5f', 'navy blue': '#1f3a5f', 'dark blue': '#1f4e79', blue: '#1f5582', 'royal blue': '#2b50aa', teal: '#0f766e',
  green: '#1e6b3a', 'dark green': '#0f5132', maroon: '#7a1f2b', burgundy: '#800020', red: '#b91c1c', purple: '#5b2a86', brown: '#6b4226',
};

/**
 * Clear-cut typography/colour commands handled without the AI, e.g.
 * "change font to Georgia", "body font size 11", "make headings navy",
 * "name size 22", "uppercase headings", "remove lines under headings", "reset fonts".
 */
export function parseStyleCommand(raw: string): { style: Record<string, unknown> | null; summary: string[] } | null {
  const t = raw.trim().toLowerCase().replace(/[.!]+$/, '');
  if (t.length > 160) return null;
  if (/\b(reset|restore|default)\b.*\b(fonts?|styles?|colou?rs?|typography|formatting)\b/.test(t)) return { style: null, summary: ['Reset fonts, sizes and colours to the template defaults'] };
  const style: Record<string, unknown> = {};
  const summary: string[] = [];
  const target = (s: string) =>
    /\bname\b/.test(s) ? 'name' : /\b(headline|tagline|title under|line under)\b/.test(s) ? 'headline' : /\b(headings?|section titles?|titles)\b/.test(s) ? 'heading' : /\b(contact|email|phone|links?)\b/.test(s) ? 'contact' : 'body';

  const font = FONT_OPTIONS.find((f) => new RegExp(`\\b${f.name.toLowerCase()}\\b`).test(t));
  if (font && /\b(font|typeface|use|change|switch|set|make)\b/.test(t)) {
    style.fontFamily = font.name;
    summary.push(`Font: ${font.name}`);
  }
  const sizeMatch = t.match(/\b(size|font size|pt|points?)\b[^0-9]{0,12}(\d{1,2}(?:\.5)?)\b|\b(\d{1,2}(?:\.5)?)\s*(pt|points?)\b/);
  if (sizeMatch && /\b(size|pt|points?|font)\b/.test(t)) {
    const n = Number(sizeMatch[2] || sizeMatch[3]);
    const key = { name: 'nameSize', headline: 'headlineSize', heading: 'headingSize', contact: 'contactSize', body: 'bodySize' }[target(t)];
    style[key] = n;
    summary.push(`${key.replace('Size', '')} size: ${n}pt`);
  }
  const colourName = Object.keys(COLOUR_NAMES).sort((a, b) => b.length - a.length).find((c) => new RegExp(`\\b${c}\\b`).test(t));
  const hex = t.match(/#[0-9a-f]{6}\b/)?.[0];
  if ((colourName || hex) && /\b(colou?r|make|change|set|turn|in)\b/.test(t)) {
    const key = { name: 'nameColor', headline: 'headlineColor', heading: 'headingColor', contact: 'contactColor', body: 'textColor' }[target(t)];
    style[key] = hex || COLOUR_NAMES[colourName!];
    summary.push(`${key.replace('Color', '')} colour: ${colourName || hex}`);
  }
  if (/\b(uppercase|all caps|capital)\b.*\bheadings?\b|\bheadings?\b.*\b(uppercase|all caps|capitals?)\b/.test(t)) {
    style.headingUppercase = !/\b(no|not|remove|without|normal|title case)\b/.test(t);
    summary.push(style.headingUppercase ? 'Uppercase headings' : 'Title-case headings');
  }
  if (/\b(lines?|rules?|underlines?|dividers?)\b.*\bheadings?\b|\bheadings?\b.*\b(lines?|rules?|underlines?|dividers?)\b/.test(t)) {
    style.headingRule = !/\b(no|remove|without|hide|delete)\b/.test(t);
    summary.push(style.headingRule ? 'Lines under headings' : 'No lines under headings');
  }
  if (/\b(centre|center|centered|centred)\b.*\bname\b|\bname\b.*\b(centre|center|centered|centred)\b/.test(t)) {
    style.nameAlign = 'center';
    summary.push('Name centred');
  } else if (/\bname\b.*\bleft\b|\bleft\b.*\bname\b/.test(t)) {
    style.nameAlign = 'left';
    summary.push('Name left-aligned');
  }
  if (/\bjustif(y|ied)\b/.test(t)) {
    style.justify = !/\b(no|not|remove|left[- ]align)\b/.test(t);
    summary.push(style.justify ? 'Justified text' : 'Left-aligned text');
  }
  return summary.length ? { style, summary } : null;
}

const CONTENT_WORDS = /\b(summary|bullet|experience|skill|project|education|certif|keyword|ats|score|rewrite|shorter|longer|shorten|page|verb|section|add|remove|highlight|tailor|role|job|improve)\b/i;

export function detectTemplate(text: string): AtsTemplateType | null {
  const t = text.toLowerCase();
  if (/\bdefault\b|\bstandard\b|\bhelvetica\b|\bprofessional template\b|^professional$/.test(t)) return 'professional';
  if (/\bats[- ]?classic\b|\bclassic\b|\btraditional\b|\bserif\b/.test(t)) return 'ats-classic';
  if (/\bmodern\b|\bclean professional\b|\bprofessional (design|template|look)\b|\bcorporate\b/.test(t)) return 'modern-professional';
  if (/\btechnical\b|\btech\b|\bit\b|\bdevops\b|\bengineering\b/.test(t)) return 'technical';
  if (/\bminimal\b|\bcompact\b|\bsimple\b|\bminimalist\b/.test(t)) return 'minimal';
  for (const style of Object.values(TEMPLATE_STYLES)) if (t.includes(style.name.toLowerCase())) return style.id;
  return null;
}

export function parseCommand(raw: string): LocalCommand | null {
  const t = raw.trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(please\s+)?(undo|revert)(\s+(that|it|the\s+last(\s+(change|edit))?|my\s+last\s+(change|edit)|last\s+(change|edit)))?$/.test(t)) return { type: 'undo' };
  if (/^(please\s+)?redo(\s+(that|it|the\s+last(\s+(change|edit))?))?$/.test(t)) return { type: 'redo' };
  // Contact details the user supplies directly: "change my location to Hyderabad, India".
  const contact = raw.trim().match(/^(?:please\s+)?(?:change|set|update|make|replace)\s+(?:my\s+|the\s+)?(location|city|address|phone(?: number)?|mobile(?: number)?|email(?: address)?|e-mail|linkedin(?: url| link| profile)?|portfolio(?: url| link)?|website|github(?: url| link)?|full name|name|headline|title under (?:my )?name)\s+(?:to|as|with|=|:)\s+["“]?(.+?)["”]?\s*\.?$/i);
  if (contact) {
    const key = contact[1].toLowerCase();
    const field = /location|city|address/.test(key) ? 'location' : /phone|mobile/.test(key) ? 'phone' : /mail/.test(key) ? 'email' : /linkedin/.test(key) ? 'linkedin' : /portfolio|website/.test(key) ? 'website' : /github/.test(key) ? 'github' : /headline|title/.test(key) ? 'jobTitle' : 'fullName';
    return { type: 'contact', field, value: contact[2].trim().slice(0, 200) };
  }
  if (!/\b(rewrite|tailor|improve|summary|experience|projects?|skills?|bullets?|keywords?|ats)\b/.test(t)) {
    const style = parseStyleCommand(raw);
    if (style) return { type: 'style', ...style };
  }
  const num = t.match(/\b(?:restore|go back to|revert to|switch to|use)\s+(?:the\s+)?version\s*#?\s*(\d{1,4})\b/);
  if (num) return { type: 'restore-number', number: Number(num[1]) };
  if (/\b(restore|go back to|revert to)\s+(the\s+)?(previous|last|prior|earlier)\s+version\b/.test(t)) return { type: 'restore-previous' };
  if (/\b(show|what|which|list)\b.*\b(changed|changes|different|differences|diff)\b/.test(t) && t.length < 120) return { type: 'show-diff' };
  if (/\b(recalculate|re-?calculate|re-?score|refresh)\b.*\b(score|ats)\b/.test(t)) return { type: 'recalculate' };
  // "Remove the line below my name", "delete the headline", "remove B.Tech fresher under name"
  if (
    /\b(remove|delete|hide|drop|clear)\b/.test(t) &&
    /\b(headline|tagline|sub-?title)\b|\b(line|text|title|subtitle|tagline|designation)\s+(below|under|beneath|after)\s+(my\s+|the\s+)?name\b|\b(below|under|beneath)\s+(my\s+|the\s+)?name\b/.test(t)
  )
    return { type: 'remove-headline' };
  if (/\b(template|design|layout|look|style|theme)\b/.test(t) && !CONTENT_WORDS.test(t.replace(/\b(template|design|layout|look|style|theme|resume)\b/g, ''))) {
    const template = detectTemplate(t);
    if (template) return { type: 'template', template };
  }
  return null;
}

/**
 * Conservative offline fallbacks used only when no AI provider is configured.
 * They never add content — they only shorten, hide or re-layout.
 */
export function localEdit(instruction: string, current: ResumeData): { resume: ResumeData; message: string; changes: string[] } | null {
  const t = instruction.toLowerCase();
  const out = structuredClone(current);

  if (/\bsummary\b/.test(t) && /\b(short|shorter|shorten|concise|brief|trim|condense)\b/.test(t)) {
    const sentences = current.summary.match(/[^.!?]+[.!?]+/g) || [current.summary];
    if (sentences.length <= 1) return null;
    const keep = sentences.length > 2 ? 2 : 1;
    out.summary = sentences.slice(0, keep).join(' ').trim();
    const message = `I shortened your professional summary to its first ${keep === 1 ? 'sentence' : 'two sentences'} (offline mode — no rewording).`;
    return { resume: out, message, changes: ['Shortened the professional summary'] };
  }

  const sectionNames: Record<string, string> = { objective: 'summary', summary: 'summary', projects: 'projects', project: 'projects', certifications: 'certifications', achievements: 'achievements', skills: 'skills', education: 'education', experience: 'experience' };
  const hide = t.match(/\b(remove|hide|delete|drop)\s+(?:the\s+|my\s+)?(\w+)\s+section\b/);
  if (hide && sectionNames[hide[2]]) {
    const id = sectionNames[hide[2]];
    out.sections = normalizeSections(current.sections).map((s) => (s.id === id ? { ...s, visible: false } : s));
    return { resume: out, message: `I hid the ${hide[2]} section. The content is kept, so you can show it again at any time.`, changes: [`Hid the ${hide[2]} section`] };
  }
  const show = t.match(/\b(add|show|include)\s+(?:a\s+|the\s+|my\s+)?(\w+)\s+section\b/);
  if (show && sectionNames[show[2]]) {
    const id = sectionNames[show[2]];
    out.sections = normalizeSections(current.sections).map((s) => (s.id === id ? { ...s, visible: true } : s));
    return { resume: out, message: `The ${show[2]} section is now visible.`, changes: [`Showed the ${show[2]} section`] };
  }

  if (/\b(one|1)[- ]page\b/.test(t)) {
    out.layout = { ...out.layout, margins: 'narrow', pageTarget: 1 };
    out.fontSize = 'small';
    out.experience = current.experience.map((e) => ({ ...e, bulletPoints: e.bulletPoints.slice(0, 4) }));
    return { resume: out, message: 'I switched to a one-page layout: narrow margins, smaller type, and at most four bullets per role (offline mode — no rewording).', changes: ['Set page target to one page', 'Narrow margins and small font', 'Limited each role to four bullets'] };
  }
  return null;
}
