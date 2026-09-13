# Next session — relay (written 2026-09-13 by the wrap-up; overwritten each wrap-up)

Paste the block below as the first message. It is one `/goal`.

```
/goal Relay after the 2026-09-13 close-out: verify what that session left owed, then work only the dated items — there is no Claude-queued build work. Authoritative plan: PROJECT.yaml (gates/ratified/deferred) and ROADMAP.md rev 9; derived view docs/gap-closure-plan-2026-09-12.md; artifact https://claude.ai/code/artifact/4c41d0e3-64e2-4b42-9807-118cc5e971a1 — update it in place at the SAME URL.

START with these read-only verifications (each names its own check; derive every number live, quote nothing from memory):
1. Register one-liner: count `deferred` entries without `closed:` in PROJECT.yaml (python/grep) and compare with the artifact's fact box.
2. `npm run check:ladder` — no owner write moved the rungs (the quiet window); `rungs ever sent` still 0 unless a rung fell due.
3. `gh run list --workflow=backup-wall.yml --limit 3` and the same for kms-wall.yml / iam-wall.yml — the scheduled runs are green; `npm run check:cadence`.
4. Reply-To: Gmail connector search `from:relay@relaystandby.com newer_than:14d`; if a product mail exists, confirm its Reply-To reads relay@relaystandby.com (Steve set it in Vercel 09-13) and record on ratified.sitting-d2-2026-09-13.walkthrough_2_reply_to.
5. DMARC: `from:noreply-dmarc-support@google.com OR from:dmarcreport@microsoft.com newer_than:14d` — the newest report carries INBOX (the never-spam filter, 09-13). Budgets: `from:budgets@costalerts.amazonaws.com newer_than:14d` — read, not in Trash, or say so.
6. `npm run verify:orphans` (0/0/0), `npm run verify:kms`, `npm run verify:iam` (.env.admin), `npm run drill:preflight`.
7. `TZ=UTC npx vitest run lib/ops` — the date guards: which revisits ring in the next 7 days (09-17 verifier claim; 09-19 Sitting E; 09-27 key deletion).

THEN, in calendar order, only what the date has reached:
- 09-17: read `adding-a-person-to-the-circle-does-not-invite-them` — has the verifier claimed (`npm run beta:status`)? Answer the revisit; if not claimed, the sends are Steve's (Sprint 2) — AskUserQuestion, never a passive table.
- 09-19: Sitting E — the read-only credential into the Claude Code cloud env (Steve's UI; then prove with verify:schema from a cloud session), Stripe receipts toggle (account-wide; Steve rules), answer `revisit_outcome` on the-domain-can-lapse-without-anyone-noticing and the-read-only-identity-is-not-in-the-cloud.
- 09-27: on Steve's nod, delete the INACTIVE old autospecai access key by the Node signer (ListAccessKeys → DeleteAccessKey on the inactive id only; never print a secret) and `~/.aws/credentials.bak-2026-09-13`; walls green after; answer the revisit on no-secret-rotation-cadence-and-nothing-rotated and CLOSE it.
- After the ladder fires (~10-03 first rung, ~10-08 final, or later if an owner write moved them): record on the-reminder-ladder-has-never-fired and shipped-but-unproven-release-guards; then the owner checks in (Steve).
- Nothing else: every other open entry is event-gated (first stranger, first customer, partner diligence) or dated (11-15 lapse notice, 12-13 drill + cadence, 12-31 Cloudflare card).

RULES: work on a branch and open a PR; master is strictly protected (verify + axe) and has NO auto-merge — update-branch, wait for both checks, merge with no master move in between. Explicit `git add <paths>`; no Claude commit trailer. Never edit .env.local; local dev writes PRODUCTION DSQL — no owner sign-in or write on the real account until the ladder has fired. Never write the Stripe head-office city into any file or commit. The pre-push hook runs the full suite + build. relay-heartbeat runs the canary FROM THIS CHECKOUT every 15 min — leave master checked out when done.

CREDENTIALS this needs (preflight, read-only, ask for all missing logins in ONE message): `[autospecai]` profile in ~/.aws/credentials (the NEW key — the old one is inactive), .env.ro / .env.admin, `gh auth status`, the Gmail connector, and — only for Steve-court items — Claude-in-Chrome with Cloudflare and Stripe signed in (Gmail is not a permitted domain; the plugin's Chrome profile is not signed into GitHub).

STOP RULE: the gap plan's Claude lane is spent (three sprints in a row cleared the 3-row minimum; .claude/sprint-state.json says iterationsRemaining 0). Do not invent a G5; a new sprint is re-scoped by Steve.
```
