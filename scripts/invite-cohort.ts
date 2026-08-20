/**
 * scripts/invite-cohort.ts — create a beta cohort and issue every claim code in one run.
 *
 *   npx tsx --env-file=.env.local scripts/invite-cohort.ts              # DRY RUN (default)
 *   npx tsx --env-file=.env.local scripts/invite-cohort.ts --commit     # actually creates people
 *   ... --commit --anyway   # proceed even if the owner vault cannot host an invitation
 *
 * WHY THIS EXISTS. Phase 0 has been at N=0 since 2026-08-12 with a correct,
 * live instrument and nobody in it. The per-person path — add the person, open
 * their panel, issue a code, copy it before the panel closes, compose a message
 * — is about five minutes each and is the reason the cohort keeps not happening.
 *
 * 🔴 IT IS ALSO SAFER THAN DOING IT BY HAND, which is the part worth stating.
 * The claim code is readable EXACTLY ONCE, at the moment it is issued; only a
 * hash is stored. Done manually, closing the panel early loses it and the
 * invitation has to be cancelled and reissued. `POST /api/invitations` returns
 * `claimCode` in its response, so this captures every one, writes them to a
 * gitignored file, and prints a ready-to-send message per person.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT DO, because both are load-bearing:
 *
 *   1. It does not make the four-word verification call. That is two humans
 *      comparing a fingerprint out loud, and it is the control that stops
 *      somebody who intercepted an invitation from being marked verified.
 *      Automating it would remove its only purpose. Until the call happens,
 *      their answer does not count toward opening anything.
 *   2. It does not send the owner-delivered arm. That arm exists precisely
 *      because the owner delivers out of band — read aloud, texted, handed over.
 *      Sending it automatically would convert it into the email arm, which is
 *      the channel measured broken on 2026-08-11 and the reason the standby
 *      architecture exists. Phase 0 measures the difference between those two
 *      arms; collapsing them would destroy the thing being measured.
 *
 * INPUT: `.relay-cohort.json` in the repo root — GITIGNORED, because it holds
 * real people's names and addresses and must never be committed.
 *
 *   [
 *     { "name": "Jane Doe", "email": "jane@example.com", "type": "recipient",
 *       "role": "caregiver", "arm": "owner",  "relationship": "sister" },
 *     { "name": "Sam Roe",  "email": "sam@example.com",  "type": "verifier",
 *       "arm": "email" }
 *   ]
 *
 *   type  recipient | verifier
 *   role  recipient | executor | caregiver | partner   (recipients only)
 *   arm   owner | email   — the two arms Phase 0 exists to compare
 *
 * AUTH: needs `RELAY_OWNER_COOKIE`, the same mechanism scripts/demo-run.ts uses.
 * Sign in at relaystandby.com, copy the session cookie, export it. It is not
 * stored by this script and belongs in no file that is committed.
 *
 * Feature: relay-h0-mvp
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import { VALID_ROLES } from '../lib/domain/enums';
import { INVITE_EMAIL_DAILY_LIMIT } from '../lib/notify/invite-budget';
import { query } from '../lib/db/connection';
import {
  assessDogfoodReadiness,
  countDogfood,
  gateCohortInvite,
} from '../lib/ops/dogfood-readiness';

const BASE = (process.env.RELAY_BASE_URL ?? 'https://relaystandby.com').replace(/\/$/, '');
const COOKIE = process.env.RELAY_OWNER_COOKIE ?? '';
const COMMIT = process.argv.includes('--commit');
// Deliberate exception to the readiness refusal below. Prints what it overrides.
const ANYWAY = process.argv.includes('--anyway');
const INPUT = '.relay-cohort.json';
const OUTPUT = '.relay-cohort-codes.json';

interface Row {
  name: string;
  email: string;
  type: 'recipient' | 'verifier';
  role?: string;
  arm: 'owner' | 'email';
  relationship?: string;
}

interface Issued extends Row {
  personId: string;
  claimCode: string;
  claimUrl: string;
  expiresAt: string;
  emailDelivered: boolean;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify(body),
  });
}

/** Refuse a malformed cohort BEFORE creating any of it — a half-created batch is the worst outcome. */
function validate(rows: unknown): Row[] {
  if (!Array.isArray(rows)) throw new Error(`${INPUT} must be a JSON array`);
  return rows.map((r, i) => {
    const at = `row ${i + 1}`;
    const row = r as Row;
    if (!row?.name?.trim()) throw new Error(`${at}: name is required`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row?.email ?? '')) throw new Error(`${at}: a valid email is required`);
    if (row.type !== 'recipient' && row.type !== 'verifier') {
      throw new Error(`${at}: type must be "recipient" or "verifier"`);
    }
    if (row.arm !== 'owner' && row.arm !== 'email') {
      throw new Error(`${at}: arm must be "owner" or "email" — these are the two arms Phase 0 compares`);
    }
    if (row.type === 'recipient' && row.role && !VALID_ROLES.includes(row.role as never)) {
      throw new Error(`${at}: role must be one of ${VALID_ROLES.join(', ')}`);
    }
    return row;
  });
}

