/** Normalizes a caught value to an Error, so callers can always read `.message`. */
export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
