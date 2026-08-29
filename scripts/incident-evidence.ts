/**
 * scripts/incident-evidence.ts — Step 0 of the security incident runbook, as a
 * command instead of a paragraph.
 *
 * WHY THIS EXISTS (B24). `docs/security-incident-runbook.md` Step 0 says, in
 * order: verify the audit chain per affected owner and RECORD THE RESULT WITH A
 * TIMESTAMP, then capture Vercel logs, the chain, `scheduler_runs` and
 * `email_send_attempts` — "Vercel log retention is finite — pull first, reason
 * second." Every one of those was a sentence, and nothing scripted any of it.
 * At 3am, under pressure, a runbook step with no command is a step that gets
 * approximated.
 *
 * 🔴 THE ORDERING IS THE WHOLE POINT, AND IT IS NOT ARBITRARY. The runbook says a
 * chain break found AT THE START is evidence, and a break found later "is a
 * question about what you did." So this runs the verification FIRST, before
 * anything else touches anything, and stamps it. Running it after an hour of
 * investigation produces a strictly less valuable artefact — the same output,
 * worth less, and nothing about the output would say so. That is why this is one
 * command rather than four.
 *
 * READ-ONLY, AND STRUCTURALLY SO. It runs under `.env.ro` (`relay_ro`: SELECT on
 * every table, no DML, no DDL, no KMS grant at all). It cannot repair a chain,
 * and there is no repair path in this product by design — `audit_log` is
 * append-only and a single UPDATE would invalidate every hash after it.
 *
 * ⚠️ IT PRINTS NO PLAINTEXT SECRET AND NO VAULT CONTENT, and that is a constraint
 * on what it may ever grow to do. `detail` is JSONB written by the application
 * and is summarised by KEY, never by value, because an evidence bundle that
 * quotes vault data is a vault export with an official-sounding filename.
 *
 * ⚠️ WHAT IT CANNOT DO: pull Vercel runtime logs. Those need a Vercel token, not
 * a database credential, and retention is ~24h — so that half stays a human step
 * and this script SAYS SO on every run rather than letting a clean report imply
 * the bundle is complete.
 *
 * Usage:
 *   npm run incident:evidence                 # every owner (chain check only)
 *   npm run incident:evidence -- <email>      # one owner, full bundle
 *   npm run incident:evidence -- --since 24h  # narrow the telemetry window
 *
 * Exit codes, deliberately distinct:
 *   0  every chain verified
 *   1  a chain is BROKEN — this is a finding, not a script failure
 *   2  could not look (no credentials, query failed)
 *
 * It doubles as the pre-release chain check the runbook asks for, which is why
 * the no-argument form sweeps every owner rather than requiring one.
 *
 * Feature: relay-h0-mvp
 * Requirements: B24; docs/security-incident-runbook.md Step 0
 */

import { query, closeAllPools } from '../lib/db/connection';
import { verifyAuditChain } from '../lib/audit/chain';
import { getAuditLog } from '../lib/audit/audit-service';

interface OwnerRow {
  id: string;
  email: string;
  is_demo_account: boolean | null;
}

const STAMP = new Date().toISOString();

function parseSinceHours(argv: string[]): number {
  const i = argv.indexOf('--since');
  if (i === -1) return 24 * 14;
  const m = /^(\d+)\s*([hd])$/.exec(argv[i + 1] ?? '');
  if (!m) return 24 * 14;
  return m[2] === 'd' ? Number(m[1]) * 24 : Number(m[1]);
}

async function ownersFor(target: string | undefined): Promise<OwnerRow[]> {
  const r = target
    ? await query<OwnerRow>(
        `SELECT id, email, is_demo_account FROM users WHERE lower(email) = lower($1)`,
        [target],
      )
    : await query<OwnerRow>(`SELECT id, email, is_demo_account FROM users ORDER BY email`);
  return r.rows;
}

/** The chain half — first, always, and stamped. */
async function verifyChains(owners: OwnerRow[]): Promise<number> {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`STEP 0a — AUDIT CHAIN VERIFICATION`);
  console.log(`verified_at: ${STAMP}   (record this timestamp; it is the artefact)`);
  console.log(`${'='.repeat(72)}\n`);

  let broken = 0;
  for (const o of owners) {
    const entries = await getAuditLog(o.id);
    if (!entries.length) {
      console.log(`  --  ${o.email}${o.is_demo_account ? ' [demo]' : ''} — no audit entries`);
      continue;
    }
    const v = verifyAuditChain(entries);
    if (v.valid) {
      console.log(
        `  OK  ${o.email}${o.is_demo_account ? ' [demo]' : ''} — ${entries.length} entries, ` +
          `seq ${entries[0].seq}..${entries[entries.length - 1].seq}, chain intact`,
      );
    } else {
      broken++;
      console.log(`  🔴 ${o.email} — CHAIN BROKEN at seq ${v.brokenSeq} (${v.reason})`);
      console.log(`      owner_id: ${o.id}`);
      console.log(`      entries: ${entries.length}`);
      /*
        Both reasons are reported, and they are NOT the same finding.
        `entry_hash_mismatch` means a row's own content no longer hashes to its
        stored hash — an edit. `prev_hash_mismatch` means linkage is broken,
        which an edit causes AND so does an ordinary concurrent-write fork
        (audit-service.ts documents that race and the derived-key fix for it).
        Reporting the reason is what lets a responder tell "somebody edited a
        row" from "two writers collided", and those have very different next
        steps.
      */
      console.log(
        v.reason === 'entry_hash_mismatch'
          ? "      An entry's own content no longer hashes to its stored hash. That is an EDIT."
          : '      Linkage is broken. An edit does this — and so does a concurrent-write fork ' +
            '(see audit-service.ts on the derived-key guard). Check for two rows at one seq ' +
            'before concluding tampering.',
      );
    }
  }
  return broken;
}

