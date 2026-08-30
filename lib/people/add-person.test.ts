/**
 * Tests for the single add-a-person entry (J4-R1).
 *
 * One human, entered once, however many roles they hold. The read side has
 * merged roles since `listPeople` shipped; the WRITE side had two separate
 * forms, so a spouse who is both a recipient and a verifier was typed in twice
 * and became two rows — which is verbatim the failure J4-R1 describes.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/*
  The owner's own address, for the self-naming refusal ruled 2026-08-30 (B15.4).
  Mocked to an address that matches NOTHING in these fixtures, so every existing
  case behaves exactly as before and the refusal is exercised only by the test
  that asks for it.
*/
vi.mock('../db/connection', () => ({
  query: vi.fn(async () => ({ rows: [{ email: 'the-owner@example.com' }] })),
}));
vi.mock('./people', async (io) => {
  const actual = await io<typeof import('./people')>();
  return { ...actual, listPeople: vi.fn() };
});
vi.mock('./recipients', async (io) => {
  const actual = await io<typeof import('./recipients')>();
  return { ...actual, createRecipient: vi.fn(), updateRecipient: vi.fn() };
});
vi.mock('./verifiers', async (io) => {
  const actual = await io<typeof import('./verifiers')>();
  return { ...actual, createVerifier: vi.fn(), updateVerifier: vi.fn() };
});
vi.mock('../billing/entitlements', async (io) => {
  const actual = await io<typeof import('../billing/entitlements')>();
  return {
    ...actual,
    assertWithinRecipientCap: vi.fn(async () => undefined),
    assertWithinVerifierCap: vi.fn(async () => undefined),
  };
});

import { listPeople, type Person } from './people';
import { createRecipient, updateRecipient } from './recipients';
import { createVerifier, updateVerifier } from './verifiers';
import {
  assertWithinRecipientCap,
  assertWithinVerifierCap,
  EntitlementError,
} from '../billing/entitlements';
import { addPerson, validateAddPersonInput } from './add-person';
import { ValidationError } from '../validation';

const mockListPeople = vi.mocked(listPeople);
const mockCreateRecipient = vi.mocked(createRecipient);
const mockCreateVerifier = vi.mocked(createVerifier);
const mockRecipientCap = vi.mocked(assertWithinRecipientCap);
const mockVerifierCap = vi.mocked(assertWithinVerifierCap);

/** Watched so 'it does not update' is a fact about calls, not about intent. */
const updateSpies = {
  recipient: vi.mocked(updateRecipient),
  verifier: vi.mocked(updateVerifier),
};

/** A circle entry as `listPeople` returns it. */
function person(over: Partial<Person>): Person {
  return {
    email: 'sam@example.com',
    name: 'Sam',
    relationship: null,
    phone: null,
    roles: { recipient: false, verifier: false, executor: false },
    recipientId: null,
    verifierId: null,
    ...over,
  };
}

const both = {
  name: 'Sam',
  email: 'sam@example.com',
  role: 'recipient',
  roles: { recipient: true, verifier: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListPeople.mockResolvedValue([]);
  mockCreateRecipient.mockResolvedValue({ id: 'r-new' } as never);
  mockCreateVerifier.mockResolvedValue({ id: 'v-new' } as never);
});

describe('validateAddPersonInput', () => {
  it('refuses a person with no role at all — that submit would do nothing', () => {
    expect(() =>
      validateAddPersonInput({ ...both, roles: { recipient: false, verifier: false } }),
    ).toThrow(ValidationError);
  });

  it('refuses a missing roles object rather than guessing one', () => {
    expect(() => validateAddPersonInput({ name: 'Sam', email: 'sam@example.com' })).toThrow(
      ValidationError,
    );
  });

  it('applies the SAME field validation the single-role routes use', () => {
    // The recipient validator owns what a valid role is; there is no second
    // opinion here.
    expect(() => validateAddPersonInput({ ...both, role: 'boss' })).toThrow(ValidationError);
    expect(() => validateAddPersonInput({ ...both, email: 'nope' })).toThrow(ValidationError);
    expect(() => validateAddPersonInput({ ...both, name: '' })).toThrow(ValidationError);
  });

  it('does not require a role when only the verifier hat was chosen', () => {
    const input = validateAddPersonInput({
      name: 'Dr Lee',
      email: 'lee@example.com',
      roles: { recipient: false, verifier: true },
    });
    expect(input.roles).toEqual({ recipient: false, verifier: true });
  });
});

