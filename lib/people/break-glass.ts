/**
 * Break-glass — the way back in when the normal path is gone (§3.6).
 *
 * Two people need this. The contact who never claimed — no smartphone, no
 * inclination, the invitation never landed — and the contact whose authenticator
 * is in a river. Without it, the first is excluded from the circle entirely and
 * the second needs the owner, who may be the person who is unreachable.
 *
 * IT IS DELIBERATELY LOUD. Redeeming one is not a quiet alternative sign-in: it
 * writes a distinct audit action, notifies the owner, burns the code, and drops
 * the person to `claimed` rather than `confirmed` — so the owner's light goes
 * amber and they are asked to verify the fingerprint again. That last part is the
 * point. The whole reason to allow a bearer credential is that its use is
 * visible, and a break-glass that silently restored `confirmed` would be a
 * standing credential wearing a costume.
 *
 * THE RESIDUAL RISK, NAMED (§8.1). For an unclaimed contact this code exists
 * before any claim and may sit in a drawer for years. Until redeemed it is
 * functionally the standing printed credential principle 2 forbids. It is
 * bounded — single use, expiry, attempt budget, audit, owner notification, and
 * §4.3 keeps a break-glass-only contact out of the count that authorizes a
 * release — and accepted, because the alternative is excluding people who cannot
 * hold a passkey.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R13
 */

import { createHash, randomInt } from 'crypto';

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import { ValidationError } from '../validation';
import { CASE_ID_ALPHABET } from '../release/case-id';
import { upsertUser } from '../auth/upsert-user';
import { readStandbyState } from './standby-state';
import { notifyOwnerOfBreakGlass } from '../notify/notifications';
import type { PersonType } from './invitations';

/** Same budget as recipient_codes (017) and verifier_codes (015). */
export const MAX_BREAK_GLASS_ATTEMPTS = 10;

/** Long-lived by necessity — it exists for an emergency years from now. */
export const BREAK_GLASS_TTL_DAYS = 365;

/**
 * TWELVE characters, longer than the invitation's ten and the codes' eight.
 * Those live 30 days and 24–72 hours respectively; this one lives a year in a
 * drawer, so the guessing window is orders of magnitude larger and the entropy
 * is raised to match (~59 bits).
 */
export const BREAK_GLASS_CODE_LENGTH = 12;

export function hashBreakGlass(code: string): string {
  return createHash('sha256')
    .update(code.toUpperCase().replace(/[^0-9A-Z]/g, ''))
    .digest('hex');
}

function generate(): string {
  let out = '';
  for (let i = 0; i < BREAK_GLASS_CODE_LENGTH; i++) {
    out += CASE_ID_ALPHABET[randomInt(CASE_ID_ALPHABET.length)];
  }
  return out;
}

