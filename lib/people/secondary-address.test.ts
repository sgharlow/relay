/**
 * The second address, at the two doors it can come in through.
 *
 * `email_secondary` has been on BOTH roster tables since migration 020 and was
 * read and written by nothing. Wiring it starts here, because a column the API
 * will not accept is still a column nothing writes.
 *
 * Feature: relay-standby
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { validateRecipientInput, updateRecipient } from './recipients';
import { validateVerifierInput, updateVerifier } from './verifiers';
import { ValidationError } from '../validation';
import { query } from '../db/connection';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../db/occ', () => ({ withOccRetry: (fn: () => unknown) => fn() }));
const mockQuery = vi.mocked(query);

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(
    async () => ({ rows: [{ id: 'p1' }], rowCount: 1, command: '', oid: 0, fields: [] }) as never,
  );
});

const recipient = (extra: Record<string, unknown> = {}) => ({
  name: 'Alex Chen',
  email: 'alex@outlook.com',
  role: 'executor',
  ...extra,
});

const verifier = (extra: Record<string, unknown> = {}) => ({
  name: 'Sam Rivera',
  email: 'sam@outlook.com',
  ...extra,
});

/*
  Both roster tables carry the column, both routes must accept it, and the two
  validators are separate functions — which is exactly the shape where a feature
  gets wired on one side only. Every case below runs against both.
*/
const doors: [string, (body: unknown) => { email_secondary?: string | null }][] = [
  ['recipient', (b) => validateRecipientInput(b) as { email_secondary?: string | null }],
  ['verifier', (b) => validateVerifierInput(b) as { email_secondary?: string | null }],
];

const bodyFor = (kind: string, extra: Record<string, unknown> = {}) =>
  kind === 'recipient' ? recipient(extra) : verifier(extra);

describe.each(doors)('%s input, second address', (kind, validate) => {
  /*
    🔴 UNDEFINED, NOT NULL, AND THE DIFFERENCE IS THE WHOLE SAFETY PROPERTY.
    Both PUT routes are full replaces and `RenameControl` — the only caller —
    sends back name, email, relationship and role and nothing else. Had absence
    meant "clear", fixing a typo in somebody's name would have deleted the
    backup address that exists for the worst day, silently.
  */
  it('is UNDEFINED when the body does not mention it, so a full-replace caller cannot wipe it', () => {
    expect(validate(bodyFor(kind)).email_secondary).toBeUndefined();
  });

  it('is kept when it is a real address', () => {
    expect(validate(bodyFor(kind, { email_secondary: 'alex@gmail.com' })).email_secondary).toBe(
      'alex@gmail.com',
    );
  });

  it.each(['', '   ', null])('treats an explicit %j as "remove it", not as an error', (v) => {
    // An owner clearing the field is the ordinary way to remove a second
    // address. Making that an error would leave them unable to undo it.
    expect(validate(bodyFor(kind, { email_secondary: v })).email_secondary).toBeNull();
  });

  it('refuses something that is not an address, naming the field', () => {
    try {
      validate(bodyFor(kind, { email_secondary: 'not-an-address' }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError & { field?: string }).field).toBe('email_secondary');
    }
  });

  /*
    THE SAME ADDRESS TWICE IS NOT REDUNDANCY, and accepting it would be the
    worst outcome of this feature: the owner does the work, the circle screen
    shows a second address, and every "backup" copy lands in the same junk
    folder as the first. Refused at the door rather than silently deduplicated
    at send time, so the owner finds out while they can still supply a real one.
  */
  it('refuses a second address identical to the first', () => {
    const primary = kind === 'recipient' ? 'alex@outlook.com' : 'sam@outlook.com';
    expect(() => validate(bodyFor(kind, { email_secondary: primary.toUpperCase() }))).toThrow(
      ValidationError,
    );
  });
});

/**
 * The other half of the same property, at the layer that actually writes.
 *
 * Validating to `undefined` accomplishes nothing if persistence then sends
 * `undefined` as a bound parameter — node-postgres turns that into NULL, and
 * the column is wiped exactly as if the caller had asked for it.
 */
describe('an update that says nothing about the second address does not touch it', () => {
  const sql = () => String(mockQuery.mock.calls.at(-1)![0]);
  const params = () => mockQuery.mock.calls.at(-1)![1] as unknown[];

  it('recipient: the column is not in the statement at all', async () => {
    await updateRecipient('o1', 'p1', {
      name: 'Alex',
      relationship: null,
      email: 'alex@outlook.com',
      phone: null,
      role: 'executor',
    });
    expect(sql()).not.toContain('email_secondary =');
    expect(params()).not.toContain(undefined);
  });

  it('verifier: the column is not in the statement at all', async () => {
    await updateVerifier('o1', 'p1', { name: 'Sam', email: 'sam@outlook.com', phone: null });
    expect(sql()).not.toContain('email_secondary =');
    expect(params()).not.toContain(undefined);
  });

  it('recipient: an explicit value IS written', async () => {
    await updateRecipient('o1', 'p1', {
      name: 'Alex',
      relationship: null,
      email: 'alex@outlook.com',
      phone: null,
      role: 'executor',
      email_secondary: 'alex@gmail.com',
    });
    expect(sql()).toContain('email_secondary =');
    expect(params()).toContain('alex@gmail.com');
  });

  it('verifier: an explicit removal IS written', async () => {
    await updateVerifier('o1', 'p1', {
      name: 'Sam',
      email: 'sam@outlook.com',
      phone: null,
      email_secondary: null,
    });
    expect(sql()).toContain('email_secondary =');
    expect(params()).toContain(null);
  });
});
