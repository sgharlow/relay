/**
 * Shared validation error for owner-resource API input.
 *
 * Routes map this to HTTP 400 with `{ error, message, field }`. Used by the
 * recipients / verifiers / access-rules modules. (lib/vault keeps its own copy
 * predating this file.)
 *
 * Feature: relay-h0-mvp
 */

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Every id column in the schema is a UUID, so an id that is not one can only
 * ever be a caller mistake — and before this existed it travelled all the way
 * to the driver, which raised SQLSTATE 22P02 and surfaced as a 500.
 *
 * `mapError` catches 22P02 as a backstop for the whole class; this exists so a
 * route can refuse the value at the edge and name the offending FIELD, which
 * the driver error cannot.
 *
 * Matches the canonical 8-4-4-4-12 form the app generates, case-insensitively.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
