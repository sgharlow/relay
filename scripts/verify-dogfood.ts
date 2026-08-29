/**
 * scripts/verify-dogfood.ts — can the owner's vault host a cohort invitation?
 * Read-only. Primary region.
 *
 *   npm run verify:dogfood       (runs as `relay_ro` via --env-file=.env.ro)
 *
 * ⚠️ This said `--env-file=.env.local` until 2026-08-29. `package.json` runs it on
 * `.env.ro` (`relay_ro`). A stale warning costs more than a stale claim because it
 * is obeyed — this one sent an operator for the credential that can WRITE in order
 * to run a read-only check. It was NOT on the ROADMAP H list; a grep for
 * `env-file=.env.local` across scripts/ found it.
 *
 * WHY THIS EXISTS. ROADMAP.md sprint 1 exists because production was measured on
 * 2026-08-20 and held one owner account, zero vault items, zero recipients, zero
 * verifiers and no release that had ever left `armed` — while `PROJECT.yaml`
 * claimed `dogfooded` and the beta-cohort plan assumed a populated vault. Four of
 * that sprint's five items are things only Steve can do, and the way they were
 * written, knowing whether they were finished meant writing ad-hoc SQL. This is
 * that SQL, once, with the criteria attached.
 *
 * ⚠️ A NOT-READY RESULT IS A STATUS, NOT A DEFECT. Nothing in this repository can
 * fix it and no commit will turn it green; it reports on a live system that a
 * person populates. It exits non-zero so it can be used as a precondition check
 * before `npm run invite:cohort`, which is the actual point — inviting people to
 * stand by for an empty vault is the failure this prevents.
 *
 * ⚠️ NOT IN `npm run gate` AND NOT IN `verify:live`. It needs credentials, and a
 * business fact that is legitimately false for weeks does not belong in a
 * pipeline that is supposed to mean "the code is sound".
 *
 * Feature: relay-h0-mvp
 */

import { query } from '../lib/db/connection';
import { assessDogfoodReadiness, countDogfood, summarise } from '../lib/ops/dogfood-readiness';

/**
 * The SQL lives in lib/ops/dogfood-readiness.ts, not here, because
 * `scripts/invite-cohort.ts` asks the same question before it commits — and two
 * copies of "what counts as ready" is two things to drift.
 */
async function count(sql: string): Promise<number> {
  const r = await query<{ n: string }>(sql);
  return Number(r.rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const counts = await countDogfood(count);
  const verdict = assessDogfoodReadiness(counts);

  console.log('\nOwner vault, as it stands (demo-flagged AND reserved-domain accounts excluded):\n');
  const rows: Array<[string, number]> = [
    ['real owner accounts', counts.realOwners],
    ['vault items', counts.vaultItems],
    ['recipients', counts.recipients],
    ['verifiers', counts.verifiers],
    ['access rules', counts.accessRules],
    ['release triggers configured', counts.releaseConfigs],
  ];
  for (const [label, n] of rows) {
    console.log(`  ${n === 0 ? '✗' : '✓'} ${label.padEnd(30)} ${n}`);
  }

  if (verdict.note) console.log(`\n  note: ${verdict.note}`);

  console.log(`\n${summarise(verdict)}\n`);

  if (!verdict.ready) {
    console.log('What is missing, in the order the product makes them possible:\n');
    verdict.missing.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.what}`);
      console.log(`     why:    ${m.why}`);
      console.log(`     action: ${m.action}\n`);
    });
    console.log(
      'This is ROADMAP.md sprint 1 items 1.1-1.3. Until it reads READY, `npm run invite:cohort`\n' +
        'would invite people to stand by for a vault with nothing in it.\n',
    );
    process.exit(1);
  }

  console.log('`npm run invite:cohort` has something real to invite people into.\n');
}

main().catch((err) => {
  console.error(`\nverify:dogfood could not read the cluster: ${String(err)}`);
  console.error('That is not a not-ready result — it means the probe did not run.\n');
  process.exit(2);
});
