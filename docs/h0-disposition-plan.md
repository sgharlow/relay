# H0 verdict disposition plan — pre-committed W/L/Z branches (2026-07-03)

> Gate `h0-verdict-disposition` (due **2026-08-07**): an explicit commercialize / park / archive
> decision within a week of results (winners ~**2026-07-31 2pm PDT**). This plan pre-commits the
> branches NOW so verdict day is a 10-minute check against a written plan, not a fresh
> deliberation under verdict-day emotion. Per the portfolio doc-discipline standard: every
> roadmap that terminates at an event needs a post-event branch plan.

## The principle that governs all three branches

**The judges' verdict is evidence about the hackathon, not about the market.** The caregiver
market never saw the H0 entry. The only market evidence instrument we have is G1 — which is
built, ratified, static (needs NO database — it survives the 7-25 teardown), and costs ~$250 and
two weeks to run. Therefore: **every branch below runs G1 before any park/archive decision.**
Killing relay without running the $250 test we already built would be deciding on vibes.

## WIN — any prize, placement, or finalist mention

- Disposition: **commercialize** (the win is distribution ammunition, not just validation).
- Sequence: security-remediation swap (1 session) → merge `exp/g1-caregiver-landing` → enable
  Vercel Analytics → launch G1 paid lanes, with "H0 winner ([track])" added to landing + ads.
- Start G2 counsel outreach the same week (brief is ready: `g2-counsel-brief.md`).
- Infra: NO re-provisioning yet — G1 needs none; the G4 infra decision waits for a G1 pass.

## LOSE — no placement

- Disposition: **run G1 anyway** (default), on the identical sequence minus the winner badge.
  The entry losing to other hackathon projects says nothing about caregivers' willingness to pay.
- Explicit pre-commitment: park/archive may ONLY be chosen at this branch if Steve decides the
  portfolio-level opportunity cost is too high — and that decision must name what the freed
  capacity goes to instead. "Lost, feels bad" is not a listed reason.
- G1 verdict then governs per the ratified gate: ≥2% → proceed toward G2/G4; <0.5% → park D2C,
  B2B2C-only or archive; middle → one iteration, then a second sub-2% read counts as kill.

## ZOMBIE — no results, unclear results, or nothing announced by 8-07

- If winners haven't been announced by the gate date **8-07**, do NOT let the gate slip: treat as
  LOSE-path (run G1) and record the disposition as "commercial test proceeding; hackathon outcome
  moot." A results announcement arriving later upgrades to WIN handling if applicable.

## Invariants across all branches

- **7-25 teardown proceeds regardless of branch** (runbook: `__project-docs/relay-teardown-7-25.md`;
  timing DECIDED by Steve 2026-07-03: execute 7-25 — only the in-session GO for the destructive
  phase remains a 7-25 decision. Pre-teardown verify pass 2026-07-04: 4/4 resources present,
  ACTIVE, deletion-protected — runbook appendix). G1 does not depend on the demo infra.
- G2 counsel opinion remains a hard pre-revenue requirement on every path.
- No product feature work on any path until a G1 pass — the sequencing rule survives the verdict.
- Decision + rationale get written into PROJECT.yaml (`gates.h0-verdict-disposition.met`) and the
  memory topic file the same day.

## Appendix — verdict-day kit (paste-ready; prepared 2026-07-04)

On verdict day: pick the branch, fill the two `<angle>` placeholders, paste, commit. Nothing
else should need authoring under verdict-day emotion.

### 1. PROJECT.yaml — add under `gates: - id: h0-verdict-disposition`

**WIN** (any prize, placement, or finalist mention):

```yaml
    met:
      date: <YYYY-MM-DD>
      result: "WIN — <track/prize as announced>"
      decision: commercialize
      rationale: "Per pre-committed disposition plan (docs/h0-disposition-plan.md, 2026-07-03): win = distribution ammunition; every branch runs G1."
      next: "jose §B migration -> merge security+landing -> winner badge on landing/ads -> Vercel Analytics -> G1 paid lanes (docs/g1-launch-checklist.md)"
```

**LOSE** (no placement):

```yaml
    met:
      date: <YYYY-MM-DD>
      result: "LOSE — no placement"
      decision: run-G1-anyway
      rationale: "Per pre-committed plan: judges' verdict is evidence about the hackathon, not the market; the $250 G1 test is the market instrument. Park/archive only if Steve names the higher-value use of the freed capacity."
      next: "jose §B migration -> merge security+landing -> Vercel Analytics -> G1 paid lanes, no badge (docs/g1-launch-checklist.md)"
```

**ZOMBIE** (nothing announced by 8-07):

```yaml
    met:
      date: 2026-08-07
      result: "ZOMBIE — no results announced by gate date"
      decision: run-G1-anyway
      rationale: "Gate does not slip; treated as LOSE-path per plan. A later announcement upgrades to WIN handling (badge added mid-flight)."
      next: "same as LOSE; revisit badge if results arrive"
```

### 2. MEMORY.md relay row — replace the `USER: H0 verdict disposition…` blocker cell

- WIN: `Verdict WIN (<track/prize>, <date>) → commercialize per disposition plan; G1 launch sequence running (g1-launch-checklist.md). | USER: approve first paid-lane spend`
- LOSE: `Verdict LOSE (<date>) → G1 runs anyway per pre-commit; park/archive only via named-opportunity-cost decision. | USER: approve first paid-lane spend`
- ZOMBIE: `No H0 results by 8-07 → gate closed as LOSE-path per plan; G1 proceeding, outcome moot. | USER: approve first paid-lane spend`

### 3. Same-day topic-file note (`project_h0_hackathon_orbis_relay.md`)

One line, all branches: `h0-verdict-disposition gate CLOSED <date>: <W/L/Z + one-clause result>; decision recorded in PROJECT.yaml; next = g1-launch-checklist.md sequence. Teardown state at verdict: <from runbook appendix>.`
