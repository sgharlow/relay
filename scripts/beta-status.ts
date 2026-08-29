/**
 * Where is this account in the journey, right now?
 *
 * The co-pilot instrument for onboarding a founding family: the owner clicks,
 * this says what actually landed in the database. Written because every step of
 * the beta walk has a visible half (a screen said yes) and a real half (a row
 * exists), and this product's recurring defect is the two disagreeing.
 *
 *   npm run beta:status                    # every account
 *   npm run beta:status -- <email>         # one
 *
 * ⚠️ Wired on `.env.ro` (the read-only `relay_ro` identity) as of 2026-08-29, not
 * `.env.local`. It only SELECTs, so the credential that can also write was never
 * the right one — and running it under `relay_ro` is what lets an unattended
 * agent answer these questions at all.
 *
 * READ-ONLY. Prints states, counts and dates — never a code, a token, a
 * fingerprint phrase or anything from a vault. A status tool that printed a
 * credential would be a credential store with a friendly name.
 *
 * Feature: relay-h0-mvp
 */

import { query, closeAllPools } from '../lib/db/connection';

const tick = (ok: boolean) => (ok ? '  OK ' : '  --  ');

interface OwnerRow {
  id: string;
  email: string;
  display_name: string | null;
  checkin_interval_days: number;
  is_demo_account: boolean;
}

