export function toErrorMessage(error) {
  if (!error) return 'Unknown error';
  return error.message || String(error);
}

export function safeDate(value, fallbackMs = Date.now()) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : fallbackMs;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : fallbackMs;
}

export function safeDivide(a, b, fallback = 0) {
  const numerator = Number(a);
  const denominator = Number(b);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fallback;
  }
  const out = numerator / denominator;
  return Number.isFinite(out) ? out : fallback;
}

export function sanitizeTitle(title, maxLen = 200) {
  const clean = String(title ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/```/g, '\\`\\`\\`')
    .replace(/\s+/g, ' ')
    .trim();

  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen);
}

