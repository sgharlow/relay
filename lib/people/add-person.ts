/**
 * Adding a person once, whatever hats they wear (J4-R1).
 *
 * 🔴 THE MERGE WAS ONLY EVER ON THE READ SIDE. `listPeople` has folded a
 * recipient row and a verifier row with the same address into one entry since it
 * shipped, and its own header states the point of the model: "One people list;
 * roles are attributes." Nothing said that to the person doing the typing. The
 * circle screen carried TWO add forms — one under "Who would step in", one under
 * "Who confirms it is real" — so an owner naming their spouse as both had to
 * find them, understand that the product keeps two tables, and enter the same
 * human twice.
 *
 * What that cost, beyond the typing: two invitations, two claim codes to read
 * down a phone, two standby lights to chase, and a circle whose headcount
 * overstates how many people are actually standing by. J4-R1 describes exactly
 * this failure, and the model's whole justification was already written down in
 * `people.ts` — the entry point simply never honoured it.
 *
 * ⚠️ AN ENTRY-EXPERIENCE UNIFICATION, NOT A SCHEMA CHANGE. `recipients` and
 * `verifiers` remain the storage projections, and every existing query, cascade
 * and integrity check is untouched. A person is still claimed per row, still
 * confirmed per row, and still removed per row — because those are per-ROLE
 * facts and merging them would be a different, much larger claim than this one.
 *
 * ⚠️ THIS MODULE ONLY EVER CREATES. There is deliberately no update path here:
 * an existing row carries state the owner earned — a claimed identity, a
 * confirmed fingerprint phrase, a break-glass exclusion — and the cheapest way
 * to guarantee a second hat cannot silently merge or reset any of it is for this
 * file to have no statement that could. Adding the hat somebody is missing is a
 * create on the OTHER table; the row they already have is not read for anything
 * but its id.
 *
 * ⚠️ AND IT IS SAFE TO RETRY. There is no transaction across the two tables —
 * this data layer has none — so a failure after the first create leaves a person
 * holding one hat. That is recoverable rather than corrupt precisely because
 * `createRecipient` and `createVerifier` both refuse a duplicate normalised
 * email: submitting the same person again skips what exists and creates what
 * does not. The guards are what make the missing transaction survivable, which
 * is why they are guards and not comments.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1, 3.1, 3.2
 */

import { ValidationError } from '../validation';
import {
  assertWithinRecipientCap,
  assertWithinVerifierCap,
} from '../billing/entitlements';
import { listPeople, normaliseEmail } from './people';
import { createRecipient, validateRecipientInput, type RecipientInput } from './recipients';
import { createVerifier, validateVerifierInput, type VerifierInput } from './verifiers';

/** Which hats the owner said this person wears. At least one is required. */
export interface PersonRoles {
  recipient: boolean;
  verifier: boolean;
}

export interface AddPersonInput {
  roles: PersonRoles;
  /**
   * Built by the ROLE'S OWN validator, so this path can never accept something
   * `POST /api/recipients` would have refused. `null` for a hat not chosen.
   */
  recipient: RecipientInput | null;
  verifier: VerifierInput | null;
  /** The normalised key both halves share — one human, one address. */
  email: string;
  name: string;
}

/** What actually happened, per hat. `created: false` means "already had it". */
export interface AddPersonOutcome {
  id: string;
  created: boolean;
}

export interface AddPersonResult {
  name: string;
  email: string;
  recipient: AddPersonOutcome | null;
  verifier: AddPersonOutcome | null;
  /**
   * False when the person already held every hat that was asked for.
   *
   * Present so a caller cannot report "Added" over a submission that wrote
   * nothing. Silence in that case would be the false-green shape this codebase
   * keeps finding: a screen that says something happened because nothing
   * errored.
   */
  createdAnything: boolean;
}

function readRoles(raw: unknown): PersonRoles {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { recipient: r.recipient === true, verifier: r.verifier === true };
}

/**
 * Validates the whole submission through the EXISTING per-role validators.
 *
 * Nothing about a name, an address, a role or a second mailbox is decided here.
 * `validateRecipientInput` and `validateVerifierInput` remain the single
 * authoritative answers to what each row may contain — this function only
 * decides which of them apply.
 */
