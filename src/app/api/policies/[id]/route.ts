/**
 * /api/policies/[id]
 *
 * PUT    → preview then apply a predicate change. A change that REVOKES grants
 *          requires `confirm: true`, so a policy edit can never silently narrow
 *          or widen access without the owner seeing it first (J4-R14).
 * DELETE → drop the policy and every grant it generated.
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R14, J4-R15
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireOwner, readJson, isResponse, mapError } from '../../../../../lib/http/owner-route';
import { query } from '../../../../../lib/db/connection';
import { assertOwns } from '../../../../../lib/db/integrity';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';
import { validatePolicyPredicate } from '../../../../../lib/rules/policy-predicate';
import {
  previewPolicyChange,
  materializePolicy,
} from '../../../../../lib/rules/policy-materialize';

type Ctx = { params: { id: string } };

export async function PUT(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const body = await readJson(req);
  if (isResponse(body)) return body;

  const { predicate, confirm } = (body ?? {}) as Record<string, unknown>;

  try {
    await assertOwns(auth.ownerId, 'access_policies', params.id);
    const validated = validatePolicyPredicate(predicate);

    const preview = await previewPolicyChange(auth.ownerId, params.id, validated);

    // Revocations are the dangerous direction — never apply them unseen.
    if (preview.toRemove.length > 0 && confirm !== true) {
      return NextResponse.json(
        {
          error: 'ConfirmationRequired',
          message: `This change removes access to ${preview.toRemove.length} item(s).`,
          preview,
        },
        { status: 409 },
      );
    }

    await query(
      `UPDATE access_policies SET predicate = $3, updated_at = now()
        WHERE id = $1 AND owner_id = $2`,
      [params.id, auth.ownerId, JSON.stringify(validated)],
    );

    const result = await materializePolicy(auth.ownerId, params.id);

    return NextResponse.json({ id: params.id, ...result });
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  try {
    await assertOwns(auth.ownerId, 'access_policies', params.id);

    // Rules first: a policy row removed before its grants would orphan them.
    const removed = await query<{ id: string }>(
      `DELETE FROM access_rules
        WHERE owner_id = $1 AND policy_id = $2
        RETURNING id`,
      [auth.ownerId, params.id],
    );

    await query(`DELETE FROM access_policies WHERE id = $1 AND owner_id = $2`, [
      params.id,
      auth.ownerId,
    ]);

    await writeAuditEntry(auth.ownerId, {
      actor: `owner:${auth.ownerId}`,
      action: 'policy_deleted',
      entity: 'access_policy',
      entityId: params.id,
      detail: { rulesRemoved: removed.rows.length },
    });

    return NextResponse.json({ deleted: true, rulesRemoved: removed.rows.length });
  } catch (err) {
    return mapError(err);
  }
}
