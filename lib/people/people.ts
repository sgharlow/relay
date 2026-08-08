/**
 * One people list; roles are attributes.
 *
 * `recipients` and `verifiers` are separate modules writing separate tables, so
 * an owner naming their spouse as both enters that person twice, maintains two
 * records, and sees them as two entities (J4-R1).
 *
 * This is an ENTRY-EXPERIENCE unification, not a schema migration. Both tables
 * remain the storage projections and every existing query, cascade and
 * integrity check is untouched.
 *
 * Merging is on NORMALISED email — the same normalisation
 * `detectRoleConcentration` will use, so the two can never disagree about
 * whether two rows are the same human.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R1
 */

import { query } from '../db/connection';

export interface Person {
  email: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  roles: { recipient: boolean; verifier: boolean; executor: boolean };
  recipientId: string | null;
  verifierId: string | null;
}

/** Shared with the role-concentration detector — one definition, one behaviour. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listPeople(ownerId: string): Promise<Person[]> {
  const [recipients, verifiers] = await Promise.all([
    query<{
      id: string;
      name: string;
      relationship: string | null;
      email: string;
      phone: string | null;
      role: string;
    }>(
      `SELECT id, name, relationship, email, phone, role
         FROM recipients WHERE owner_id = $1`,
      [ownerId],
    ),
    query<{ id: string; name: string; email: string; phone: string | null }>(
      `SELECT id, name, email, phone FROM verifiers WHERE owner_id = $1`,
      [ownerId],
    ),
  ]);

  const byEmail = new Map<string, Person>();

  for (const r of recipients.rows) {
    const key = normaliseEmail(r.email);
    byEmail.set(key, {
      email: r.email,
      name: r.name,
      relationship: r.relationship,
      phone: r.phone,
      roles: {
        recipient: true,
        verifier: false,
        executor: r.role === 'executor',
      },
      recipientId: r.id,
      verifierId: null,
    });
  }

  for (const v of verifiers.rows) {
    const key = normaliseEmail(v.email);
    const existing = byEmail.get(key);

    if (existing) {
      existing.roles.verifier = true;
      existing.verifierId = v.id;
      continue;
    }

    byEmail.set(key, {
      email: v.email,
      name: v.name,
      relationship: null,
      phone: v.phone,
      roles: { recipient: false, verifier: true, executor: false },
      recipientId: null,
      verifierId: v.id,
    });
  }

  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
}
