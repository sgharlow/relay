/**
 * /api/policies — access policies that materialize into access_rules.
 *
 * GET  → list the owner's policies
 * POST → validate the predicate, insert, then materialize
 *
 * `access_rules` remains the sole authority the KMS unwrap path consults; a
 * policy only generates rows in it (J4-R3).
 *
 * Estate policies require an explicit irreversibility acknowledgement. The DB
 * CHECK enforces `reversible = false`, but a constraint is not consent —
 * irreversibility must never be a silent side effect of picking a trigger type
 * (J4-R7, CC6).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R3, J4-R6, J4-R7, J4-R14, CC6
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../lib/http/owner-route';
import { query } from '../../../../lib/db/connection';
import { assertOwns } from '../../../../lib/db/integrity';
import { writeAuditEntry } from '../../../../lib/audit/audit-service';
import { ValidationError } from '../../../../lib/validation';
import { validatePolicyPredicate } from '../../../../lib/rules/policy-predicate';
import { materializePolicy } from '../../../../lib/rules/policy-materialize';
import { USER_SELECTABLE_TRIGGER_TYPES } from '../../../../lib/domain/enums';

// Was a hand-copied literal that duplicated VALID_TRIGGER_TYPES and drifted
// from the Terms. Now the single shared definition of what a user may choose —
// estate excluded pending g2-counsel-opinion (see lib/domain/enums.ts).
const TRIGGER_TYPES: readonly string[] = USER_SELECTABLE_TRIGGER_TYPES;
const SCOPES = ['view', 'act'];

/*
  GET was here and is gone — RETIRED 2026-08-13, superseded by /api/circle, which
  returns the same policies embedded in the roster and coverage matrix the screen
  actually renders. It had had no caller since /circle was built. POST stays: it
  is how an owner accepts a proposed policy, and it is reached.
*/

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireOwner(req);
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { recipient_id, trigger_type, scope, predicate, acknowledgedIrreversible } =
    (body ?? {}) as Record<string, unknown>;

  try {
    if (typeof recipient_id !== 'string') {
      throw new ValidationError('recipient_id is required', 'recipient_id');
    }
    if (typeof trigger_type !== 'string' || !TRIGGER_TYPES.includes(trigger_type)) {
      throw new ValidationError('trigger_type is invalid', 'trigger_type');
    }
    if (typeof scope !== 'string' || !SCOPES.includes(scope)) {
      throw new ValidationError('scope must be view or act', 'scope');
    }

    // Estate rules are irreversible by construction (R3.5) — and the owner has
    // to say so out loud (J4-R7).
    const isEstate = trigger_type === 'estate';
    if (isEstate && acknowledgedIrreversible !== true) {
      throw new ValidationError(
        'Estate access is permanent and cannot be reversed. Confirm to continue.',
        'acknowledgedIrreversible',
      );
    }

    const validated = validatePolicyPredicate(predicate);

    // DSQL has no FKs — check the recipient belongs to this owner (R16.1).
    await assertOwns(auth.ownerId, 'recipients', recipient_id);

    const inserted = await query<{ id: string }>(
      `INSERT INTO access_policies
         (owner_id, recipient_id, trigger_type, scope, reversible, predicate)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [auth.ownerId, recipient_id, trigger_type, scope, !isEstate, JSON.stringify(validated)],
    );

    const policyId = inserted.rows[0].id;

    if (isEstate) {
      await writeAuditEntry(auth.ownerId, {
        actor: `owner:${auth.ownerId}`,
        action: 'estate_irreversibility_acknowledged',
        entity: 'access_policy',
        entityId: policyId,
        detail: { recipient_id, predicate: validated },
      });
    }

    const result = await materializePolicy(auth.ownerId, policyId);

    return NextResponse.json({ id: policyId, ...result }, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}
