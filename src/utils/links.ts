export function normalizeUrl(value?: string): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  if (/^[\w.-]+\.[A-Za-z]{2,}(\/.*)?$/.test(raw)) return `https://${raw}`;
  return raw;
}