/** Display form — three groups of four, which people transcribe accurately. */
export function formatBreakGlass(code: string): string {
  const c = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

export async function issueBreakGlass(params: {
  ownerId: string;
  personId: string;
  personType: PersonType;
}): Promise<{ code: string; expiresAt: string }> {
  const code = generate();
  const expiresAt = new Date(Date.now() + BREAK_GLASS_TTL_DAYS * 86400_000).toISOString();

  // Any previously issued code for this person is retired first. Two live
  // break-glass codes for one slot doubles the standing-credential surface for
  // no benefit, and the owner reissuing almost always means the old one is lost.
  await query(
    `UPDATE break_glass_codes SET used_at = now()
      WHERE owner_id = $1 AND person_id = $2 AND used_at IS NULL`,
    [params.ownerId, params.personId],
  );

  await query(
    `INSERT INTO break_glass_codes (owner_id, person_id, person_type, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.ownerId, params.personId, params.personType, hashBreakGlass(code), expiresAt],
  );

  await writeAuditEntry(params.ownerId, {
    actor: `owner:${params.ownerId}`,
    action: 'break_glass_issued',
    entity: params.personType,
    entityId: params.personId,
    detail: { personType: params.personType, expiresAt },
  });

  return { code, expiresAt };
}

export interface BreakGlassResult {
  userId: string;
  ownerId: string;
  personId: string;
  personType: PersonType;
}

const REFUSAL = 'That code is not valid, or it has already been used.';

/**
 * Redeem — binds an identity the same way a claim does, then makes noise.
 *
 * Drops the person to `claimed`, never `confirmed`: whoever just used this may
 * not be who the owner confirmed months ago, and the owner is the only one who
 * can settle that.
 */
export async function redeemBreakGlass(params: {
  code: string;
  existingUserId?: string;
}): Promise<BreakGlassResult> {
  const codeHash = hashBreakGlass(params.code);

  const found = await query<{
    id: string;
    owner_id: string;
    person_id: string;
    person_type: PersonType;
    failed_attempts: number | null;
  }>(
    `SELECT id, owner_id, person_id, person_type, failed_attempts
       FROM break_glass_codes
      WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
      LIMIT 1`,
    [codeHash],
  );

  const row = found.rows[0];
  if (!row) throw new ValidationError(REFUSAL, 'code');

  if (Number(row.failed_attempts ?? 0) >= MAX_BREAK_GLASS_ATTEMPTS) {
    await query(
      `UPDATE break_glass_codes SET failed_attempts = failed_attempts + 1 WHERE id = $1`,
      [row.id],
    );
    throw new ValidationError(REFUSAL, 'code');
  }

  const table = row.person_type === 'verifier' ? 'verifiers' : 'recipients';

  // REVOCATION OUTRANKS A CODE IN A DRAWER, and until 2026-08-12 it did not.
  //
  // Nothing retires a break-glass code when an owner revokes someone, and this
  // function did not look at `standby_state` — so a revoked contact holding a
  // year-old code could redeem it and set themselves straight back to `claimed`
  // with a bound session. The person an owner most urgently removes is a
  // controlling household member (Risk 3), and revocation is the control that
  // answers them; a bearer credential that survives it is not a control at all.
  //
  // Checked BEFORE the burn, deliberately: a refused attempt must not consume
  // the code, or an attacker could disarm a legitimate holder's only way in by
  // trying it once. The attempt budget above is what bounds repetition.
  //
  // A missing roster row is refused for the same reason and with the same words:
  // the person was deleted, and there is nothing left to bind to.
  const roster = await query<{ standby_state: string | null }>(
    `SELECT standby_state FROM ${table} WHERE id = $1 AND owner_id = $2 LIMIT 1`,
    [row.person_id, row.owner_id],
  );
  const personState = roster.rows[0];
  if (!personState || readStandbyState(personState.standby_state) === 'revoked') {
    throw new ValidationError(REFUSAL, 'code');
  }

  // Burn it before doing anything else. A code that survives a partial redeem is
  // a code that can be replayed.
  await query(`UPDATE break_glass_codes SET used_at = now() WHERE id = $1`, [row.id]);

  let userId: string;
  if (params.existingUserId) {
    userId = params.existingUserId;
  } else {
    const person = await query<{ email: string }>(
      `SELECT email FROM ${table} WHERE id = $1 LIMIT 1`,
      [row.person_id],
    );
    const email = person.rows[0]?.email;
    if (!email) throw new ValidationError(REFUSAL, 'code');
    // upsertUser, not INSERT … ON CONFLICT — this data layer cannot rely on a
    // unique secondary index (see lib/auth/upsert-user.ts).
    userId = (await upsertUser(`standby:${email.trim().toLowerCase()}`, email)).id;
  }

  await query(
    `UPDATE ${table}
        SET claimed_user_id = $1, standby_state = 'claimed', fingerprint_confirmed_at = NULL
      WHERE id = $2 AND owner_id = $3`,
    [userId, row.person_id, row.owner_id],
  );

  await writeAuditEntry(row.owner_id, {
    actor: `${row.person_type}:${row.person_id}`,
    action: 'break_glass_redeemed',
    entity: row.person_type,
    entityId: row.person_id,
    detail: { personType: row.person_type, requiresReconfirmation: true },
  });

  // §3.6 requires this to NOTIFY THE OWNER, and nothing did until 2026-08-12 —
  // the audit entry existed, which records the event for anyone who goes looking
  // rather than telling the one person who needs to know. "Loud" is what makes a
  // year-old bearer credential acceptable (§8.1), and a loud event nobody hears
  // is the quiet alternative sign-in this was explicitly not supposed to be.
  //
  // Best-effort, and it must stay that way: the redeemer is mid-emergency and a
  // mail outage cannot be allowed to stop them. The audit entry above is the
  // durable record; this is the alert. Failure is swallowed the same way every
  // other notification in this codebase swallows it.
  // Awaited-with-catch rather than fire-and-forget, matching how
  // `notifyRecipientsOfRelease` is called from `submitConfirmation`. Fire-and-
  // forget would make the one alert that justifies this credential both
  // untestable and silent when it breaks — and "allowed to fail" is not the same
  // as "allowed to fail invisibly" (§3.4: a channel allowed to fail must still
  // fail visibly).
  try {
    const contact = await query<{ name: string; email: string }>(
      `SELECT p.name, u.email
         FROM ${table} p JOIN users u ON u.id = p.owner_id
        WHERE p.id = $1 LIMIT 1`,
      [row.person_id],
    );
    const c = contact.rows[0];
    if (c?.email) {
      await notifyOwnerOfBreakGlass({
        to: c.email,
        personName: c.name,
        personType: row.person_type,
      });
    }
  } catch (err) {
    process.stderr.write(`[break-glass] owner notification failed: ${String(err)}\n`);
  }

  return {
    userId,
    ownerId: row.owner_id,
    personId: row.person_id,
    personType: row.person_type,
  };
}
