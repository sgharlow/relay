# G1 post-verdict merge → deploy → launch checklist

> Written 2026-07-04 (session PRD Story 3, in-lock prep). Executable ONLY after the
> `h0-verdict-disposition` decision is recorded (see `h0-disposition-plan.md` — every W/L/Z
> branch runs G1). Until then master stays frozen. Thresholds, price, budget, and window are
> NOT restated here — they live in `PROJECT.yaml` (gate `g1-caregiver-wtp`),
> `g1-wtp-test-design.md` (decisions table), and `g1-channel-send-kit.md` (budget/lanes).

## Static-survival proof (verified 2026-07-04 on `af4ddf3`)

The G1 instrument provably survives the 7-25 DSQL/KMS teardown:

1. **Zero backend imports.** `grep -rni "dsql|kms|lib/db|lib/auth|lib/kms|pg|connection" src/app/caregivers/`
   → no matches. `content.ts` imports nothing; both pages import only `next/link` + `./content`;
   the root layout imports only fonts/CSS.
2. **No API calls.** Intent capture is the `mailto:` CTA on `/caregivers/interest` — no fetch,
   no form action, no route handler.
3. **Prerendered static.** `next build` marks both routes `○ (Static)`:
   `/caregivers` and `/caregivers/interest`.
4. **Suite green on the branch:** 410/410 (58 base files + `content.test.ts` gate-rule tests).

Re-run all four checks at merge time if the branch has moved past `af4ddf3`.

## Sequence (from the disposition plan's WIN branch; LOSE/ZOMBIE = same minus winner badge)

- [ ] **0. Disposition recorded** — `PROJECT.yaml` `gates.h0-verdict-disposition.met` filled in
      (paste-ready blocks: `h0-disposition-plan.md` appendix) + memory updated.
- [ ] **1. jose migration (§B)** on `exp/security-remediation` — one session, gated by the plan's
      §B.6 acceptance (22 negative vectors + harness mechanical-only edits + full suite + tsc +
      build + grep completeness). This is pre-committed as the first post-verdict move.
- [ ] **2. Merge order:** `exp/security-remediation` → master, then `exp/g1-caregiver-landing` →
      master. (Independent trees — landing touches only `src/app/caregivers/` + docs — so
      conflicts are not expected; the security branch carries the superseding copy of
      `security-remediation-plan.md`, so take ITS version on any docs conflict.)
- [ ] **3. WIN only:** add the "H0 winner ([track])" badge to landing copy + ad variants before
      first send (`h0-disposition-plan.md`).
- [ ] **4. Push master** — verdict freeze is over at this point by definition. Vercel auto-deploys.
- [ ] **5. Enable Vercel Web Analytics** on the project (dashboard toggle, zero code) — this is
      the G1 measurement instrument; without it there is no denominator.
- [ ] **6. Live post-deploy probes:**
      - `/caregivers` → 200, price visible on CTA, reversibility-led hero.
      - `/caregivers/interest?src=hero` → 200, noindex meta present, mailto CTA correct.
      - `?src=` attribution survives the click-through path.
- [ ] **7. Teardown-aftermath check (post-7-25 deploys only):** the DB-backed app routes are
      expected dead — verify the landing's only outbound links (`/caregivers/interest`, footer
      `/`) don't land a qualified visitor on a 500. If `/` errors without DSQL, point the footer
      link at `/caregivers` or accept the dead home page explicitly — do not silently ship a
      broken first click.
- [ ] **8. Launch paid lanes** per `g1-channel-send-kit.md` (ratified budget ceiling; `src`
      values per lane). Organic participation stays Steve-voice-only per the channel-rules audit.
- [ ] **9. Log window start date** + N-counting rules in the gate tracking note; the gate
      hard-stops per `PROJECT.yaml` (`g1-caregiver-wtp`, due 2026-09-15).

## Rollback

Landing is additive + static: rollback = revert the landing merge commit (or `vercel rollback`
to the prior deployment). No data, no schema, no env vars involved.
