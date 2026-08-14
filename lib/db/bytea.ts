/**
 * BYTEA → base64, the one shared definition.
 *
 * `pg` returns BYTEA columns as Buffers (or Uint8Arrays through some paths),
 * and the crypto columns cross the API as base64 strings. Two private copies of
 * this conversion already existed (lib/access/dashboard.ts and
 * lib/vault/vault-items.ts); the KMS unwrap fix needed a third, which is the
 * point at which a convention becomes a contract — so it moved here and the
 * copies became imports. One definition, per the portfolio's own rule.
 *
 * Feature: relay-h0-mvp
 */

export function byteaToBase64(v: unknown): string {
  if (v == null) return '';
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  return String(v);
}
