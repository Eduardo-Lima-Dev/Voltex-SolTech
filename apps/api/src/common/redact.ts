const SENSITIVE_KEY = /password|token|secret|hash|authorization|cookie/i;

/** Remove recursivamente campos sensíveis antes de gravar em auditoria ou logs. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(val, depth + 1);
  }
  return out as T;
}
