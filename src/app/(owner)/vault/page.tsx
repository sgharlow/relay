/**
 * Server shell for the client page beside it — it exists to carry `metadata`.
 *
 * 🔴 SIX OWNER PAGES HAD NO Vault · Relay, found 2026-08-13 by looking at the tabs:
 * /vault, /vault/new, /rules, /triggers, /import and /audit all read as a bare
 * "Relay", because each was a `'use client'` page and a client component cannot
 * export metadata. Six identical tabs is not cosmetic on THIS product: check-in
 * and answering a request are jobs people do with many tabs open, and the tab
 * label is how they get back to the right one.
 *
 * Same shape as /circle and /account, which always had it: server page.tsx that
 * renders the client component. No logic moved.
 *
 * IT ALSO RUNS REQUIREMENT 12 NOW. The prioritisation agent was written, tested
 * and called by nothing, so the "Custody Risk" label the spec names had never
 * been shown. The requirement says the scan happens "on vault load", and this
 * is vault load — running it here costs no client bundle and needs no endpoint.
 * It is deliberately non-fatal: a gap scan that fails must never stop an owner
 * reaching their own vault.
 */

import { getOwnerSession } from '../../../../lib/auth/session';
import { runPrioritize, type Gap } from '../../../../lib/ai/prioritize-agent';
import VaultDashboardClient from './VaultDashboardClient';
import { GapList } from './GapList';

export const metadata = { title: 'Vault · Relay' };

export default async function Page() {
  let gaps: Gap[] = [];
  try {
    const session = await getOwnerSession();
    gaps = (await runPrioritize(session.ownerId)).gaps;
  } catch {
    // Advisory only (Req 12.7). An unreachable agent, a slow query or a session
    // edge must not turn "show me my vault" into an error page.
  }

  return (
    <>
      <VaultDashboardClient />
      <GapList gaps={gaps} />
    </>
  );
}
