// Fails when source files contain invisible or control characters (zero-width
// spaces, bidi overrides, BOMs, NBSP…) that could hide text from reviewers.
// Usage: node scripts/check-hidden-chars.mjs   (also run by `npm run lint`)
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const hidden = (cp) =>
  (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) ||
  cp === 0x7f ||
  cp === 0x85 ||
  cp === 0xa0 ||
  cp === 0x1680 ||
  (cp >= 0x2000 && cp <= 0x200a) ||
  cp === 0x202f ||
  cp === 0x205f ||
  cp === 0x3000 ||
  (cp >= 0x200b && cp <= 0x200f) ||
  cp === 0x2028 ||
  cp === 0x2029 ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2060 && cp <= 0x2064) ||
  cp === 0xfeff;

// Files allowed to contain such characters (none: write escapes instead).
const ALLOW = new Set([]);

const files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx|js|mjs|cjs|json|html|css)$/.test(f) && !f.startsWith('node_modules/') && !ALLOW.has(f) && fs.existsSync(f));

let bad = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const found = [...line].map((c) => c.codePointAt(0)).filter(hidden);
    if (found.length) {
      bad++;
      console.log(`${f}:${i + 1}  ${found.map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`).join(' ')}`);
    }
  });
}
if (bad) {
  console.error(`\n${bad} line(s) contain hidden characters. Use escapes (e.g. String.fromCharCode) instead.`);
  process.exit(1);
}
console.log(`No hidden characters in ${files.length} files.`);
