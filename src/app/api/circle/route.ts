/**
 * GET /api/circle — coverage matrix, proposed policies, circle-complete state.
 *
 * One call backs the whole "building the circle of trust" screen: which
 * critical items nobody can reach, how much each recipient holds, and a draft
 * policy set the owner edits rather than authors (J4-R2, J4-R5, J4-R13).
 *
 * Metadata only — never selects ciphertext / wrapped_data_key / kms_key_id (CC2).
 *
 * Feature: relay-h0-mvp
 * Requirements: J4-R2, J4-R5, J4-R13
 */

import { NextResponse } from 'next/server';

import { requireOwner, isResponse } from '../../../../lib/http/owner-route';
import { query } from '../../../../lib/db/connection';
import { computeCoverage } from '../../../../lib/rules/coverage';
import { proposePolicies } from '../../../../lib/rules/policy-proposals';
import type { PolicyItem } from '../../../../lib/rules/policy-predicate';
import { fingerprintFor } from '../../../../lib/people/fingerprint';
import { latestDeliveryByEmail } from '../../../../lib/notify/delivery-events';
import { fireDrillStatus } from '../../../../lib/release/fire-drill';

/**
 * Takes no request argument, so Next tries to prerender it at build time —
 * which means running a query with no session against no database. That made
 * the build depend on the cluster being reachable and on credentials being
 * present, which is why it failed the first time CI ran it on a clean machine
 * and passed on every developer laptop with a .env.local.
 *
 * The route was already dynamic in the built output; this makes the build
 * hermetic rather than changing what ships.
 */
export const dynamic = 'force-dynamic';


