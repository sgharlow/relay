/**
 * What a vault item's PLAINTEXT actually contains.
 *
 * Relay stores one opaque ciphertext blob per item, and the server can never
 * read it. This module is the only place that decides what the bytes inside that
 * blob mean — encoded by the owner's browser, decoded by the owner's and the
 * recipient's. It is a cross-boundary contract with exactly one definition.
 *
 * 🔴 THERE WERE ALREADY TWO INCOMPATIBLE FORMATS IN PRODUCTION, and the second
 * one was reaching people. `ImportPageClient` encrypted
 * `JSON.stringify({ username, password })`; the manual add form encrypted a raw
 * string; and `AccessClient` rendered whatever came back into a `<pre>`. So a
 * recipient of any imported item — at the worst moment of their life — was shown
 *
 *     {"username":"steve@example.com","password":"hunter2"}
 *
 * ⚠️ THE CONSTRAINT THAT SHAPES EVERYTHING HERE: THERE IS NO BACKFILL, EVER.
 * The server cannot read plaintext, so it cannot re-encrypt a single row. No
 * migration can ever normalise these. `decode` must therefore accept all three
 * shapes permanently — and an item is only rewritten in the new format when its
 * own owner next edits it, in their own browser.
 *
 * Feature: relay-h0-mvp
 */

/**
 * The kinds of secret an item can hold.
 *
 * Class A of the design's classification — TRANSFERABLE. Every one of these can
 * be copied and used by another person, which is what makes it storable. A
 * passkey is deliberately absent: it is bound to a device and cannot be handed
 * over by anyone, so there is nothing to put here. That is recorded as a
 * recovery route (`backup_note` + a dependency edge), not as a secret.
 */
export const SECRET_KINDS = [
  'username',
  'password',
  'totp',
  'recovery_codes',
  'pin',
  'security_answers',
  'api_key',
  'note',
] as const;

export type SecretKind = (typeof SECRET_KINDS)[number];

export interface SecretField {
  kind: SecretKind;
  /** Overrides the default label. For 'note' and 'api_key', usually worth setting. */
  label?: string;
  /**
   * ⚠️ ALWAYS A STRING, including for `recovery_codes`, which is newline
   * delimited. A union of `string | string[]` would spread a type check into
   * every consumer and every render path, and the one place that genuinely
   * needs the list is `recoveryCodesOf` below. One shape in, one helper out.
   */
  value: string;
}

/** The envelope. `relay` is both the format marker and the version. */
interface Envelope {
  relay: 1;
  fields: SecretField[];
}

const KINDS = new Set<string>(SECRET_KINDS);

/** Human labels, so the recipient view never shows a field name. */
export const KIND_LABELS: Record<SecretKind, string> = {
  username: 'Username',
  password: 'Password',
  totp: 'Two-factor code',
  recovery_codes: 'Recovery codes',
  pin: 'PIN',
  security_answers: 'Security answers',
  api_key: 'API key',
  note: 'Note',
};

/** Which kinds are masked until the reader asks to see them. */
export const MASKED_KINDS: ReadonlySet<SecretKind> = new Set<SecretKind>([
  'password',
  'pin',
  'api_key',
  'security_answers',
]);

/**
 * Builds the plaintext to encrypt. Empty fields are dropped rather than stored:
 * a `password` whose value is '' would otherwise render as a blank labelled row
 * and read as "the password is empty" rather than "there isn't one".
 */
/**
 * Does this field survive into the envelope?
 *
 * 🔴 ONE DEFINITION, BECAUSE TWO DISAGREED. `encodeSecretPayload` has always
 * dropped empty fields; `secretKindsOf` listed every kind it was handed. So an
 * owner who left the TOTP box untouched produced a blob holding no TOTP and a
 * declaration saying it held one — and an account declared to need a code would
 * then read `usable` while holding nothing. That is the exact falsehood
 * migration 035 exists to end, arriving by the back door of its own fix.
 * Caught by `secret-kinds-wiring.test.ts` while wiring the column.
 */
function isKept(f: SecretField): boolean {
  return KINDS.has(f.kind) && typeof f.value === 'string' && f.value.trim().length > 0;
}