describe('addPerson materialises the rows for the hats chosen', () => {
  it('creates BOTH rows from one submission, with the same name and address', async () => {
    const result = await addPerson('o-1', validateAddPersonInput(both));

    expect(mockCreateRecipient).toHaveBeenCalledTimes(1);
    expect(mockCreateVerifier).toHaveBeenCalledTimes(1);
    expect(mockCreateRecipient.mock.calls[0][1]).toMatchObject({
      name: 'Sam',
      email: 'sam@example.com',
      role: 'recipient',
    });
    expect(mockCreateVerifier.mock.calls[0][1]).toMatchObject({
      name: 'Sam',
      email: 'sam@example.com',
    });
    expect(result.recipient).toEqual({ id: 'r-new', created: true });
    expect(result.verifier).toEqual({ id: 'v-new', created: true });
  });

  it('creates only the recipient row when only that hat was chosen', async () => {
    const result = await addPerson(
      'o-1',
      validateAddPersonInput({ ...both, roles: { recipient: true, verifier: false } }),
    );

    expect(mockCreateVerifier).not.toHaveBeenCalled();
    expect(result.verifier).toBeNull();
  });
});

describe('addPerson never makes a second row for a human already here', () => {
  it('adds the missing hat to an existing recipient instead of duplicating them', async () => {
    mockListPeople.mockResolvedValue([
      person({ recipientId: 'r-existing', roles: { recipient: true, verifier: false, executor: false } }),
    ]);

    const result = await addPerson('o-1', validateAddPersonInput(both));

    expect(mockCreateRecipient, 'they are already a recipient — a second row is the defect').not
      .toHaveBeenCalled();
    expect(mockCreateVerifier).toHaveBeenCalledTimes(1);
    expect(result.recipient).toEqual({ id: 'r-existing', created: false });
    expect(result.verifier).toEqual({ id: 'v-new', created: true });
  });

  it('matches an existing person across case and whitespace', async () => {
    mockListPeople.mockResolvedValue([
      person({
        email: '  SAM@Example.COM ',
        verifierId: 'v-existing',
        roles: { recipient: false, verifier: true, executor: false },
      }),
    ]);

    const result = await addPerson('o-1', validateAddPersonInput(both));

    expect(mockCreateVerifier).not.toHaveBeenCalled();
    expect(result.verifier).toEqual({ id: 'v-existing', created: false });
  });

  it('creates NOTHING, and says so, when both hats are already held', async () => {
    mockListPeople.mockResolvedValue([
      person({
        recipientId: 'r-existing',
        verifierId: 'v-existing',
        roles: { recipient: true, verifier: true, executor: false },
      }),
    ]);

    const result = await addPerson('o-1', validateAddPersonInput(both));

    expect(mockCreateRecipient).not.toHaveBeenCalled();
    expect(mockCreateVerifier).not.toHaveBeenCalled();
    expect(result.recipient).toEqual({ id: 'r-existing', created: false });
    expect(result.verifier).toEqual({ id: 'v-existing', created: false });
    expect(result.createdAnything, 'nothing happened, and the caller must be able to say so').toBe(
      false,
    );
  });

  /*
    THE INVARIANT THIS PATH MUST NOT BREAK. An existing row carries state the
    owner earned — a claimed identity, a confirmed fingerprint, a break-glass
    exclusion. Adding a second hat must not touch any of it, which is enforced
    structurally: this module has no update path at all, only creates.
  */
  it('never updates the existing row — no state can be merged or reset', async () => {
    mockListPeople.mockResolvedValue([
      person({
        recipientId: 'r-existing',
        roles: { recipient: true, verifier: false, executor: false },
      }),
    ]);

    const result = await addPerson('o-1', validateAddPersonInput(both));

    // The row is used for its id and nothing else, and it is handed back exactly
    // as it was found.
    expect(result.recipient).toEqual({ id: 'r-existing', created: false });
    for (const fn of [mockCreateRecipient, updateSpies.recipient, updateSpies.verifier]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  /*
    The structural half of the same guarantee, which is the half that survives.
    The assertion above proves this call did not update; this proves the module
    CANNOT — it holds no write statement and imports no updater, so a later edit
    that starts merging state has to add one and fail here.
  */
  it('holds no write path at all — the guarantee is structural, not a habit', () => {
    const src = readFileSync('lib/people/add-person.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');

    expect(src, 'add-person.ts must contain no SQL of its own').not.toMatch(
      /\b(UPDATE|INSERT|DELETE)\s/i,
    );
    expect(src, 'and must import no function that rewrites an existing row').not.toMatch(
      /\bupdate(Recipient|Verifier)\b/,
    );
  });
});

describe('addPerson checks both ceilings before it writes anything', () => {
  it('refuses on the verifier cap without having created the recipient first', async () => {
    mockVerifierCap.mockRejectedValueOnce(new EntitlementError('no more', 1, 'free'));

    await expect(addPerson('o-1', validateAddPersonInput(both))).rejects.toThrow(EntitlementError);

    expect(
      mockCreateRecipient,
      'a cap tripping on the second hat must not leave a half-added person behind',
    ).not.toHaveBeenCalled();
  });

  it('asks only for the ceilings it is about to spend', async () => {
    await addPerson(
      'o-1',
      validateAddPersonInput({ ...both, roles: { recipient: false, verifier: true } }),
    );

    expect(mockRecipientCap).not.toHaveBeenCalled();
    expect(mockVerifierCap).toHaveBeenCalledWith('o-1');
  });

  it('spends no ceiling on a hat the person already holds', async () => {
    mockListPeople.mockResolvedValue([
      person({ recipientId: 'r-existing', roles: { recipient: true, verifier: false, executor: false } }),
    ]);

    await addPerson('o-1', validateAddPersonInput(both));

    expect(mockRecipientCap).not.toHaveBeenCalled();
    expect(mockVerifierCap).toHaveBeenCalledWith('o-1');
  });
});

describe('an owner may not name themselves (B15.4, ruled 2026-08-30)', () => {
  /*
    🔴 THE RUNTIME HOLE WAS ALREADY CLOSED, and that is why this is about the
    SCREEN rather than about safety. `isEligibleVerifier` refuses to count an
    owner toward their own quorum (rule 7 — an owner is not an independent
    attestation about themselves). Nothing unsafe could happen.

    What was open: the row could still be CREATED, and once created it appears in
    the roster, the coverage matrix and the circle count. A vault with one person
    in it reads as a vault with two, and readiness is computed over a circle one
    person smaller than it looks. Not a wrong permission — a wrong impression,
    which is the shape this codebase keeps finding.
  */
  it('refuses the owner’s own address at creation, writing nothing', async () => {
    await expect(
      addPerson('owner-1', {
        roles: { recipient: true, verifier: false },
        recipient: { name: 'Me', email: 'the-owner@example.com' } as never,
        verifier: null,
        email: 'the-owner@example.com',
        name: 'Me',
      }),
    ).rejects.toThrow(/your own address/i);

    expect(mockCreateRecipient).not.toHaveBeenCalled();
    expect(mockCreateVerifier).not.toHaveBeenCalled();
  });

  it('refuses it however it is capitalised or padded', async () => {
    /*
      Compared on the NORMALISED address — the same key the duplicate check uses.
      A check written against the raw string would let `The-Owner@Example.com `
      walk straight past, which is the bug this assertion exists to prevent
      rather than to describe.
    */
    await expect(
      addPerson('owner-1', {
        roles: { recipient: false, verifier: true },
        recipient: null,
        verifier: { name: 'Me', email: '  The-Owner@Example.COM ' } as never,
        email: '  The-Owner@Example.COM ',
        name: 'Me',
      }),
    ).rejects.toThrow(/your own address/i);
    expect(mockCreateVerifier).not.toHaveBeenCalled();
  });

  it('refuses BEFORE spending a plan ceiling', async () => {
    // A refused submission must not consume the owner's recipient or verifier
    // allowance — the caps are asked for further down and must never be reached.
    await expect(
      addPerson('owner-1', {
        roles: { recipient: true, verifier: true },
        recipient: { name: 'Me', email: 'the-owner@example.com' } as never,
        verifier: { name: 'Me', email: 'the-owner@example.com' } as never,
        email: 'the-owner@example.com',
        name: 'Me',
      }),
    ).rejects.toThrow(/your own address/i);
    expect(mockRecipientCap).not.toHaveBeenCalled();
  });

  it('still allows any other address', async () => {
    // The guard must not be so broad it refuses the normal case.
    mockListPeople.mockResolvedValueOnce([]);
    const r = await addPerson('owner-1', {
      roles: { recipient: true, verifier: false },
      recipient: { name: 'April', email: 'april@example.com' } as never,
      verifier: null,
      email: 'april@example.com',
      name: 'April',
    });
    expect(r.createdAnything).toBe(true);
  });
});
