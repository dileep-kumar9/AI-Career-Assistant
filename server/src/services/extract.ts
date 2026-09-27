import { badRequest, unprocessable } from '../errors.js';

export type UploadKind = 'pdf' | 'docx' | 'txt';

export const ALLOWED_MIME: Record<UploadKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/**
 * Determines the file type from its content (magic bytes), not from the
 * client-supplied name or MIME type, and rejects anything else.
 */
export function detectKind(buffer: Buffer, filename: string): UploadKind {
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (isZip) {
    if (ext !== 'docx') throw badRequest('Only .docx Word documents are supported (not other ZIP-based formats).');
    if (!buffer.includes(Buffer.from('word/'))) throw badRequest('This file is not a valid Word (.docx) document.');
    return 'docx';
  }
  if (ext === 'txt' && !buffer.subarray(0, 4096).includes(0)) return 'txt';
  if (ext === 'doc') throw badRequest('Legacy .doc files are not supported. Please save the resume as .docx or PDF.');
  throw badRequest('Unsupported file type. Please upload a PDF or DOCX resume, or paste the text instead.');
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  if (doc.numPages > 20) throw badRequest('The PDF has more than 20 pages. Please upload a resume, not a full document.');
  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Group text items into visual lines by their y coordinate.
      const rows: Array<{ y: number; items: Array<{ x: number; str: string }> }> = [];
      for (const item of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
        const str = String(item.str || '');
        if (!str.trim()) continue;
        const y = item.transform?.[5] ?? 0;
        const x = item.transform?.[4] ?? 0;
        let row = rows.find((r) => Math.abs(r.y - y) <= 2.5);
        if (!row) rows.push((row = { y, items: [] }));
        row.items.push({ x, str });
      }
      rows.sort((a, b) => b.y - a.y);
      const lines = rows.map((r) => {
        const items = r.items.sort((a, b) => a.x - b.x);
        let line = '';
        let lastX = -1;
        for (const it of items) {
          if (line && lastX >= 0 && it.x - lastX > 120) line += '   ';
          else if (line && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
          line += it.str;
          lastX = it.x + it.str.length * 4;
        }
        return line.replace(/\s{4,}/g, '   ').trim();
      });
      pages.push(lines.join('\n'));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages.join('\n\n');
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth: any = await import('mammoth');
  const lib = mammoth.default || mammoth;
  // HTML conversion keeps list items, which we turn back into "• " bullets.
  const { value } = await lib.convertToHtml({ buffer });
  const text = String(value)
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').replace(/\s*\|\s*$/, '').trim())
    .filter(Boolean)
    .join('\n');
}

export async function extractText(buffer: Buffer, kind: UploadKind): Promise<string> {
  let text: string;
  try {
    text = kind === 'pdf' ? await extractPdf(buffer) : kind === 'docx' ? await extractDocx(buffer) : buffer.toString('utf8');
  } catch (e: any) {
    if (e?.status) throw e;
    throw unprocessable(`Could not read the ${kind.toUpperCase()} file. It may be corrupted, encrypted or password-protected.`);
  }
  text = sanitizeText(text);
  if (text.replace(/\s/g, '').length < 40) {
    throw unprocessable(
      kind === 'pdf'
        ? 'No selectable text was found in this PDF (it may be a scanned image). Please upload a text-based PDF or DOCX, or paste your resume text.'
        : 'The document does not contain enough text to be a resume.',
    );
  }
  return text;
}

/** Removes control characters and normalises whitespace in untrusted text. */
export function sanitizeText(input: string, max = 60_000): string {
  return String(input || '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]', 'g'), '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'rst', 'py', 'js', 'jsx', 'ts', 'tsx', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'go', 'rb', 'php', 'rs', 'swift', 'r', 'sql', 'sh', 'html', 'css', 'json', 'yml', 'yaml', 'xml', 'ipynb', 'dart', 'scala']);

/**
 * Text of a file attached in the chat (project report, README, internship
 * letter, source code, notebook). Binary files other than PDF/DOCX are refused.
 */
export async function extractAttachment(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-' || (buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    return extractText(buffer, detectKind(buffer, filename));
  }
  if (!TEXT_EXT.has(ext) || buffer.subarray(0, 4096).includes(0)) {
    throw badRequest('Attach a PDF, DOCX, text/Markdown/README, source-code or notebook file.');
  }
  let text = buffer.toString('utf8');
  if (ext === 'ipynb') {
    try {
      const nb = JSON.parse(text);
      text = (nb.cells || []).map((c: any) => (Array.isArray(c.source) ? c.source.join('') : String(c.source || ''))).join('\n\n');
    } catch {
      throw badRequest('This notebook file could not be read.');
    }
  }
  text = sanitizeText(text, 40_000);
  if (text.replace(/\s/g, '').length < 20) throw unprocessable('The file does not contain enough text.');
  return text;
}