export function encodeSecretPayload(fields: SecretField[]): string {
  const kept = fields
    .filter(isKept)
    .map((f) => ({ kind: f.kind, ...(f.label ? { label: f.label } : {}), value: f.value }));
  const envelope: Envelope = { relay: 1, fields: kept };
  return JSON.stringify(envelope);
}

/**
 * Reads the plaintext, whatever era it was written in.
 *
 * Never throws. A vault item that cannot be understood must still hand the
 * reader its raw contents — being shown something puzzling beats being shown
 * nothing at all, and this runs at the moment a family is trying to get in.
 */
export function decodeSecretPayload(plaintext: string): SecretField[] {
  if (typeof plaintext !== 'string' || plaintext.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    // Shape 3 — a bare secret, which is how every manually-added item was
    // written before this module existed.
    return [{ kind: 'password', value: plaintext }];
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    /*
      Valid JSON that is not an object: a password of "42" or "true" parses
      cleanly and is still just a password. Falling through to the raw string is
      the only reading that does not lose it.
    */
    return [{ kind: 'password', value: plaintext }];
  }

  const obj = parsed as Record<string, unknown>;

  // Shape 1 — the current format.
  if (obj.relay === 1 && Array.isArray(obj.fields)) {
    const fields = (obj.fields as unknown[])
      .filter((f): f is SecretField => {
        if (typeof f !== 'object' || f === null) return false;
        const c = f as Record<string, unknown>;
        return KINDS.has(c.kind as string) && typeof c.value === 'string';
      })
      .map((f) => ({
        kind: f.kind,
        ...(typeof f.label === 'string' && f.label ? { label: f.label } : {}),
        value: f.value,
      }));
    return fields;
  }

  // Shape 2 — the legacy CSV-import format, which is the one that was reaching
  // recipients as raw JSON.
  if ('password' in obj || 'username' in obj) {
    const out: SecretField[] = [];
    if (typeof obj.username === 'string' && obj.username.trim().length > 0) {
      out.push({ kind: 'username', value: obj.username });
    }
    if (typeof obj.password === 'string' && obj.password.length > 0) {
      out.push({ kind: 'password', value: obj.password });
    }
    // Both null is possible: the CSV parser permits a null username, and a row
    // with neither should still show the reader what was stored.
    if (out.length > 0) return out;
  }

  /*
    An object we do not recognise. Showing the raw JSON is ugly, and it is still
    strictly better than showing nothing — the reader can at least act on it.
    This is the branch that used to be the ONLY behaviour.
  */
  return [{ kind: 'password', value: plaintext }];
}

/**
 * Recovery codes as a list. The one place the newline-delimited convention is
 * interpreted, so the split rule cannot drift between the form that writes them
 * and the screen that shows them.
 */
export function recoveryCodesOf(fields: SecretField[]): string[] {
  const field = fields.find((f) => f.kind === 'recovery_codes');
  if (!field) return [];
  return field.value
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/** First value of a kind, or null. */
export function valueOf(fields: SecretField[], kind: SecretKind): string | null {
  return fields.find((f) => f.kind === kind)?.value ?? null;
}

/**
 * The sorted, comma-joined list of kinds the ENVELOPE WILL ACTUALLY HOLD — the
 * value written to `secret_kinds` (migration 035, wired 2026-08-18).
 *
 * ⚠️ IT MUST AGREE WITH `encodeSecretPayload`, WHICH IS WHY BOTH CALL `isKept`.
 * Its earlier form listed every kind it was handed and left the absent-vs-empty
 * question to "whoever wires the column later". Wiring it revealed why that
 * could not be deferred: an untouched TOTP box declared `totp` on a blob
 * containing none, so an account declared to need a code read `usable` while
 * holding nothing — the original falsehood, restored by its own fix. A
 * declaration that describes something other than the blob is worse than no
 * declaration, because `unknown` at least prompts a question.
 */
export function secretKindsOf(fields: SecretField[]): string {
  return [...new Set(fields.filter(isKept).map((f) => f.kind))].sort().join(',');
}
