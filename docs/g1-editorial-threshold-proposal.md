# Editorial-instrument thresholds — PROPOSAL, awaiting Steve's ratification

> **Status: DRAFT — not ratified, not in force.** Written 2026-08-18 to close the open task
> `PROJECT.yaml → gates.g1-caregiver-wtp.instrument_retired.thresholds_do_not_transfer`:
> *"RE-DERIVING the threshold and N for the editorial instrument is an OPEN TASK owned by Steve,
> and it must be done BEFORE the first placement goes live so the number cannot be
> reverse-engineered from whichever result appears."*
>
> This document exists so the numbers are on record BEFORE any editorial traffic exists. Nothing
> here moves into `PROJECT.yaml` until Steve ratifies it (edit, then record the ruling there);
> after any placement is live, these numbers may only change by a recorded ruling, never silently.

## The question, unchanged

Will caregivers pay, at a real price, having seen the number. Same question the paid instrument
asked; only the way of putting it to people has changed.

## The funnel, unchanged

- **Denominator** — `caregiver_qualified` on `/caregivers`, resolved through `qualifiedProps()`
  (one source of truth for both sides since the 2026-08-10 correction B).
- **Numerator** — `caregiver_intent`: a click on the priced CTA. The Stripe branch emits it
  (correction A); `beta-*` and QA srcs are gate-excluded (`isGateQualifyingSrc`, correction C).
- **Instrument srcs** — each placement carries its own `?src=ed-<outlet>` (e.g. `ed-caregiver-com`).
  Only `ed-*` traffic feeds this gate; `direct` and untagged stay excluded as today.

## Why the paid thresholds do not transfer

`>= 2% at N >= 100` was calibrated against **bought clicks**: a cold audience, interrupted, arriving
with no context. An editorial reader arrives having chosen to read ~1,000 words about the exact
problem and then chosen to click through from a byline — twice self-selected. Two consequences,
pulling in opposite directions:

1. **Per-visitor conversion should be materially higher.** Content-referred visitors to a priced
   page are conventionally several times warmer than paid-cold. Carrying 2% across would set a bar
   this population could clear while signalling nothing.
2. **Volume will be far lower.** A single contributed piece plausibly drives tens of qualified
   visits, not hundreds. An N=100 floor on a single placement could leave the gate unjudgeable for
   months and invite exactly the "read the tea leaves early" pressure a gate exists to prevent.

## Proposed numbers

| | Value | Reasoning |
|---|---|---|
| **Pass** | `>= 6%` click-to-intent among `ed-*` qualified visitors, **cumulative across placements**, judged at `N >= 50` | 3× the paid bar, reflecting twice-self-selected traffic. At the minimum N this is ≥3 real people who read a whole article and then clicked a real price — small in count, honest in kind: each is precisely the arms-length signal `demand_signal:` requires. |
| **Kill** | `< 2%` after `N >= 150` cumulative | Editorial traffic converting no better than the old *paid* PASS bar, across roughly three placements' worth of volume, says the warm population does not want it at this price → park D2C, fall back to the B2B2C branch the superseded gate already names. |
| **No-read floor** | No judgment either way below `N = 50` | Small-N ratios are noise. A placement that drives `< 10` qualified visits is a **distribution** failure (wrong outlet, buried placement), recorded as such in the flight log — it says nothing about demand and does not feed the ratio. |
| **Owner / review** | Steve · re-derive only by recorded ruling | Same discipline as every ratified block in `PROJECT.yaml`. |

Cumulative-across-placements is deliberate: the unit being judged is the *instrument* (editorial),
not any single outlet. Per-outlet reads stay in the flight log for channel selection.

## Pre-flight requirement — the numerator must be live-proven first

`caregiver_intent`'s Stripe branch is pinned by `lane-b.test.ts` but has never fired on a real
click (MEMORY: "Lane-B numerator NOT live-proven"). Before the first placement goes live, run the
corrected two-part verification from the flight log: part 1 gate-safe (`QA_SRCS`), part 2 exactly
one recorded real click. An instrument that has never emitted its numerator measures nothing, and
discovering that after publication would burn the placement.

## What ratification looks like

1. Steve edits any number above he disagrees with.
2. The agreed block moves into `PROJECT.yaml` under `gates.g1-arms-length-demand` (or a child
   instrument block), with `ratified:` date and `by: steve`.
3. This file gains a `> RATIFIED <date>` banner and stops being a proposal.