export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const [items, rules, recipients, verifiers, policies] = await Promise.all([
    query<PolicyItem & { title: string }>(
      `SELECT id, title, category, criticality, is_root_credential, irreplaceable,
              importance_score::float8 AS importance_score
         FROM vault_items
        WHERE owner_id = $1`,
      [auth.ownerId],
    ),
    query<{ vault_item_id: string; recipient_id: string }>(
      `SELECT vault_item_id, recipient_id FROM access_rules WHERE owner_id = $1`,
      [auth.ownerId],
    ),
    query<{
      id: string;
      name: string;
      role: string;
      email: string;
      email_secondary: string | null;
      standby_state: string | null;
      claimed_user_id: string | null;
      break_glass_only: boolean | null;
    }>(
      `SELECT id, name, role, email, email_secondary, standby_state, claimed_user_id,
              break_glass_only
         FROM recipients WHERE owner_id = $1`,
      [auth.ownerId],
    ),
    query<{
      id: string;
      name: string;
      email: string;
      email_secondary: string | null;
      standby_state: string | null;
      claimed_user_id: string | null;
      break_glass_only: boolean | null;
    }>(
      `SELECT id, name, email, email_secondary, standby_state, claimed_user_id, break_glass_only
         FROM verifiers WHERE owner_id = $1`,
      [auth.ownerId],
    ),
    query<{ id: string }>(`SELECT id FROM access_policies WHERE owner_id = $1`, [auth.ownerId]),
  ]);

  /**
   * WHO COULD STILL GET IN IF THEY LOST THEIR PHONE.
   *
   * The owner had no way to know this, and it is the question that decides
   * whether a plan survives contact with a real emergency: a confirmed verifier
   * whose device is gone, with no passkey and no emergency code, cannot act at
   * all — and nothing said so. It is also the precondition for ever ceasing to
   * mint release-time codes, because "everybody has a fallback" was previously
   * unknowable from inside the product.
   *
   * Two batched lookups rather than per-person queries. An unclaimed contact has
   * no user id and therefore no passkey, which is why the passkey set is keyed
   * on `claimed_user_id` and the code set on the roster row.
   */
  const claimedUserIds = [...recipients.rows, ...verifiers.rows]
    .map((p) => p.claimed_user_id)
    .filter((id): id is string => Boolean(id));
  const personIds = [...recipients.rows, ...verifiers.rows].map((p) => p.id);

  const [passkeyRows, codeRows] = await Promise.all([
    claimedUserIds.length
      ? query<{ user_id: string }>(
          `SELECT DISTINCT user_id FROM webauthn_credentials WHERE user_id = ANY($1)`,
          [claimedUserIds],
        )
      : Promise.resolve({ rows: [] as { user_id: string }[] }),
    personIds.length
      ? query<{ person_id: string }>(
          // Unredeemed AND unexpired. A spent or lapsed code is not a way back in.
          `SELECT DISTINCT person_id FROM break_glass_codes
            WHERE person_id = ANY($1) AND used_at IS NULL AND expires_at > now()`,
          [personIds],
        )
      : Promise.resolve({ rows: [] as { person_id: string }[] }),
  ]);

  const withPasskey = new Set(passkeyRows.rows.map((r) => r.user_id));
  const withCode = new Set(codeRows.rows.map((r) => r.person_id));

  /*
    THE ONE REACHABILITY SIGNAL A JUNKED MESSAGE CANNOT FAKE. Everything else on
    this screen is a claim by a machine about a machine — `email.delivered` is
    what the provider says about its own queue, and both messages in the
    2026-08-14 Outlook test recorded it while sitting in a junk folder. A drill
    acknowledgement was pressed by a person. See lib/release/fire-drill.ts.
  */
  const drills = await fireDrillStatus(auth.ownerId);

  /*
    🔴 "WE TOLD THEM" WAS UNKNOWABLE. Resend answers 200 with a message id for
    a SUPPRESSED address, so a previously-bounced contact is muted permanently
    and every caller reports success. On the day a release fires, that is
    notices going nowhere, nobody answering, and quorum never met.

    Resend now pushes bounce and complaint events to /api/resend/webhook; this
    reads the latest one per address so the owner can find out in CALM, which is
    the only time they can act on it.

    ABSENT MEANS UNHEARD, NEVER FINE. Until the webhook is configured every
    address is absent from this map, so the field is null and the UI says
    nothing — a screen that reported "reachable" on the basis of no evidence
    would be the false green this codebase keeps finding. Failure is swallowed
    for the same reason: a delivery-history outage must not take down the screen
    that shows who can reach what.
  */
  const deliveryByEmail = await latestDeliveryByEmail(
    [...recipients.rows, ...verifiers.rows].map((p) => p.email as string),
  ).catch(() => new Map());

  const coverage = computeCoverage(items.rows, rules.rows);

  /**
   * Attach the fingerprint phrase to anyone who has bound an identity.
   *
   * Without it the confirm control is a blind "yes" button — the owner would be
   * asserting "I compared a phrase and it matched" having never been shown one,
   * which is the assurance model deleting itself. §3.3 is explicit that the
   * security comes from the out-of-band comparison, so the phrase has to reach
   * the person making the comparison.
   *
   * DERIVED, never stored, and never sent for somebody unbound: `fingerprintFor`
   * is a pure function of (owner, person, claimedUser), so it changes the moment
   * a different human claims the slot and an old confirmation stops reading as
   * valid (Risk 8). Sending it to the owner is safe by construction — an
   * attacker who intercepted the ticket can see their own phrase too; what they
   * cannot do is be on the end of the owner's phone call.
   */
  function withFingerprint(ownerId: string) {
    return <T extends { id: string; claimed_user_id: string | null }>(person: T) => {
      const { claimed_user_id, ...rest } = person;
      return {
        ...rest,
        /*
          The rehearsal record. Unlike `delivery` below, an acknowledgement is
          evidence about a HUMAN rather than about a provider's queue — it is the
          only reachability signal in this product that a junked message cannot
          fake. Raw timestamps; `describeDrill` decides what may be claimed from
          them, so the judgement lives in one place and is tested.
        */
        drill: drills.get(person.id) ?? null,
        fingerprint: claimed_user_id
          ? fingerprintFor({ ownerId, personId: person.id, claimedUserId: claimed_user_id })
          : null,
        // Booleans, never the credential itself: the owner needs to know a way
        // back in EXISTS, and knowing more than that would not help them.
        has_passkey: Boolean(claimed_user_id && withPasskey.has(claimed_user_id)),
        has_break_glass: withCode.has(person.id),
        // null = we have not heard. Never rendered as reassurance.
        delivery:
          deliveryByEmail.get(String((person as { email?: unknown }).email ?? '').toLowerCase()) ??
          null,
      };
    };
  }

  // Titles for the uncovered ids, so the UI can name what is unreachable
  // rather than print a UUID at someone.
  const titleById = new Map(items.rows.map((i) => [i.id, i.title]));

  return NextResponse.json({
    coverage: {
      ...coverage,
      uncoveredCritical: coverage.uncoveredCritical.map((id) => ({
        id,
        title: titleById.get(id) ?? id,
      })),
    },
    // Proposals only make sense before the owner has authored anything.
    proposals: policies.rows.length === 0 ? proposePolicies(items.rows, recipients.rows) : [],
    recipients: recipients.rows.map(withFingerprint(auth.ownerId)),
    verifiers: verifiers.rows.map(withFingerprint(auth.ownerId)),
    policyCount: policies.rows.length,
    itemCount: items.rows.length,
  });
}