export function validateAddPersonInput(body: unknown): AddPersonInput {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const roles = readRoles(b.roles);

  /*
    A person with no hat is a row that can do nothing and a submit that quietly
    achieves nothing. Refused HERE rather than defaulted to "recipient": guessing
    would put somebody in a circle in a role the owner never chose, on the screen
    where roles decide who can open a vault.
  */
  if (!roles.recipient && !roles.verifier) {
    throw new ValidationError(
      'Choose at least one thing this person would do — receive access, confirm an emergency, or both.',
      'roles',
    );
  }

  const recipient = roles.recipient ? validateRecipientInput(b) : null;
  const verifier = roles.verifier ? validateVerifierInput(b) : null;

  /*
    Either validator has already proved the address and the name, so they are
    taken from whichever ran — one spelling of each on the result.

    Written as a check rather than a `!`: the guard above means this cannot be
    null, but a non-null assertion is a promise to a reader who has no way to
    verify it from here, and the two are separated by twenty lines that somebody
    will eventually edit.
  */
  const source = recipient ?? verifier;
  if (!source) {
    throw new ValidationError('Choose at least one thing this person would do', 'roles');
  }

  return { roles, recipient, verifier, email: source.email, name: source.name };
}

/**
 * Creates only the rows this person does not already have.
 *
 * Existence is answered by `listPeople` rather than a fresh pair of queries.
 * That is deliberate: it already merges the two tables on normalised email, so
 * the entry point and the read side cannot disagree about who is already in the
 * circle. A private lookup here would be a second definition of "the same
 * person", and this repo has been bitten by that shape before.
 */
export async function addPerson(
  ownerId: string,
  input: AddPersonInput,
): Promise<AddPersonResult> {
  /*
    A ROLE ASKED FOR WITHOUT ITS VALIDATED INPUT IS REFUSED, NOT SKIPPED.
    `validateAddPersonInput` is the only thing that builds an `AddPersonInput`
    and it fills `recipient`/`verifier` exactly when the matching role is set —
    but the type permits the two disagreeing, and a hand-built input where they
    do would otherwise create nothing and report success. Silence is the wrong
    failure here: the caller asked for a row and would be told it exists.
  */
  if (input.roles.recipient && !input.recipient) {
    throw new ValidationError('recipient details are required for that role', 'roles');
  }
  if (input.roles.verifier && !input.verifier) {
    throw new ValidationError('verifier details are required for that role', 'roles');
  }

  const key = normaliseEmail(input.email);
  const existing = (await listPeople(ownerId)).find((p) => normaliseEmail(p.email) === key) ?? null;

  // Captured as locals so the creates below need no non-null assertion — the
  // narrowing is the guard, rather than a `!` promising the reader it is fine.
  const recipientToCreate = input.roles.recipient && !existing?.recipientId ? input.recipient : null;
  const verifierToCreate = input.roles.verifier && !existing?.verifierId ? input.verifier : null;
  const needsRecipient = recipientToCreate !== null;
  const needsVerifier = verifierToCreate !== null;

  /*
    BOTH CEILINGS ARE ASKED FOR BEFORE EITHER ROW IS WRITTEN. Checking each one
    beside its own create would let a free owner adding a dual-hat person get the
    recipient row, trip the verifier cap, and be told the whole thing failed —
    with half of it already done. The single-role routes cannot have this bug
    because they only ever write one row; this path can, so the order is stated.

    Only the ceilings actually about to be spent are asked for. A hat the person
    already holds costs nothing, so charging for it would refuse a legitimate
    submission at the limit.
  */
  if (needsRecipient) await assertWithinRecipientCap(ownerId);
  if (needsVerifier) await assertWithinVerifierCap(ownerId);

  let recipient: AddPersonOutcome | null = existing?.recipientId
    ? { id: existing.recipientId, created: false }
    : null;
  let verifier: AddPersonOutcome | null = existing?.verifierId
    ? { id: existing.verifierId, created: false }
    : null;

  if (recipientToCreate) {
    const row = await createRecipient(ownerId, recipientToCreate);
    recipient = { id: row.id, created: true };
  }
  if (verifierToCreate) {
    const row = await createVerifier(ownerId, verifierToCreate);
    verifier = { id: row.id, created: true };
  }

  return {
    name: input.name,
    email: input.email,
    // A hat the owner did not ask for is not reported, even if the row exists —
    // this result describes the submission, not the whole person.
    recipient: input.roles.recipient ? recipient : null,
    verifier: input.roles.verifier ? verifier : null,
    createdAnything: needsRecipient || needsVerifier,
  };
}