function messageFor(r: Issued): string {
  const who =
    r.type === 'verifier'
      ? `You never see anything inside it, not before and not after. You are vouching for the situation, not handling anything.`
      : `It does not give you access to anything now. If something happens and the people I have named agree it is genuine, the specific things I set aside for you would open — and they close again the moment I check in.`;
  return [
    `Hi ${r.name.split(' ')[0]},`,
    ``,
    r.type === 'verifier'
      ? `Slightly odd favour. I have set up a way for my family to reach a few important accounts if I am ever unreachable — but I did not want that to be able to happen on its own, so it takes people who know me to confirm it is genuinely an emergency first. I would like you to be one of them.`
      : `I have finally sorted something I should have done years ago: a way for the people I trust to reach the handful of accounts that would actually matter if I were in hospital or unreachable. You are one of the first people I would want to be able to do that.`,
    ``,
    who,
    ``,
    `It takes two minutes. Go to ${r.claimUrl} and enter this code:`,
    ``,
    `    ${r.claimCode}`,
    ``,
    r.type === 'verifier'
      ? `Then I will call you to check four words match on both our screens — that is what stops someone else pretending to be you later.`
      : `I will ring you afterwards to check one thing. It takes thirty seconds and it is the bit that makes it actually secure.`,
    ``,
    `Please do say no if you would rather not. It is better for me to know.`,
    ``,
    `Steve`,
  ].join('\n');
}

async function main(): Promise<void> {
  if (!existsSync(INPUT)) {
    console.error(`No ${INPUT}. Create it (gitignored) — see the header of this file for the shape.`);
    process.exit(1);
  }
  const rows = validate(JSON.parse(readFileSync(INPUT, 'utf8')));

  const emailArm = rows.filter((r) => r.arm === 'email').length;
  console.log(`[cohort] ${rows.length} people — ${rows.length - emailArm} owner-delivered, ${emailArm} by email`);
  console.log(`[cohort] target: ${BASE}`);

  if (emailArm > INVITE_EMAIL_DAILY_LIMIT) {
    console.error(
      `[cohort] ✗ ${emailArm} email invitations exceeds the ${INVITE_EMAIL_DAILY_LIMIT}/24h per-owner budget ` +
        `(lib/notify/invite-budget.ts). Split the run or move some to the owner arm.`,
    );
    process.exit(1);
  }

  if (!COMMIT) {
    console.log(`\n[cohort] DRY RUN — nothing created. Re-run with --commit when the list is right.\n`);
    for (const r of rows) {
      console.log(`  ${r.type.padEnd(9)} ${r.arm.padEnd(5)} ${r.name} <${r.email}>${r.role ? ` (${r.role})` : ''}`);
    }
    console.log(`\n[cohort] These are REAL people going into the production database. Check the list, then --commit.`);
    return;
  }

  /*
    🔴 CAN THE VAULT THESE PEOPLE ARE BEING INVITED INTO ACTUALLY HOST THEM?

    Measured on 2026-08-20, the answer was no and nothing asked: production held
    one owner account with zero vault items, zero access rules and no release
    that had ever left `armed`. This script would have invited real people —
    named in .relay-cohort.json, not test rows — to stand by for nothing.

    `npm run verify:dogfood` reports the same thing, but a report is a convention
    somebody has to remember to run. This is the structural half.
  */
  const counts = await countDogfood(async (sql) => {
    const r = await query<{ n: string }>(sql);
    return Number(r.rows[0]?.n ?? 0);
  });
  const decision = gateCohortInvite(assessDogfoodReadiness(counts), ANYWAY);
  if (decision.refuse) {
    console.error(`\n[cohort] ${decision.message}\n`);
    process.exit(1);
  }
  console.log(`\n[cohort] ${decision.message}\n`);

  if (!COOKIE) {
    console.error('[cohort] ✗ RELAY_OWNER_COOKIE is not set — an owner session is required to create people.');
    process.exit(1);
  }

  const issued: Issued[] = [];
  for (const r of rows) {
    const personPath = r.type === 'recipient' ? '/api/recipients' : '/api/verifiers';
    const payload =
      r.type === 'recipient'
        ? { name: r.name, email: r.email, role: r.role ?? 'recipient', relationship: r.relationship ?? null }
        : { name: r.name, email: r.email };

    const created = await post(personPath, payload);
    if (!created.ok) {
      console.error(`[cohort] ✗ ${r.name}: creating the ${r.type} failed — ${created.status} ${await created.text()}`);
      console.error(`[cohort]   stopping. ${issued.length} already created; their codes are below and in ${OUTPUT}.`);
      break;
    }
    const person = (await created.json()) as { id?: string; recipient?: { id: string }; verifier?: { id: string } };
    const personId = person.id ?? person.recipient?.id ?? person.verifier?.id ?? '';

    const inv = await post('/api/invitations', { personId, personType: r.type, deliveryChannel: r.arm });
    if (!inv.ok) {
      console.error(`[cohort] ✗ ${r.name}: person created but invitation failed — ${inv.status} ${await inv.text()}`);
      continue;
    }
    const body = (await inv.json()) as Omit<Issued, keyof Row | 'personId'>;
    issued.push({ ...r, personId, ...body });
    console.log(`[cohort] ✓ ${r.name} — ${r.arm} arm, code captured`);
  }

  if (issued.length) {
    writeFileSync(OUTPUT, JSON.stringify(issued, null, 2));
    console.log(`\n[cohort] ${issued.length} code(s) written to ${OUTPUT} (gitignored).`);
    console.log(`[cohort] The codes are readable ONCE at issue — this file is the only copy.\n`);
    for (const r of issued.filter((x) => x.arm === 'owner')) {
      console.log('─'.repeat(72));
      console.log(messageFor(r));
    }
    console.log('─'.repeat(72));
  }

  console.log(
    `\n[cohort] NEXT, and neither is automatable:\n` +
      `  1. Send the owner-arm messages above yourself. That arm exists because you deliver it.\n` +
      `  2. After each person claims, make the four-word call: People → the person → Verified?\n` +
      `     Until you do, their answer does not count toward opening anything.\n` +
      `\n[cohort] Then: npx tsx --env-file=.env.local scripts/phase0-report.ts`,
  );
}

main().catch((e: unknown) => {
  console.error('[cohort] failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
