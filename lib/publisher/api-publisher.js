const LIMIT_DEFAULT = 50;
const LIMIT_MIN = 1;
const LIMIT_MAX = 500;

export function parseLimit(value, fallback = LIMIT_DEFAULT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(LIMIT_MIN, Math.min(LIMIT_MAX, Math.trunc(parsed)));
}

export function sendError(res, status, message) {
  res.status(status).json({ error: message });
}
