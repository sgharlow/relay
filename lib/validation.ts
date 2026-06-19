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
