/**
 * Guardrail from .agents/skills/snagwalk-guardrails: the app never drops or truncates tables.
 * Checked on every query before it reaches the database or the local emulator.
 */
export function assertSafeSql(text: string): void {
  const normalized = text.trim().toUpperCase();
  if (/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/.test(normalized) || /(^|;)\s*TRUNCATE\b/.test(normalized)) {
    throw new Error('Guardrail violation: DROP and TRUNCATE are prohibited.');
  }
}
