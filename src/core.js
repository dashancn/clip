const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_CIPHERTEXT = 300_000;

export function generateCode(random = length => crypto.getRandomValues(new Uint32Array(length))) {
  const values = random(6);
  return Array.from(values, value => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

export function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 6);
}

export function normalizeCreateInput(input = {}) {
  const ciphertext = String(input.ciphertext || '');
  const iv = String(input.iv || '');
  const salt = String(input.salt || '');
  if (!ciphertext || ciphertext.length > MAX_CIPHERTEXT) throw new Error('内容为空或过大');
  if (!iv || !salt) throw new Error('缺少加密参数');
  const ttl = Math.min(86400, Math.max(60, Math.round(Number(input.ttl) || 3600)));
  const maxViews = Math.min(10, Math.max(1, Math.round(Number(input.maxViews) || 1)));
  return { ciphertext, iv, salt, ttl, maxViews, burn: Boolean(input.burn) };
}

export function consumeRecord(record) {
  if (record.burn || Number(record.viewsLeft) <= 1) return { delete: true };
  return { delete: false, viewsLeft: Number(record.viewsLeft) - 1 };
}

export function securityHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), ...extra },
  });
}