async function one(o: OwnerRow): Promise<void> {
  console.log(`\n${'='.repeat(66)}\n${o.email}${o.is_demo_account ? '  [demo]' : ''}\n${'='.repeat(66)}`);

  const [items, codes, sub, people, invites, releases] = await Promise.all([
    query<{ n: string }>(`SELECT count(*)::text n FROM vault_items WHERE owner_id=$1`, [o.id]),
    /*
      B33: `n` alone cannot tell "8 codes, freshly generated, safely stored" from
      "8 codes generated once at signup and lost at that moment" — and for the one
      live paying owner it is the second. So the shape is read too: when the oldest
      and newest were created, and how many have ever been spent. Still one SELECT,
      still read-only.
    */
    query<{ n: string; total: string; oldest: string | null; newest: string | null; used: string }>(
      `SELECT count(*) FILTER (WHERE used_at IS NULL)::text n,
              count(*)::text total,
              min(created_at)::text oldest,
              max(created_at)::text newest,
              count(used_at)::text used
         FROM recovery_codes WHERE user_id=$1`, [o.id]),
    query<{ tier: string; status: string; cohort: string | null; price_cents: number | null }>(
      `SELECT tier, status, cohort, price_cents FROM subscriptions
        WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 1`, [o.id]),
    query<{
      kind: string; id: string; name: string; email: string;
      standby_state: string | null; claimed_user_id: string | null;
    }>(
      `SELECT 'recipient' kind, id, name, email, standby_state, claimed_user_id
         FROM recipients WHERE owner_id=$1
       UNION ALL
       SELECT 'verifier', id, name, email, standby_state, claimed_user_id
         FROM verifiers WHERE owner_id=$1
       ORDER BY kind, name`, [o.id]),
    query<{ person_id: string; delivery_channel: string | null; opened_at: string | null; claimed_at: string | null }>(
      `SELECT person_id, delivery_channel, opened_at::text, claimed_at::text
         FROM invitations WHERE owner_id=$1`, [o.id]),
    query<{ trigger_type: string; state: string; received_confirmations: number; required_confirmations: number }>(
      `SELECT trigger_type, state, received_confirmations, required_confirmations
         FROM release_state WHERE owner_id=$1 ORDER BY trigger_type`, [o.id]),
  ]);

  // ---- Setup -------------------------------------------------------------
  console.log('\nSETUP');
  console.log(`${tick(Boolean(o.display_name))}name set${o.display_name ? `: ${o.display_name}` : ' — contacts will see the email address instead'}`);
  console.log(`${tick(Number(items.rows[0].n) > 0)}vault items: ${items.rows[0].n}`);
  console.log(`${tick(Number(codes.rows[0].n) > 0)}unused recovery codes: ${codes.rows[0].n}`);
  /*
    B33 — a read-only NOTICE, so this question stops needing a human with a SQL
    client. It never fails the script: whether the owner still holds the codes is
    unknowable from the database, and a check that cannot be satisfied by any
    commit is a status, not a gate. Same reasoning as verify:dogfood's not-ready.
  */
  {
    const c = codes.rows[0];
    const spread = c.oldest && c.newest ? Date.parse(c.newest) - Date.parse(c.oldest) : 0;
    /*
      60 seconds, and the number was MEASURED rather than guessed. The first
      attempt used 1000 ms and did not fire on the very account it was written
      for: the live owner's 8 codes span 1391 ms, because they are INSERTed one
      row at a time. Anything under a minute is one enrolment event; a genuine
      regeneration weeks later shows a spread of days, so the gap between the two
      readings is enormous and the exact threshold inside it does not matter.
    */
    const ONE_ENROLMENT_EVENT_MS = 60_000;
    const neverRegenerated =
      Number(c.total) > 0 && Number(c.used) === 0 && spread < ONE_ENROLMENT_EVENT_MS;
    if (neverRegenerated) {
      console.log(
        `    NOTICE: all ${c.total} codes were created in the same instant (${c.oldest}) and ` +
        'none has ever been used.',
      );
      console.log(
        '    That is the signature of codes generated once at enrolment and never regenerated ' +
        'since. It does NOT prove they were lost — only that nothing has happened to them.',
      );
      console.log(
        '    If the owner cannot produce them, regenerate from /account (needs step-up/TOTP). ' +
        'Only the owner can answer that; this script can only say the row has not changed.',
      );
    }
  }
  const s = sub.rows[0];
  const comped = s ? s.cohort === 'founding-comp' || s.price_cents === 0 : false;
  console.log(`${tick(true)}tier: ${s ? `${s.tier} (${s.status})${comped ? ' — COMPED, never revenue' : ''}` : 'free (no row)'}`);
  console.log(`${tick(true)}check-in every ${o.checkin_interval_days} days`);

  // ---- The circle --------------------------------------------------------
  const inviteBy = new Map(invites.rows.map((i) => [i.person_id, i]));
  const claimedIds = people.rows.map((p) => p.claimed_user_id).filter((x): x is string => Boolean(x));
  const passkeys = claimedIds.length
    ? await query<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM webauthn_credentials WHERE user_id = ANY($1)`, [claimedIds])
    : { rows: [] as { user_id: string }[] };
  const withPasskey = new Set(passkeys.rows.map((r) => r.user_id));

  const emails = people.rows.map((p) => p.email.toLowerCase());
  const delivery = emails.length
    ? await query<{ email: string; event: string; occurred_at: string }>(
        `SELECT DISTINCT ON (email) email, event, occurred_at::text
           FROM email_delivery_events WHERE email = ANY($1)
          ORDER BY email, occurred_at DESC`, [emails]).catch(() => ({ rows: [] as never[] }))
    : { rows: [] as { email: string; event: string; occurred_at: string }[] };
  const deliveryBy = new Map(delivery.rows.map((d) => [d.email, d]));

  console.log(`\nTHE CIRCLE (${people.rows.length})`);
  if (people.rows.length === 0) console.log('  --  nobody named yet');
  for (const p of people.rows) {
    const inv = inviteBy.get(p.id);
    const state = p.standby_state ?? 'invited';
    const confirmed = state === 'confirmed';
    console.log(`\n  ${p.name} · ${p.kind}`);
    console.log(`${tick(true)}state: ${state}${confirmed ? ' — their answer counts' : ' — their answer does NOT count toward quorum'}`);
    console.log(`${tick(Boolean(inv))}code issued${inv ? ` (${inv.delivery_channel ?? 'unknown'} channel)` : ' — not yet'}`);
    if (inv) {
      console.log(`${tick(Boolean(inv.opened_at))}opened the claim page${inv.opened_at ? ` ${inv.opened_at.slice(0, 16)}` : ' — not yet'}`);
      console.log(`${tick(Boolean(inv.claimed_at))}claimed${inv.claimed_at ? ` ${inv.claimed_at.slice(0, 16)}` : ' — not yet'}`);
    }
    const hasKey = Boolean(p.claimed_user_id && withPasskey.has(p.claimed_user_id));
    console.log(`${tick(hasKey)}passkey${hasKey ? '' : ' — they cannot get back in on a new device without you'}`);
    const d = deliveryBy.get(p.email.toLowerCase());
    console.log(`${tick(d?.event === 'email.delivered')}mail: ${d ? `${d.event} ${d.occurred_at.slice(0, 16)}` : 'nothing heard (webhook unset, or nothing sent yet)'}`);
  }

  // ---- The machine -------------------------------------------------------
  console.log(`\nTRIGGERS (${releases.rows.length})`);
  if (releases.rows.length === 0) console.log('  --  none configured — nothing would open');
  for (const r of releases.rows) {
    console.log(`${tick(r.state === 'armed')}${r.trigger_type}: ${r.state.toUpperCase()} · ${r.received_confirmations}/${r.required_confirmations} confirmations`);
  }
}

async function main(): Promise<void> {
  const wanted = (process.argv[2] ?? '').trim().toLowerCase();
  const owners = await query<OwnerRow>(
    wanted
      ? `SELECT id, email, display_name, checkin_interval_days, is_demo_account
           FROM users WHERE lower(email)=$1`
      : `SELECT id, email, display_name, checkin_interval_days, is_demo_account
           FROM users ORDER BY created_at`,
    wanted ? [wanted] : [],
  );

  if (owners.rows.length === 0) {
    console.log(wanted ? `No account for ${wanted}.` : 'No accounts.');
    await closeAllPools();
    return;
  }
  for (const o of owners.rows) await one(o);
  await closeAllPools();
}

main().catch((e) => {
  console.error('FAILED:', e?.message ?? e);
  process.exit(1);
});