/** The telemetry half — counts and windows only, never content. */
async function captureTelemetry(owner: OwnerRow, sinceHours: number): Promise<void> {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`STEP 0b — TELEMETRY for ${owner.email} (last ${sinceHours}h)`);
  console.log(`${'='.repeat(72)}\n`);

  const [sched, mail, actions] = await Promise.all([
    query<{ n: string; oldest: string | null; newest: string | null }>(
      `SELECT count(*)::text n, min(ran_at)::text oldest, max(ran_at)::text newest
         FROM scheduler_runs WHERE ran_at > now() - ($1 || ' hours')::interval`,
      [String(sinceHours)],
    ),
    query<{ n: string; oldest: string | null; newest: string | null }>(
      `SELECT count(*)::text n, min(occurred_at)::text oldest, max(occurred_at)::text newest
         FROM email_send_attempts WHERE occurred_at > now() - ($1 || ' hours')::interval`,
      [String(sinceHours)],
    ),
    query<{ actor: string; action: string; n: string }>(
      `SELECT actor, action, count(*)::text n
         FROM audit_log
        WHERE owner_id = $1 AND ts > now() - ($2 || ' hours')::interval
        GROUP BY actor, action ORDER BY count(*) DESC, action`,
      [owner.id, String(sinceHours)],
    ),
  ]);

  console.log(`  scheduler_runs      ${sched.rows[0].n} in window  (${sched.rows[0].oldest ?? '-'} .. ${sched.rows[0].newest ?? '-'})`);
  console.log(`  email_send_attempts ${mail.rows[0].n} in window  (${mail.rows[0].oldest ?? '-'} .. ${mail.rows[0].newest ?? '-'})`);
  console.log(`\n  audit actions in window, by actor — counts only, never detail values:`);
  if (!actions.rows.length) {
    console.log('    (none)');
  } else {
    for (const a of actions.rows) console.log(`    ${a.n.padStart(5)}  ${a.actor}  ${a.action}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sinceHours = parseSinceHours(argv);

  /*
    Find the positional argument, skipping any flag AND the value that belongs to
    one. Written out rather than golfed, because the golfed version was wrong in a
    way that passed a smoke test: `a !== argv[argv.indexOf('--since') + 1]`
    evaluates to `a !== argv[0]` when `--since` is ABSENT (indexOf returns -1),
    which silently excludes the only positional argument there is. The symptom was
    a per-owner run quietly sweeping every owner and exiting 0 — a script that
    answered a different question than it was asked, with no error. Found by
    running it, not by reading it.
  */
  const flagValueIndexes = new Set<number>();
  argv.forEach((a, i) => {
    if (a === '--since') flagValueIndexes.add(i + 1);
  });
  const target = argv.find((a, i) => !a.startsWith('--') && !flagValueIndexes.has(i));

  let owners: OwnerRow[];
  try {
    owners = await ownersFor(target);
  } catch (err) {
    console.error(`\n✗ COULD NOT LOOK — this is not a clean bundle.\n  ${String(err)}\n`);
    console.error('  Needs .env.ro (the read-only relay_ro identity).\n');
    process.exitCode = 2;
    return;
  }

  if (!owners.length) {
    console.error(target ? `\n✗ No owner with email ${target}\n` : '\n✗ No owners at all\n');
    process.exitCode = 2;
    return;
  }

  const broken = await verifyChains(owners);
  if (target) await captureTelemetry(owners[0], sinceHours);

  console.log(`\n${'='.repeat(72)}`);
  console.log('🔴 NOT CAPTURED BY THIS SCRIPT, AND THE BUNDLE IS INCOMPLETE WITHOUT IT:');
  console.log('   Vercel runtime logs for the window. Retention is ~24h and it needs a Vercel');
  console.log('   token, not a database credential — so it is a human step, and it is the one');
  console.log('   with a clock on it. Pull those FIRST if you have not:');
  console.log('     vercel logs relay --prod            (or the dashboard, Logs tab)');
  console.log(`   Runbook: docs/security-incident-runbook.md Step 0.`);
  console.log(`${'='.repeat(72)}`);

  if (broken > 0) {
    console.log(`\n✗ ${broken} chain(s) BROKEN as of ${STAMP}.`);
    console.log('  This is a finding about the data, not a failure of this script. Do NOT attempt');
    console.log('  a repair: audit_log is append-only, a single UPDATE invalidates every hash');
    console.log('  after it, and there is no repair path here by design.\n');
    process.exitCode = 1;
    return;
  }
  console.log(`\n✓ Every chain verified intact as of ${STAMP}.\n`);
}

main()
  .catch((err) => {
    console.error(`\n✗ COULD NOT LOOK: ${String(err)}\n`);
    process.exitCode = 2;
  })
  .finally(() => closeAllPools());
